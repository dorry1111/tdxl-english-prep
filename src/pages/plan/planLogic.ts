/**
 * 学习计划页的纯推算逻辑（PRD 5.5）。
 *
 * - 剩余天数 = 考试日 − 今天（按学习日键 'YYYY-MM-DD' 计，天然不受时区影响）；
 * - 每日建议新词 = ceil(剩余词数 / 剩余天数)，下限 1、上限 50；
 * - 预计学完日 = 今天 + ceil(剩余词数 / 每日新词) 天；
 * - 每日总学习量（quota 模式）= 待复习 + 新学，复习优先占满，余量给新词。
 */
import { DEFAULT_DAILY_STUDY_QUOTA, DAILY_STUDY_QUOTA_MAX, DAILY_STUDY_QUOTA_MIN } from '@/constants';
import { dayjs } from '@/lib/dayjs';

/** 每日建议新词上限（防止最后几天被压出「一天 300 词」这种不可执行的计划） */
export const PLAN_DAILY_NEW_CAP = 50;
/** 每日建议新词下限 */
export const PLAN_DAILY_NEW_MIN = 1;
/** 复习压力「偏重」阈值（当前待复习量达到此值即告警） */
export const REVIEW_HEAVY_THRESHOLD = 100;
/** 每日新词量手动设定下限（Settings.newWordLimit 口径 1~200） */
export const NEW_WORD_LIMIT_MIN = 1;
/** 每日新词量手动设定上限 */
export const NEW_WORD_LIMIT_MAX = 200;

/** 收敛手动设定的每日新词量到 [1, 200]（非法输入回退默认 20） */
export function clampNewWordLimit(value: number, fallback = 20): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(NEW_WORD_LIMIT_MAX, Math.max(NEW_WORD_LIMIT_MIN, Math.round(value)));
}

/** 每日总学习量可输入下限（quota 模式，10~500） */
export const DAILY_STUDY_QUOTA_RANGE_MIN = DAILY_STUDY_QUOTA_MIN;
/** 每日总学习量可输入上限 */
export const DAILY_STUDY_QUOTA_RANGE_MAX = DAILY_STUDY_QUOTA_MAX;

/** 收敛每日总学习量到 [10, 500]（非法输入回退默认 50） */
export function clampDailyStudyQuota(
  value: number,
  fallback: number = DEFAULT_DAILY_STUDY_QUOTA,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(DAILY_STUDY_QUOTA_RANGE_MAX, Math.max(DAILY_STUDY_QUOTA_RANGE_MIN, Math.round(value)));
}

/**
 * 生效的每日新词量（展示与取词共用同一口径）：
 * - manual：用户设定值（收敛到 [1, 200]）；
 * - auto：按剩余词数与考试日期推算的建议值；推算不可用（≤0）时回退用户设定值；
 * - quota：总学习量口径，由 resolveDailyNewLimit 结合当日待复习数换算（见 sessionStore）。
 */
export function effectiveDailyNew(
  mode: 'auto' | 'manual' | 'quota',
  manualLimit: number,
  autoSuggestion: number,
): number {
  if (mode === 'manual' || mode === 'quota') {
    return clampNewWordLimit(manualLimit);
  }
  return autoSuggestion > 0 ? autoSuggestion : clampNewWordLimit(manualLimit);
}

/** 解析 'YYYY-MM-DD' 为 dayjs；非法返回 null */
function parseKey(key: string) {
  const parsed = dayjs(key, 'YYYY-MM-DD', true);
  return parsed.isValid() ? parsed : null;
}

/** 剩余天数 = 考试日 − 今天（同一天为 0；非法日期或已过期返回 0） */
export function daysUntil(examDateKey: string, todayKey: string): number {
  const exam = parseKey(examDateKey);
  const today = parseKey(todayKey);
  if (!exam || !today) {
    return 0;
  }
  return Math.max(0, exam.startOf('day').diff(today.startOf('day'), 'day'));
}

/**
 * 每日建议新词数。
 * - 剩余为 0 → 0（已学完，不再需要新词）；
 * - 剩余天数 ≤ 0（已过考试日）→ 取上限，尽快学完；
 * - 否则 ceil(remaining / days)，夹到 [1, cap]。
 */
export function suggestDailyNew(
  remaining: number,
  days: number,
  cap: number = PLAN_DAILY_NEW_CAP,
): number {
  if (remaining <= 0) {
    return 0;
  }
  if (days <= 0) {
    return Math.min(cap, Math.max(PLAN_DAILY_NEW_MIN, remaining));
  }
  const raw = Math.ceil(remaining / days);
  return Math.min(cap, Math.max(PLAN_DAILY_NEW_MIN, raw));
}

/** 预计学完日期键（'YYYY-MM-DD'）；无剩余词或计划为 0 时就是今天 */
export function estimatedFinishDateKey(
  todayKey: string,
  remaining: number,
  dailyNew: number,
): string {
  const today = parseKey(todayKey);
  if (!today || remaining <= 0 || dailyNew <= 0) {
    return todayKey;
  }
  const days = Math.ceil(remaining / dailyNew);
  return today.add(days, 'day').format('YYYY-MM-DD');
}

/** 预计学完日晚于考试日 → 红色告警 */
export function willMissDeadline(finishDateKey: string, examDateKey: string): boolean {
  const finish = parseKey(finishDateKey);
  const exam = parseKey(examDateKey);
  if (!finish || !exam) {
    return false;
  }
  return finish.startOf('day').isAfter(exam.startOf('day'));
}

/** 复习压力档位：按当前待复习量给一个可展示的等级 */
export type ReviewPressure = 'none' | 'light' | 'heavy';

export function reviewPressureOf(
  dueNow: number,
  heavyThreshold: number = REVIEW_HEAVY_THRESHOLD,
): ReviewPressure {
  if (dueNow <= 0) {
    return 'none';
  }
  return dueNow >= heavyThreshold ? 'heavy' : 'light';
}
