/**
 * 会话状态机 reducer（ARCHITECTURE 4.0 五步作答 / PRD 5.4）。
 *
 * 硬约束：
 * - 纯函数：不碰 DB、不读系统时钟（now 注入）、随机性经 rnd 注入；
 * - 落库由 sessionStore 在 reducer 之后执行（先 await 落库，再 set 新状态）；
 * - 一次作答的五步顺序不可颠倒（4.0）。
 */
import { MIN_QUEUE_SIZE, RETRY_GAP_MAX, RETRY_GAP_MIN } from '@/constants';
import { newId } from '@/lib/id';
import { randInt } from '@/lib/srs/queue';
import { transition, type SrsConfig } from '@/lib/srs/transition';
import type { EntityId, Rating, Timestamp } from '@/types/common';
import type {
  CardItem,
  QueueState,
  RetryPoolEntry,
  SessionProgress,
} from '@/types/session';
import type { ReviewLog, WordState } from '@/types/word';

import { dequeueHead, insertRetryCard, refillTail, type DueReviewCard } from './queue';

/** 会话层调度配置（在 SrsConfig 基础上加补位与重现上限） */
export interface SessionConfig extends SrsConfig {
  queueBuffer: number; // MIN_QUEUE_SIZE = 3
}

/** answer() 的输入 */
export interface AnswerInput {
  rating: Rating;
  /** 当前卡的 WordState（新词首答由 store 传入初始化好的 L=0 状态） */
  srsState: WordState;
  /** 看卡耗时（ReviewLog 用） */
  durationMs: number;
  /** R5 补位候选：作答后队列 < buffer 时按此顺序尾插 */
  refill?: { dueReviews: readonly DueReviewCard[]; newWords: readonly CardItem[] };
  /** 补位目标长度（缺省 MIN_QUEUE_SIZE，store 会显式传入） */
  queueBuffer?: number;
  sessionId: EntityId;
  deviceId: string;
  /** SRS 调度配置（显式注入，禁全局单例） */
  srs: SrsConfig;
  /** 当日重现上限（PRD MAX_RETRY=5） */
  maxRetry: number;
}

/** answer() 的输出：新机器状态 + 待落库数据（store 负责持久化） */
export interface AnswerOutcome {
  machine: QueueState;
  /** T06 transition 结果，store 落 wordStates */
  nextWordState: WordState;
  /** D4：每次作答必有一条 ReviewLog */
  reviewLog: ReviewLog;
  /** 本次是否重新入队 */
  requeued: boolean;
  /** R3：达 MAX_RETRY 后置 true */
  unstable: boolean;
  /** 队列空且重现池空 → 会话结束 */
  settled: boolean;
  /** 本次补位消耗（供 store 从待补池扣减） */
  refillTaken: { due: number; new: number };
}

/** 会话初始机器状态 */
export function createQueueState(plannedTotal: number, queue: readonly CardItem[]): QueueState {
  return {
    queue: [...queue],
    retryPool: {},
    firstRatings: {},
    answeredCount: 0,
    plannedTotal,
    status: 'active',
  };
}

/**
 * 一次作答的五步（ARCHITECTURE 4.0，顺序不可颠倒）：
 * 1. card = queue[0]，从队列移除
 * 2. transition() 算 next WordState（落库由 store 做）
 * 3. FORGOT 且未达上限 → 重现卡插到 min(k, 移除后长度) 处，retryCount+1
 * 4. FORGOT 且达上限 → 不入队，unstable=true（dueAt 已由 transition 置次日 04:00）
 * 5. 队列 < buffer 且有补给 → 尾插补足；queue 空且池空 → 结束
 */
export function answer(
  state: QueueState,
  input: AnswerInput,
  now: Timestamp,
  rnd: () => number,
): AnswerOutcome {
  const current = state.queue[0];
  if (!current) {
    throw new Error('队列为空，无可作答卡片');
  }
  if (state.status !== 'active') {
    throw new Error(`会话状态异常: ${state.status}`);
  }

  // 1. 移除当前卡（不可回退在此发生；当前卡恒为 queue[0]，pos 恒为 0）
  let queue = dequeueHead(state.queue);

  // 2. T06 转移（纯函数）
  const { next: transitioned, enqueue } = transition(input.srsState, input.rating, now, input.srs);

  // D4：ReviewLog（prev 来自入参，new 来自 transition 结果）
  const reviewLog: ReviewLog = {
    id: newId('rev'),
    wordId: current.wordId,
    stateKey: current.stateKey,
    sessionId: input.sessionId,
    rating: input.rating,
    prevLevel: input.srsState.level,
    newLevel: transitioned.level,
    prevDueAt: input.srsState.dueAt,
    newDueAt: transitioned.dueAt,
    answeredAt: now,
    durationMs: input.durationMs,
    isRetry: current.kind === 'retry',
    deviceId: input.deviceId,
  };

  // 重现池：非 FORGOT 时该词出池（R4）；FORGOT 时下方按上限判断重建
  const retryPool: Record<string, RetryPoolEntry> = { ...state.retryPool };
  delete retryPool[current.stateKey];

  let requeued = false;
  let unstable = false;

  if (enqueue) {
    const prevEntry: RetryPoolEntry =
      state.retryPool[current.stateKey] ?? {
        stateKey: current.stateKey,
        wordId: current.wordId,
        retryCount: 0,
        nextAppearPos: -1,
        kind: current.kind,
      };
    const retryCount = prevEntry.retryCount + 1;

    if (retryCount >= input.maxRetry) {
      // 4. 达上限：不入队、从重现池移除（该词今天不再出现，会话可正常结算）；
      //    unstable = true（dueAt 已由 transition 置次日 04:00）
      unstable = true;
      delete retryPool[current.stateKey];
    } else {
      // 3. 未达上限：插回队列 min(k, 移除后长度)
      const k = randInt(RETRY_GAP_MIN, RETRY_GAP_MAX, rnd);
      const retryCard: CardItem = {
        key: `retry:${current.stateKey}:${retryCount}`,
        wordId: current.wordId,
        stateKey: current.stateKey,
        kind: 'retry',
        round: retryCount,
      };
      queue = insertRetryCard(queue, retryCard, k);
      retryPool[current.stateKey] = {
        ...prevEntry,
        retryCount,
        nextAppearPos: Math.min(k, queue.length),
      };
      requeued = true;
    }
  }

  // 5. 补位（R5）：只在队尾追加，取词顺序由 refillTail 保证
  let refillTaken = { due: 0, new: 0 };
  const buffer = input.queueBuffer ?? MIN_QUEUE_SIZE;
  if (input.refill && queue.length < buffer) {
    const result = refillTail(
      queue,
      buffer,
      input.refill.dueReviews,
      input.refill.newWords,
    );
    queue = result.queue;
    refillTaken = { due: result.takenDue, new: result.takenNew };
  }

  // 计数（用例 A 口径：answeredCount 按去重词数；firstRatings 只记首次评分）
  const isFirstAnswer = state.firstRatings[current.stateKey] === undefined;
  const firstRatings = { ...state.firstRatings };
  if (isFirstAnswer) {
    firstRatings[current.stateKey] = input.rating;
  }
  const answeredCount = state.answeredCount + (isFirstAnswer ? 1 : 0);
  const plannedTotal = Math.max(state.plannedTotal, answeredCount, queue.length);

  // 6. 结束条件（R6）：队列空且重现池空
  const settled = queue.length === 0 && Object.keys(retryPool).length === 0;

  return {
    machine: {
      queue,
      retryPool,
      firstRatings,
      answeredCount,
      plannedTotal,
      status: settled ? 'finished' : 'active',
    },
    nextWordState: unstable ? { ...transitioned, unstable: true } : transitioned,
    reviewLog,
    requeued,
    unstable,
    settled,
    refillTaken,
  };
}

/** 进度计算（T07 验收第 6 条，单独可测） */
export function computeProgress(state: QueueState): SessionProgress {
  const total = Math.max(state.plannedTotal, state.answeredCount, state.queue.length);
  return {
    answered: state.answeredCount,
    total,
    pending: Math.max(0, total - state.answeredCount),
  };
}

/** 会话结算正确率（PRD 5.7：首次评分 ∈ {2,3,4} 的词 / 去重词数） */
export function computeAccuracy(state: QueueState): {
  correct: number;
  total: number;
  rate: number;
} {
  const entries = Object.values(state.firstRatings);
  const correct = entries.filter((rating) => rating >= 2).length;
  const total = entries.length;
  return { correct, total, rate: total === 0 ? 0 : correct / total };
}
