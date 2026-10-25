/**
 * 会话队列纯函数（PRD 5.4 R2/R3/R5 / SRS-TEST-CASES 第 4 节 B03~B06）。
 *
 * 与 transition 的分工：随机性只存在于这一层（重现间隔 3~5 张卡随机取），
 * transition 保持完全纯函数（D9）。
 */
import type { Timestamp } from '../../types/common';
import { nextStudyDay0400 } from './studyDay';

/** 队列元素：字符串 id（词条 ID / stateKey 均可，队列层不关心语义） */
export type QueueId = string;

export interface InsertRetryOptions {
  /** 当日已重现次数（缺省视为 0） */
  retryCountBefore?: number;
  /** 单日重现上限（PRD MAX_RETRY=5） */
  maxRetry?: number;
  /** 达上限时计算 dueAt 用（now + 学习日边界） */
  now?: Timestamp;
  dayStartHour?: number;
}

export interface InsertRetryResult {
  queue: QueueId[];
  requeued: boolean;
  retryCountAfter: number;
  /** 仅达上限不再入队时返回（次日 04:00），供置 unstable 用 */
  dueAt?: Timestamp;
  unstable: boolean;
  /** 随机取的重现间隔（卡位数），未入队时为 0 */
  gap: number;
}

/** 在 [min, max] 闭区间取随机整数（队列层唯一随机源；测试可注入 rand） */
export function randInt(
  min: number,
  max: number,
  rand: () => number = Math.random,
): number {
  return min + Math.floor(rand() * (max - min + 1));
}

/**
 * 把答「不认识」的词重新插回当日队列：
 * - 插入位置 = min(pos + k, queue.length)，pos 为该词被取出前的下标；
 * - 当日重现次数已达上限时不再入队，只置 dueAt=次日 04:00 与 unstable=true（TC-B05）。
 */
export function insertRetry(
  queue: QueueId[],
  id: QueueId,
  pos: number,
  gapCandidate: number,
  rand: () => number,
  options: InsertRetryOptions = {},
): InsertRetryResult {
  const retryCountBefore = options.retryCountBefore ?? 0;
  const maxRetry = options.maxRetry ?? Number.POSITIVE_INFINITY;
  const retryCountAfter = Math.min(retryCountBefore + 1, maxRetry);

  if (retryCountAfter >= maxRetry && options.maxRetry !== undefined) {
    // 达上限：不入队（TC-B05），供次日首页提示「N 个词不稳定」
    const dueAt =
      options.now !== undefined
        ? nextStudyDay0400(options.now, options.dayStartHour ?? 4)
        : undefined;
    return { queue: [...queue], requeued: false, retryCountAfter, dueAt, unstable: true, gap: 0 };
  }

  const k = Math.max(1, Math.round(gapCandidate) || randInt(3, 5, rand));
  const index = Math.min(pos + k, queue.length);
  const next = [...queue];
  next.splice(index, 0, id);
  return { queue: next, requeued: true, retryCountAfter, unstable: false, gap: k };
}

/** 到期复习候选（refillQueue 输入） */
export interface DueCandidate {
  id: QueueId;
  dueAt: Timestamp;
}

/**
 * 队列补位：剩余卡数 < buffer 时补齐。
 * 取词优先级：到期复习（按 dueAt 升序，先到期先出）→ 新词（按给定顺序）。
 * 两个来源都取尽仍不足 buffer 时，返回现有队列（不凑数）。
 */
export function refillQueue(
  queue: QueueId[],
  buffer: number,
  dueReviews: DueCandidate[],
  newWords: QueueId[],
): QueueId[] {
  const reviews = [...dueReviews].sort((a, b) => a.dueAt - b.dueAt);
  const fresh = [...newWords];
  const next = [...queue];
  while (next.length < buffer && (reviews.length > 0 || fresh.length > 0)) {
    const review = reviews.shift();
    if (review) {
      next.push(review.id);
      continue;
    }
    const word = fresh.shift();
    if (word) {
      next.push(word);
    }
  }
  return next;
}
