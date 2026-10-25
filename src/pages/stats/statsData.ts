/**
 * /stats 统计总览页的纯函数层（脱离 DOM / 数据库可测）。
 *
 * 口径约定：
 * - 记忆度：只统计「已开始学习」的词（lastRating 非空、未删），按最近一次评分分三档；
 * - 遗忘曲线保持率：当日「有活动」（当日有 ReviewLog 或当日首次学习）的词中，
 *   现在 lastRating ∈ {3, 4}（认识 / 熟识）的占比；
 * - 学习情况：按学习日键逐日取 StudyDay 的 newLearned / reviewed，缺日补 0。
 */
import { studyDayOf } from '@/lib/srs/studyDay';
import { previousDayKey } from './statsLogic';
import type { Rating, ReviewLog, StudyDay } from '@/types';
import type { WordState } from '@/types';

// ---------- 记忆度 ----------

/** 记忆度三档计数（分母 = 三档总数） */
export interface MemoryDistribution {
  /** 记忆：最近评分 3 / 4 */
  remembered: number;
  /** 模糊：最近评分 2 */
  fuzzy: number;
  /** 陌生：最近评分 1 */
  forgotten: number;
  /** 三档总数（已开始学习且未删的词） */
  total: number;
}

/**
 * 记忆度分档计数。
 *
 * 只数「已开始学习」的词：lastRating 非空即进入过调度；
 * 软删除（deletedAt 非空）的词不计入任何一档。
 */
export function memoryDistributionOf(states: readonly WordState[]): MemoryDistribution {
  const dist: MemoryDistribution = { remembered: 0, fuzzy: 0, forgotten: 0, total: 0 };
  for (const state of states) {
    if (state.deletedAt !== null || state.lastRating === null) {
      continue;
    }
    dist.total += 1;
    if (state.lastRating === 3 || state.lastRating === 4) {
      dist.remembered += 1;
    } else if (state.lastRating === 2) {
      dist.fuzzy += 1;
    } else if (state.lastRating === 1) {
      dist.forgotten += 1;
    }
  }
  return dist;
}

/** 记忆度三档百分比（0~100，四舍五入；保证三者和恒为 100，无人学习时全 0） */
export interface MemoryPercents {
  remembered: number;
  fuzzy: number;
  forgotten: number;
}

export function memoryPercentsOf(dist: MemoryDistribution): MemoryPercents {
  if (dist.total <= 0) {
    return { remembered: 0, fuzzy: 0, forgotten: 0 };
  }
  const remembered = Math.round((dist.remembered / dist.total) * 100);
  const fuzzy = Math.round((dist.fuzzy / dist.total) * 100);
  // 末档用减法兜底，避免两个 33.5% 四舍五入后和不到 100
  const forgotten = Math.max(0, 100 - remembered - fuzzy);
  return { remembered, fuzzy, forgotten };
}

// ---------- 时间范围 ----------

/** 时间范围档位（天数） */
export type StatsRangeDays = 7 | 30 | 90;

/**
 * 以 todayKey 为结尾、共 days 天的学习日键数组（升序，index 0 最早）。
 * 范围切片统一走这里，曲线与柱状图共用同一条时间轴。
 */
export function dayKeysOfRange(todayKey: string, days: StatsRangeDays): string[] {
  const keys: string[] = [];
  let cursor = todayKey;
  for (let index = 0; index < days; index += 1) {
    keys.push(cursor);
    cursor = previousDayKey(cursor);
  }
  return keys.reverse();
}

// ---------- 学习情况（双系列柱状图） ----------

/** 柱状图单日数据 */
export interface DaySeriesPoint {
  dayKey: string;
  newLearned: number;
  reviewed: number;
}

/**
 * 逐日新学 / 复习序列：范围内每一天一根（StudyDay 缺失补 0），
 * 范围外的记录不进序列（范围切片）。
 */
export function studyDaySeries(
  days: readonly StudyDay[],
  dayKeys: readonly string[],
): DaySeriesPoint[] {
  const byKey = new Map<string, StudyDay>();
  for (const day of days) {
    if (day.deletedAt === null) {
      byKey.set(day.studyDay, day);
    }
  }
  return dayKeys.map((dayKey) => {
    const day = byKey.get(dayKey);
    return {
      dayKey,
      newLearned: day?.newLearned ?? 0,
      reviewed: day?.reviewed ?? 0,
    };
  });
}

/** 双系列的最大值（空序列或全 0 时为 0，柱状图判空用） */
export function seriesMax(points: readonly DaySeriesPoint[]): number {
  return points.reduce(
    (max, point) => Math.max(max, point.newLearned, point.reviewed),
    0,
  );
}

// ---------- 艾宾浩斯遗忘曲线 ----------

/** 遗忘曲线单日数据 */
export interface RetentionPoint {
  dayKey: string;
  /** 当日保持率 0~100；当日无活动为 null（折线图断开处） */
  retention: number | null;
  /** 当日有活动的词数（现存且未删） */
  activeCount: number;
  /** 其中现在仍记得（lastRating ∈ {3,4}）的词数 */
  rememberedCount: number;
}

/** 判断评分是否算「记得」（认识 / 熟识） */
function isRemembered(rating: Rating | null | undefined): boolean {
  return rating === 3 || rating === 4;
}

/**
 * 范围内每日保持率。
 *
 * 「当日有活动」= 当日的 ReviewLog.answeredAt，或当日的 firstLearnedAt；
 * 分母只算现存（未删）的词——已删的词没有「现在的评分」，不该稀释保持率。
 *
 * @param dayKeys   时间范围（dayKeysOfRange 的输出，升序）
 * @param dayStartHour 学习日边界小时（04:00 前算前一天）
 * @param states    全量 wordStates（几千条，内存计算）
 * @param logs      范围内的 ReviewLog（调用方按索引区间取）
 */
export function retentionCurveOf(params: {
  dayKeys: readonly string[];
  dayStartHour: number;
  states: readonly WordState[];
  logs: readonly ReviewLog[];
}): RetentionPoint[] {
  const { dayKeys, dayStartHour, states, logs } = params;

  // 现存词的「现在评分」与「首学日」一次遍历建好
  const ratingOf = new Map<string, Rating | null>();
  const firstDayOf = new Map<string, string>();
  for (const state of states) {
    if (state.deletedAt !== null) {
      continue;
    }
    ratingOf.set(state.stateKey, state.lastRating);
    if (state.firstLearnedAt !== null) {
      firstDayOf.set(state.stateKey, studyDayOf(state.firstLearnedAt, dayStartHour));
    }
  }

  // 当日有活动的 stateKey 集合（只收现存词）
  const activeByDay = new Map<string, Set<string>>();
  const markActive = (dayKey: string, stateKey: string): void => {
    if (!ratingOf.has(stateKey)) {
      return; // 已删的词不进分母
    }
    const bucket = activeByDay.get(dayKey) ?? new Set<string>();
    bucket.add(stateKey);
    activeByDay.set(dayKey, bucket);
  };
  for (const log of logs) {
    markActive(studyDayOf(log.answeredAt, dayStartHour), log.stateKey);
  }
  for (const [stateKey, dayKey] of firstDayOf) {
    markActive(dayKey, stateKey);
  }

  return dayKeys.map((dayKey) => {
    const active = activeByDay.get(dayKey);
    if (active === undefined || active.size === 0) {
      return { dayKey, retention: null, activeCount: 0, rememberedCount: 0 };
    }
    let rememberedCount = 0;
    for (const stateKey of active) {
      if (isRemembered(ratingOf.get(stateKey))) {
        rememberedCount += 1;
      }
    }
    return {
      dayKey,
      retention: Math.round((rememberedCount / active.size) * 100),
      activeCount: active.size,
      rememberedCount,
    };
  });
}
