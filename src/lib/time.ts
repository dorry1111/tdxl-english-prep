/**
 * 时间工具（ARCHITECTURE 7.5）。
 *
 * 硬约定：
 * - 存储一律 UTC 毫秒数，显示时才转本地；
 * - 页面不得直接 `new Date()`；日期字符串统一用 dayjs 严格解析
 *   （`new Date('2027-05-16')` 在 Safari 里按 UTC 解析，会差 8 小时）；
 * - 调度相关的纯函数（lib/srs/*）必须显式接收 now，禁止内部取当前时间。
 */
import { DAY_START_HOUR, MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '@/constants';

import { dayjs } from './dayjs';

/** 当前时间戳（毫秒）。全项目取「现在」的唯一入口。 */
export function now(): number {
  return Date.now();
}

/** 格式化时间戳，默认 'YYYY-MM-DD HH:mm' */
export function fmtDate(ts: number, pattern = 'YYYY-MM-DD HH:mm'): string {
  return dayjs(ts).format(pattern);
}

/** 格式化学习日键（'YYYY-MM-DD'）为展示文案 */
export function fmtDateKey(key: string, pattern = 'YYYY-MM-DD'): string {
  const parsed = dayjs(key, 'YYYY-MM-DD', true);
  return parsed.isValid() ? parsed.format(pattern) : key;
}

/**
 * 把秒数格式化为中文时长。
 * 例：90 → '1 分 30 秒'；3720 → '1 小时 2 分'；45 → '45 秒'
 */
export function fmtDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
  }
  if (minutes > 0) {
    return secs > 0 && minutes < 10 ? `${minutes} 分 ${secs} 秒` : `${minutes} 分`;
  }
  return `${secs} 秒`;
}

/**
 * 距离「下一个学习日边界（默认 04:00）」还有多少毫秒。
 *
 * 注意：若当前时间早于 04:00，返回的是「今天 04:00」而不是明天，
 * 因为此时当前时刻仍属于前一个学习日，下一个学习日从今天 04:00 开始。
 */
export function msToNext0400(fromTs: number = now(), dayStartHour: number = DAY_START_HOUR): number {
  const base = dayjs(fromTs);
  const boundaryToday = base.hour(dayStartHour).minute(0).second(0).millisecond(0);
  const nextBoundary =
    boundaryToday.valueOf() > fromTs ? boundaryToday : boundaryToday.add(1, 'day');
  return nextBoundary.valueOf() - fromTs;
}

/** 严格解析 'YYYY-MM-DD' 为毫秒时间戳（本地时区当天 00:00）；非法返回 null */
export function parseDateKey(key: string): number | null {
  const parsed = dayjs(key, 'YYYY-MM-DD', true);
  return parsed.isValid() ? parsed.valueOf() : null;
}

/** 给毫秒数加上 n 个自然日 */
export function addDays(ts: number, days: number): number {
  return ts + days * MS_PER_DAY;
}

/** 给毫秒数加上 n 小时 / 分钟，便于阅读过渡代码 */
export function addHours(ts: number, hours: number): number {
  return ts + hours * MS_PER_HOUR;
}

export function addMinutes(ts: number, minutes: number): number {
  return ts + minutes * MS_PER_MINUTE;
}
