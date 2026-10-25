/**
 * 学习日边界计算（ARCHITECTURE T06 / SRS-TEST-CASES 5.2）。
 *
 * 硬约定：
 * - 纯函数，显式接收 ts / now，禁止内部取当前时间；
 * - 不引日期库，用本地时区的 Date 手算（存储仍是 UTC 毫秒，只有"日边界"按本地时区切）；
 * - 学习日边界默认 04:00（凌晨 4 点前属于前一个学习日）。
 */
import type { StudyDayKey, Timestamp } from '../../types/common';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDay(y: number, m: number, d: number): StudyDayKey {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

/**
 * 某时刻属于哪个学习日。
 * 当日小时数 < dayStartHour 视为前一天的学习日（凌晨 3 点算昨天）。
 */
export function studyDayOf(ts: Timestamp, dayStartHour: number): StudyDayKey {
  const d = new Date(ts);
  const back = d.getHours() < dayStartHour ? 1 : 0;
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
  return formatDay(day.getFullYear(), day.getMonth(), day.getDate());
}

/** 学习日 keys 的当日 0 点起点的本地时刻，再推到 dayStartHour 整点。 */
export function studyDayStart(day: StudyDayKey, dayStartHour: number): Timestamp {
  const parts = day.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = (parts[1] ?? 1) - 1;
  const d = parts[2] ?? 1;
  return new Date(y, m, d, dayStartHour, 0, 0, 0).getTime();
}

/**
 * 下一个学习日边界时刻（默认次日 04:00）。
 *
 * 关键边界（TC-B01/B02）：
 * - 03:59 → 学习日仍是昨天 → 明天 04:00 恰好是"今天 04:00"；
 * - 04:00 整 → 学习日是今天 → 明天 04:00。
 */
export function nextStudyDay0400(now: Timestamp, dayStartHour: number): Timestamp {
  const current = studyDayOf(now, dayStartHour);
  const parts = current.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = (parts[1] ?? 1) - 1;
  const d = parts[2] ?? 1;
  const next = new Date(y, m, d + 1, dayStartHour, 0, 0, 0);
  return next.getTime();
}
