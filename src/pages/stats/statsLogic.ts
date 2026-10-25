/**
 * 单词统计页的纯逻辑（连续打卡与柱状图比例，脱离 DOM 可测）。
 *
 * 连续打卡口径（PRD 5.6）：
 * - 今天有答题记录 → 从今天往前数；今天还没有 → 从昨天往前数（今天还没背不算断）；
 * - 中断一天即止。
 */
import { dayjs } from '@/lib/dayjs';

/** 取某个日期键的前一天（'YYYY-MM-DD'）。用 dayjs 而非 new Date：iOS Safari 对日期串按 UTC 解析 */
export function previousDayKey(dayKey: string): string {
  const parsed = dayjs(dayKey, 'YYYY-MM-DD', true);
  const base = parsed.isValid() ? parsed : dayjs();
  return base.subtract(1, 'day').format('YYYY-MM-DD');
}

/** 取某个日期键的次日（'YYYY-MM-DD'），未来 7 天柱状图切分用 */
export function nextDayKey(dayKey: string): string {
  const parsed = dayjs(dayKey, 'YYYY-MM-DD', true);
  const base = parsed.isValid() ? parsed : dayjs();
  return base.add(1, 'day').format('YYYY-MM-DD');
}

/** 连续打卡天数 */
export function computeStreak(answerDays: readonly string[], todayKey: string): number {
  const set = new Set(answerDays);
  if (set.size === 0) {
    return 0;
  }
  let cursor = set.has(todayKey) ? todayKey : previousDayKey(todayKey);
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = previousDayKey(cursor);
  }
  return streak;
}

/** 柱状图柱高百分比（最大值 0 时全部为 0，避免除零） */
export function barHeightPercent(count: number, max: number): number {
  if (max <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((count / max) * 100));
}

/** 柱状图最大值（空数组时为 0） */
export function maxOf(counts: readonly number[]): number {
  return counts.reduce((max, count) => (count > max ? count : max), 0);
}
