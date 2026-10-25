/**
 * statsData 纯函数测试（记忆度分档 / 保持率 / 范围切片 / 空数据边界）。
 *
 * 全部用内存对象，不碰数据库：这一层就是为「脱离 DOM 与 IndexedDB 可测」而存在。
 */
import { describe, expect, it } from 'vitest';

import { BUILTIN_BOOK_ID } from '@/constants';
import { stateKeyOfNorm } from '@/lib/hash';
import { dayjs } from '@/lib/dayjs';
import { now } from '@/lib/time';
import type { Rating, ReviewLog, StudyDay, WordState } from '@/types';
import {
  dayKeysOfRange,
  memoryDistributionOf,
  memoryPercentsOf,
  retentionCurveOf,
  seriesMax,
  studyDaySeries,
} from './statsData';
import { createEmptyDay } from '@/db/repos/dayRepo';

/** 构造一条学习状态（只填统计用到的字段，其余补默认值） */
function makeState(
  norm: string,
  options: {
    lastRating?: Rating | null;
    firstLearnedAt?: number | null;
    deleted?: boolean;
  } = {},
): WordState {
  const stamp = now();
  return {
    stateKey: stateKeyOfNorm(norm),
    wordId: `${BUILTIN_BOOK_ID}:${norm}`,
    bookId: BUILTIN_BOOK_ID,
    level: 1,
    dueAt: stamp + 86_400_000,
    lastRating: options.lastRating ?? null,
    lastReviewAt: options.lastRating != null ? stamp : null,
    firstLearnedAt:
      options.firstLearnedAt === undefined
        ? options.lastRating != null
          ? stamp
          : null
        : options.firstLearnedAt,
    reviewCount: 0,
    correctCount: 0,
    wrongCount: 0,
    lapseCount: 0,
    retryCountToday: 0,
    retryDay: '2020-01-01',
    unstable: false,
    isStarred: false,
    masteredAt: null,
    updatedAt: stamp,
    deletedAt: options.deleted ? stamp : null,
  };
}

/** 构造一条答题流水 */
function makeLog(norm: string, answeredAt: number, rating: Rating = 3): ReviewLog {
  return {
    id: `log-${norm}-${answeredAt}`,
    wordId: `${BUILTIN_BOOK_ID}:${norm}`,
    stateKey: stateKeyOfNorm(norm),
    sessionId: 'sess-1',
    rating,
    prevLevel: 0,
    newLevel: 1,
    prevDueAt: 0,
    newDueAt: answeredAt + 86_400_000,
    answeredAt,
    durationMs: 800,
    isRetry: false,
    deviceId: 'dev_test',
  };
}

describe('memoryDistributionOf 记忆度分档', () => {
  it('按最近评分三档计数，lastRating 为空与已删的词不计入', () => {
    const states = [
      makeState('a', { lastRating: 4 }),
      makeState('b', { lastRating: 3 }),
      makeState('c', { lastRating: 2 }),
      makeState('d', { lastRating: 1 }),
      makeState('e', { lastRating: 1 }),
      makeState('never'), // 未开始学习
      makeState('gone', { lastRating: 3, deleted: true }), // 已删
    ];
    expect(memoryDistributionOf(states)).toEqual({
      remembered: 2,
      fuzzy: 1,
      forgotten: 2,
      total: 5,
    });
  });

  it('全空数据：total 为 0，百分比全 0', () => {
    const dist = memoryDistributionOf([]);
    expect(dist).toEqual({ remembered: 0, fuzzy: 0, forgotten: 0, total: 0 });
    expect(memoryPercentsOf(dist)).toEqual({ remembered: 0, fuzzy: 0, forgotten: 0 });
  });
});

describe('memoryPercentsOf 百分比', () => {
  it('三档百分比和恒为 100（含四舍五入兜底）', () => {
    // 1/3 → 33.33%：两档 33.33% 四舍五入成 33 + 33，末档兜底成 34
    const percents = memoryPercentsOf({ remembered: 1, fuzzy: 1, forgotten: 1, total: 3 });
    expect(percents.remembered + percents.fuzzy + percents.forgotten).toBe(100);
    expect(percents).toEqual({ remembered: 33, fuzzy: 33, forgotten: 34 });
  });

  it('单一档占满时为 100 / 0 / 0', () => {
    const percents = memoryPercentsOf({ remembered: 7, fuzzy: 0, forgotten: 0, total: 7 });
    expect(percents).toEqual({ remembered: 100, fuzzy: 0, forgotten: 0 });
  });
});

describe('dayKeysOfRange 范围切片', () => {
  it('以今天结尾、共 N 天、升序', () => {
    expect(dayKeysOfRange('2026-11-10', 7)).toEqual([
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
    ]);
    expect(dayKeysOfRange('2026-11-10', 30)).toHaveLength(30);
    expect(dayKeysOfRange('2026-11-10', 30)[0]).toBe('2026-10-12');
    expect(dayKeysOfRange('2026-01-02', 90)[0]).toBe('2025-10-05');
  });
});

describe('studyDaySeries 逐日序列', () => {
  it('范围内缺日补 0，范围外记录被切掉', () => {
    const dayKeys = ['2026-11-09', '2026-11-10'];
    const days: StudyDay[] = [
      { ...createEmptyDay('2026-11-10', now()), newLearned: 3, reviewed: 5 },
      { ...createEmptyDay('2026-11-08', now()), newLearned: 9, reviewed: 9 }, // 范围外
      { ...createEmptyDay('2026-11-10', now()), deletedAt: now() }, // 软删除重复键
    ];
    const series = studyDaySeries(days, dayKeys);
    expect(series).toEqual([
      { dayKey: '2026-11-09', newLearned: 0, reviewed: 0 },
      { dayKey: '2026-11-10', newLearned: 3, reviewed: 5 },
    ]);
    expect(seriesMax(series)).toBe(5);
    expect(seriesMax([])).toBe(0);
  });
});

describe('retentionCurveOf 保持率', () => {
  const dayKeys = ['2026-11-09', '2026-11-10'];
  const dayStartHour = 4;
  const day9 = dayjs('2026-11-09 08:00:00', 'YYYY-MM-DD HH:mm:ss').valueOf();
  const day10 = dayjs('2026-11-10 08:00:00', 'YYYY-MM-DD HH:mm:ss').valueOf();

  it('当日有活动的词中，现在仍记得的占比（四舍五入）', () => {
    const states = [
      makeState('keep1', { lastRating: 4, firstLearnedAt: day9 }),
      makeState('keep2', { lastRating: 3, firstLearnedAt: day9 }),
      makeState('lost', { lastRating: 1, firstLearnedAt: day9 }),
      makeState('again', { lastRating: 2, firstLearnedAt: day10 }),
    ];
    // 11-09：首次学习 3 词；11-10：首次学习 again + 重答 keep1（同一词不新增分母）
    const logs = [makeLog('keep1', day10, 4)];
    const curve = retentionCurveOf({ dayKeys, dayStartHour, states, logs });
    expect(curve).toHaveLength(2);
    expect(curve[0]).toEqual({
      dayKey: '2026-11-09',
      retention: 67, // 2/3
      activeCount: 3,
      rememberedCount: 2,
    });
    expect(curve[1]).toEqual({
      dayKey: '2026-11-10',
      retention: 50, // keep1（记得）+ again（模糊）→ 1/2
      activeCount: 2,
      rememberedCount: 1,
    });
  });

  it('模糊（2）不算记得：当日仅模糊词时保持率 0', () => {
    const states = [makeState('fuzzy', { lastRating: 2, firstLearnedAt: day10 })];
    const curve = retentionCurveOf({ dayKeys, dayStartHour, states, logs: [] });
    expect(curve[1]?.retention).toBe(0);
    expect(curve[1]?.activeCount).toBe(1);
  });

  it('当日无活动 → retention 为 null（折线断开）', () => {
    const states = [makeState('old', { lastRating: 3, firstLearnedAt: day9 })];
    const curve = retentionCurveOf({ dayKeys: ['2026-11-10'], dayStartHour, states, logs: [] });
    expect(curve).toEqual([
      { dayKey: '2026-11-10', retention: null, activeCount: 0, rememberedCount: 0 },
    ]);
  });

  it('已删的词不进分母（没有「现在的评分」）', () => {
    const states = [
      makeState('alive', { lastRating: 3, firstLearnedAt: day10 }),
      makeState('dead', { lastRating: 1, firstLearnedAt: day10, deleted: true }),
    ];
    const curve = retentionCurveOf({ dayKeys: ['2026-11-10'], dayStartHour, states, logs: [] });
    expect(curve[0]).toEqual({
      dayKey: '2026-11-10',
      retention: 100,
      activeCount: 1,
      rememberedCount: 1,
    });
  });

  it('单点曲线：只有一天有活动时也给出一个有效点', () => {
    const states = [makeState('solo', { lastRating: 4, firstLearnedAt: day10 })];
    const curve = retentionCurveOf({ dayKeys: ['2026-11-10'], dayStartHour, states, logs: [] });
    expect(curve).toHaveLength(1);
    expect(curve[0]?.retention).toBe(100);
  });

  it('全空数据：所有日都是 null', () => {
    const curve = retentionCurveOf({ dayKeys, dayStartHour, states: [], logs: [] });
    expect(curve.map((point) => point.retention)).toEqual([null, null]);
  });
});
