/**
 * 基础类型（ARCHITECTURE 3.1）。
 * 这一层不允许 import 其他非类型模块。
 */

/** 四档反馈：1 不认识 / 2 模糊 / 3 认识 / 4 熟识 */
export type Rating = 1 | 2 | 3 | 4;

export const RATING = {
  FORGOT: 1,
  VAGUE: 2,
  KNOWN: 3,
  MASTERED: 4,
} as const satisfies Record<string, Rating>;

/** 熟练度等级 0~10 */
export type Level = number;

/** 所有时间戳一律为 UTC 毫秒数（number），显示时才转本地 */
export type Timestamp = number;

/** 学习日，本地时区下的 YYYY-MM-DD（按 DAY_START_HOUR 折算后的日期） */
export type StudyDayKey = string;

export type EntityId = string;

/** 所有可同步实体的公共字段 */
export interface Syncable {
  updatedAt: Timestamp;
  /** 墓碑：null 表示未删除；非 null 表示已删除的时间 */
  deletedAt: Timestamp | null;
}

/** 全项目统一的结果包装（仓库层返回，不抛异常的场景） */
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppErrorShape };

export interface AppErrorShape {
  code: string;
  message: string;
  detail?: unknown;
}

/** 主题三态：跟随系统 / 浅色 / 深色 */
export type ThemeMode = 'auto' | 'light' | 'dark';

/** 背景颜色主题（浅色态的底色风格；深色态不受影响） */
export type BgTheme = 'classic' | 'green' | 'paper' | 'gray';
