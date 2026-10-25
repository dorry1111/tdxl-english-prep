/**
 * 学习会话域类型（ARCHITECTURE 3.3）。
 *
 * 【架构裁决·无 pos 指针】队列不维护 `pos`：当前卡恒为 `queue[0]`，
 * 作答后把它从数组移除即可，因此「不可回退」是数据结构层面保证的。
 */
import type { EntityId, Rating, StudyDayKey, Syncable, Timestamp } from './common';

/** 队列中的一张卡 */
export interface CardItem {
  /** React key：`${kind}:${stateKey}:${round}`，重入队列时 round 变化以触发重挂载 */
  key: string;
  /** 词条 ID，用于取单词内容（Word.id） */
  wordId: EntityId;
  /** 学习身份键，用于取/写 WordState（见 3.2.1） */
  stateKey: string;
  kind: 'new' | 'review' | 'retry';
  /** 该卡是第几轮（new=0；retry=1..MAX_RETRY） */
  round: number;
}

/** 重现池条目（会话内 + 跨会话遗留都存这个结构） */
export interface RetryPoolEntry {
  stateKey: string;
  wordId: EntityId;
  retryCount: number;
  /** 上次计算的目标位置，仅用于快照调试 */
  nextAppearPos: number;
  kind: 'new' | 'review' | 'retry';
}

/** 会话状态机状态（内存态，由 sessionMachine 纯函数驱动） */
export interface QueueState {
  /** 待答卡片数组。不变量：当前卡恒为 queue[0]；同一 stateKey 至多出现一次 */
  queue: CardItem[];
  /** 重现池 */
  retryPool: Record<EntityId, RetryPoolEntry>;
  /**
   * 每个词在本会话的「首次评分」（PRD 5.7 用例 A 口径）。
   * 会话结算正确率 = 首次评分 ∈ {2,3,4} 的词数 / 去重词数（重现轮不影响）。
   */
  firstRatings: Record<string, Rating>;
  /** 已作答卡数（进度分子；按去重词数计，重现轮不重复计数） */
  answeredCount: number;
  /** 本次会话的初始计划量（进度分母基数，队列补位时动态增加） */
  plannedTotal: number;
  /** 本次会话是否已结束 */
  status: 'active' | 'finished' | 'abandoned';
}

/** 一次学习会话（落库，可同步） */
export interface StudySession extends Syncable {
  id: EntityId;
  studyDay: StudyDayKey;
  startedAt: Timestamp;
  endedAt: Timestamp | null;
  /** 新词答卡数 / 复习答卡数 */
  newCount: number;
  reviewCount: number;
  /** 答题总次数（含重现轮） */
  answerCount: number;
  correctCount: number;
  /** 四档分布 */
  ratingCounts: Record<'1' | '2' | '3' | '4', number>;
  /** 用时秒数，按 30 分钟截断后计入 StudyDay */
  durationSec: number;
  /** 本次出现的、达上限仍答错的词 */
  unstableWordIds: EntityId[];
  deviceId: string;
}

/** 会话快照（用于异常退出后恢复重现池，PRD 5.4 R9） */
export interface SessionSnapshot {
  sessionId: EntityId;
  studyDay: StudyDayKey;
  startedAt: Timestamp;
  updatedAt: Timestamp;
  answeredCount: number;
  retryPool: Record<EntityId, RetryPoolEntry>;
  ratingCounts: Record<'1' | '2' | '3' | '4', number>;
  /** 已答过、需在下次会话优先重现的词（按 R9 插到队首 3 位内） */
  carryOverWordIds: EntityId[];
}

export interface SubmitAnswerInput {
  wordId: EntityId;
  rating: Rating;
  /** 看卡耗时，用于 ReviewLog */
  durationMs: number;
  /** 难度：本卡是否重现轮 */
  isRetry: boolean;
}

/** 会话进度（UI 用，由 answeredCount 与队列长度算出） */
export interface SessionProgress {
  answered: number;
  total: number;
  pending: number;
}
