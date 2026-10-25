/**
 * 统计与计划域类型（ARCHITECTURE 3.5）。
 */
import type { StudyDayKey, Syncable, Timestamp } from './common';

/** 日汇总（打卡与统计的唯一口径来源） */
export interface StudyDay extends Syncable {
  /** 主键 YYYY-MM-DD */
  studyDay: StudyDayKey;
  /** 去重词数 */
  newLearned: number;
  reviewed: number;
  /** 答题次数 / 其中答对次数（rating 3 或 4） */
  answerCount: number;
  correctCount: number;
  durationSec: number;
  retryAnswers: number;
}

/** 首页/统计页用的一组只读指标（由 lib/srs/stats.ts 纯函数算出） */
export interface DailyStats {
  studyDay: StudyDayKey;
  newLearnedToday: number;
  reviewedToday: number;
  dueReviewCount: number;
  masteredCount: number;
  totalLearnedCount: number;
  /** 正确率 0~1，今日无答题时为 null */
  accuracyToday: number | null;
  streakDays: number;
  /** 未来 7 天每日到期量，index 0 = 今天 */
  dueForecast: Array<{ studyDay: StudyDayKey; count: number }>;
  unstableCount: number;
  totalDurationSec: number;
}

/** 计划推算结果（PRD 5.5） */
export interface PlanEstimate {
  /** 距考试自然天数 D_total */
  daysToExam: number;
  /** 有效天数 D_eff */
  effectiveDays: number;
  /** 剩余待学词数 W_remain */
  remainingWords: number;
  /** 自动推算的每日新词 autoNew */
  autoNew: number;
  /** 实际生效值（手动覆盖优先） */
  effectiveNew: number;
  /** 预计学完日期 YYYY-MM-DD */
  estimatedFinishDate: StudyDayKey;
  /** 是否晚于 EXAM_DATE - RESERVE_DAYS */
  willMissDeadline: boolean;
  /** 复习量超限时的提示文案，null 表示正常 */
  reviewLoadWarning: string | null;
  manualOverride: number | null;
  computedAt: Timestamp;
}
