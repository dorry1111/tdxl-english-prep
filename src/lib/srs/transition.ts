/**
 * 四档反馈状态转移纯函数（PRD 5.3 / SRS-TEST-CASES 第 1、2、5 节）。
 *
 * 【核心裁决：查表而非公式】
 * 公式写法曾两次出错（KNOWN 的 min(L+1,8) 会把 60/120 天档降级；
 * MASTERED 的 min(max(L+2,9),10) 会丢失 60 天保底），故固化为本查表。
 * 修改任何一行都必须先过 docs/SRS-TEST-CASES.md 的 44 组用例。
 *
 * 纯函数性（D9）：不读系统时钟、不生成随机数；gap 的随机性（3~5 张卡）
 * 属于队列层（queue.ts），这里只返回建议下限值。
 */
import type { Level, Rating, Timestamp } from '../../types/common';
import type { WordState } from '../../types/word';
import { nextStudyDay0400, studyDayOf } from './studyDay';

/** SRS 可注入配置（测试显式传入，禁止全局单例） */
export interface SrsConfig {
  maxLevel: number; // 10
  masterLevel: number; // 8
  intervalLadder: number[]; // 11 档毫秒
  dayStartHour: number; // 4
  maxRetry: number; // 5
}

/** 索引 = 当前等级 L，值 = 对应评分转移后的 L' */
export const NEXT_LEVEL_TABLE: Readonly<Record<Rating, readonly Level[]>> = {
  1: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 不认识：严格归零（PRD 注 3）
  2: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], // 模糊：不涨不降
  3: [1, 2, 3, 4, 5, 6, 7, 8, 8, 9, 10], // 认识：+1 且封顶 8（外层保 max 不降级，PRD 注 5）
  4: [9, 9, 9, 9, 9, 9, 9, 9, 10, 10, 10], // 熟识：保底进 9（60 天池），9/10 保持
};

/** 重现间隔建议下限（卡位数）；队列层可在 [RETRY_GAP_MIN, RETRY_GAP_MAX] 内随机 */
export const SUGGESTED_RETRY_GAP = 3;

export interface TransitionResult {
  next: WordState;
  /** 是否需要当日重新入队（仅「不认识」） */
  enqueue: boolean;
  /** 重现间隔（卡位数）；enqueue=false 时为 0 */
  gap: number;
}

function clampLevel(level: number, maxLevel: number): Level {
  return Math.min(Math.max(Math.trunc(level), 0), maxLevel);
}

function ladderAt(ladder: number[], level: number): number {
  const index = clampLevel(level, ladder.length - 1);
  return ladder[index] ?? 0;
}

/**
 * 状态转移：给定当前学习状态与四档评分，产出下一个状态。
 *
 * - 不认识：L'=0，dueAt=次日 04:00，当日重新入队；
 * - 模糊：L 不变，dueAt=次日 04:00，出队；
 * - 认识/熟识：L'=查表，dueAt=now + 间隔阶梯[L']，出队。
 */
export function transition(
  state: WordState,
  rating: Rating,
  now: Timestamp,
  cfg: SrsConfig,
): TransitionResult {
  const current = clampLevel(state.level, cfg.maxLevel);
  const table = NEXT_LEVEL_TABLE[rating];
  if (!table) {
    throw new Error(`非法评分: ${String(rating)}`);
  }
  const nextLevel = clampLevel(table[current] ?? 0, cfg.maxLevel);

  // dueAt：不认识/模糊推到次日学习日边界；认识/熟识按新等级查间隔阶梯
  const dueAt =
    rating === 1 || rating === 2
      ? nextStudyDay0400(now, cfg.dayStartHour)
      : now + ladderAt(cfg.intervalLadder, nextLevel);

  // D5/D6：retryCountToday 跨学习日归零后，仅「不认识」自增；达上限置 unstable
  const today = studyDayOf(now, cfg.dayStartHour);
  const retryBase = state.retryDay === today ? state.retryCountToday : 0;
  const retryCountToday =
    rating === 1 ? Math.min(retryBase + 1, cfg.maxRetry) : retryBase;
  const unstable =
    rating === 1 ? retryCountToday >= cfg.maxRetry : rating >= 3 ? false : state.unstable;

  // D7：首次达到已掌握阈值时写入 masteredAt，不覆盖已有值
  const masteredAt =
    nextLevel >= cfg.masterLevel && state.masteredAt == null ? now : state.masteredAt;

  const next: WordState = {
    ...state,
    level: nextLevel,
    dueAt,
    lastRating: rating,
    lastReviewAt: now,
    reviewCount: state.reviewCount + 1, // D3
    correctCount: state.correctCount + (rating >= 3 ? 1 : 0),
    wrongCount: state.wrongCount + (rating <= 2 ? 1 : 0),
    lapseCount: state.lapseCount + (rating === 1 ? 1 : 0), // D1
    retryCountToday,
    retryDay: today,
    unstable,
    masteredAt,
    updatedAt: now, // D2
  };

  return { next, enqueue: rating === 1, gap: rating === 1 ? SUGGESTED_RETRY_GAP : 0 };
}
