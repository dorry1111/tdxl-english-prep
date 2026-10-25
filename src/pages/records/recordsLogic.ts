/**
 * 做题记录的纯函数层：交卷判定、概览汇总、按试卷分组。
 *
 * 全部无副作用（时间从参数传入），页面只负责取数与渲染，
 * 这样分组/平均分口径可以单测覆盖，不会散落在 JSX 里。
 */
import type { Attempt, Timestamp } from '@/types';

/** 近 7 天窗口（毫秒） */
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** 是否已交卷（未交卷的答卷可以「继续答题」） */
export function isSubmitted(attempt: Attempt): boolean {
  return attempt.submittedAt !== null;
}

/** 概览四格的数据 */
export interface RecordSummary {
  /** 记录总数（含进行中） */
  total: number;
  /** 已交卷数 */
  submitted: number;
  /** 进行中数 */
  inProgress: number;
  /** 已交卷的平均总分；没有已交卷记录时为 null */
  avgScore: number | null;
  /** 已交卷的累计用时（秒） */
  totalDurationSec: number;
  /** 近 7 天新增记录数 */
  recent7d: number;
}

/** 汇总概览：平均分只统计已交卷记录，避免进行中的 0 分拉低均值 */
export function summarize(attempts: readonly Attempt[], nowTs: Timestamp): RecordSummary {
  let submitted = 0;
  let scoreSum = 0;
  let totalDurationSec = 0;
  let recent7d = 0;
  for (const attempt of attempts) {
    if (isSubmitted(attempt)) {
      submitted += 1;
      scoreSum += attempt.totalScore;
      totalDurationSec += attempt.durationSec;
    }
    if (attempt.startedAt >= nowTs - RECENT_WINDOW_MS) {
      recent7d += 1;
    }
  }
  return {
    total: attempts.length,
    submitted,
    inProgress: attempts.length - submitted,
    avgScore: submitted === 0 ? null : scoreSum / submitted,
    totalDurationSec,
    recent7d,
  };
}

/** 一套试卷下的全部记录 */
export interface PaperRecordGroup {
  paperId: string;
  /** 试卷标题；试卷已被删除时用兜底文案 */
  title: string;
  /** 组内记录，新→旧 */
  attempts: Attempt[];
  /** 已交卷里的最高总分；全部进行中时为 null */
  bestScore: number | null;
  /** 组内最近一次开始时间 */
  lastAt: Timestamp;
}

/**
 * 按试卷分组。
 *
 * 入参按 startedAt 新→旧排好（listAllActive 保证），组内顺序原样保留，
 * 分组之间按「最近一次作答时间」倒序，保证刚做过的卷排在最上面。
 */
export function groupByPaper(
  attempts: readonly Attempt[],
  titleOf: (paperId: string) => string | undefined,
  fallbackTitle = '已删除的试卷',
): PaperRecordGroup[] {
  const groups = new Map<string, PaperRecordGroup>();
  for (const attempt of attempts) {
    const existing = groups.get(attempt.paperId);
    if (existing) {
      existing.attempts.push(attempt);
      if (isSubmitted(attempt)) {
        existing.bestScore = Math.max(existing.bestScore ?? 0, attempt.totalScore);
      }
      existing.lastAt = Math.max(existing.lastAt, attempt.startedAt);
      continue;
    }
    groups.set(attempt.paperId, {
      paperId: attempt.paperId,
      title: titleOf(attempt.paperId) ?? fallbackTitle,
      attempts: [attempt],
      bestScore: isSubmitted(attempt) ? attempt.totalScore : null,
      lastAt: attempt.startedAt,
    });
  }
  return Array.from(groups.values()).sort((left, right) => right.lastAt - left.lastAt);
}
