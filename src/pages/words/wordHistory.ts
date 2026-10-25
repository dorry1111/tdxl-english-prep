/**
 * 词条详情页的学习历史聚合（纯函数，便于单测）。
 *
 * 一个 norm 理论上只对应一份 WordState（主键 stateKey = fnv1a(norm)），
 * 但同一个词出现在多个词库时，历史数据里可能存在「同 norm 多状态」的残留：
 * 这里按 stateKey 精确命中优先，计数类字段跨状态求和，避免漏统计。
 */
import type { Rating, WordState } from '@/types';

/** 详情页展示用的学习历史聚合结果 */
export interface WordHistorySummary {
  /** 熟练度等级 0~10（取精确命中的那份；无命中取第一份） */
  level: number;
  /** 下次到期时间戳；0 = 尚未进入调度 */
  dueAt: number;
  /** 累计复习次数（跨状态求和） */
  reviewCount: number;
  correctCount: number;
  wrongCount: number;
  lastRating: Rating | null;
  lastReviewAt: number | null;
  /** 命中的状态份数（>1 说明存在同 norm 多状态） */
  stateCount: number;
}

/**
 * 聚合某个词的学习状态列表。
 *
 * @param states 未删除的 WordState 列表
 * @param stateKey 当前词条的学习身份键（fnv1a(norm)）
 * @returns 空列表返回 null（页面据此显示「还没有学习记录」）
 */
export function summarizeStates(
  states: WordState[],
  stateKey: string,
): WordHistorySummary | null {
  const active = states.filter((state) => state.deletedAt === null);
  if (active.length === 0) {
    return null;
  }
  const primary = active.find((state) => state.stateKey === stateKey) ?? active[0];
  if (!primary) {
    return null;
  }
  const sum = (pick: (state: WordState) => number): number =>
    active.reduce((total, state) => total + pick(state), 0);
  const latest = active.reduce<WordState>(
    (best, state) => ((state.lastReviewAt ?? 0) > (best.lastReviewAt ?? 0) ? state : best),
    primary,
  );

  return {
    level: primary.level,
    dueAt: primary.dueAt,
    reviewCount: sum((state) => state.reviewCount),
    correctCount: sum((state) => state.correctCount),
    wrongCount: sum((state) => state.wrongCount),
    lastRating: latest.lastRating,
    lastReviewAt: latest.lastReviewAt,
    stateCount: active.length,
  };
}

/** 正确率（0~1）；无作答返回 null（页面显示 —，不显示 0%） */
export function accuracyOf(summary: WordHistorySummary): number | null {
  const answered = summary.correctCount + summary.wrongCount;
  if (answered === 0) {
    return null;
  }
  return summary.correctCount / answered;
}

/** 等级文案：`L3`（满级 10 由调用方决定是否追加说明） */
export function levelText(level: number): string {
  return `L${Math.max(0, Math.trunc(level))}`;
}

/** 上次评分文案映射（复用 messages 的四档文案） */
export function ratingTextOf(
  rating: Rating | null,
  labels: Readonly<Record<Rating, string>>,
): string {
  if (rating === null) {
    return '';
  }
  return labels[rating];
}
