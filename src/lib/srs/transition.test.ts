/**
 * T06 验收测试：四档反馈状态转移（SRS-TEST-CASES 第 2 节 44 组全矩阵 + 第 5 节 D1~D9）。
 */
import { describe, expect, test } from 'vitest';

import type { Rating } from '@/types/common';
import type { WordState } from '@/types/word';

import cases44 from '../../../test/fixtures/stateTable.json';
import { transition, type SrsConfig } from './transition';
import { nextStudyDay0400 } from './studyDay';

const MIN = 60_000;
const HR = 60 * MIN;
const DAY = 24 * HR;
const LADDER = [
  5 * MIN, 30 * MIN, 12 * HR, 1 * DAY, 2 * DAY, 4 * DAY, 7 * DAY, 15 * DAY, 30 * DAY, 60 * DAY,
  120 * DAY,
];
const LADDER_KEY = ['5min', '30min', '12h', '1d', '2d', '4d', '7d', '15d', '30d', '60d', '120d'];

const cfg: SrsConfig = {
  maxLevel: 10,
  masterLevel: 8,
  intervalLadder: LADDER,
  dayStartHour: 4,
  maxRetry: 5,
};

/** 固定时刻（注入而非读系统时钟），10:00 远离 04:00 边界 */
const NOW = new Date('2026-10-24T10:00:00+08:00').getTime();

interface FixtureCase {
  id: string;
  initialLevel: number;
  initialLapseCount: number;
  rating: Rating;
  expectedLevel: number;
  expectedDueAt: string;
  expectedQueueAction: 'requeue' | 'dequeue';
  expectedLapseCount: number;
}

function mkState(initialLevel: number, lapseCount: number): WordState {
  return {
    stateKey: 'test-state-key',
    wordId: 'core:test',
    bookId: 'core',
    level: initialLevel,
    dueAt: 0,
    lastRating: null,
    lastReviewAt: null,
    firstLearnedAt: null,
    reviewCount: 0,
    correctCount: 0,
    wrongCount: 0,
    lapseCount,
    retryCountToday: 0,
    retryDay: '2026-10-24',
    unstable: false,
    isStarred: false,
    masteredAt: null,
    updatedAt: 0,
    deletedAt: null,
  };
}

function expectDueAt(actual: number, spec: string): void {
  if (spec === 'nextStudyDay0400') {
    expect(actual).toBe(nextStudyDay0400(NOW, cfg.dayStartHour));
    return;
  }
  const match = /^now \+ (.+)$/.exec(spec);
  expect(match, `fixture 档位写错: ${spec}`).not.toBeNull();
  const key = match?.[1] ?? '';
  const idx = LADDER_KEY.indexOf(key);
  expect(idx, `fixture 档位写错: ${spec}`).toBeGreaterThanOrEqual(0);
  const interval = LADDER[idx] ?? 0;
  expect(actual).toBe(NOW + interval);
}

describe.each(cases44 as FixtureCase[])('$id (L=$initialLevel, rating=$rating)', (c) => {
  const state = mkState(c.initialLevel, c.initialLapseCount);
  const { next, enqueue, gap } = transition(state, c.rating, NOW, cfg);

  test('next.level', () => {
    expect(next.level).toBe(c.expectedLevel);
  });
  test('next.dueAt', () => {
    expectDueAt(next.dueAt, c.expectedDueAt);
  });
  test('next.lapseCount (D1)', () => {
    expect(next.lapseCount).toBe(c.expectedLapseCount);
  });
  test('next.updatedAt = now (D2)', () => {
    expect(next.updatedAt).toBe(NOW);
  });
  test('reviewCount +1 (D3)', () => {
    expect(next.reviewCount).toBe(state.reviewCount + 1);
  });
  test('enqueue', () => {
    expect(enqueue).toBe(c.expectedQueueAction === 'requeue');
  });
  test('gap ∈ [3,5] / 0', () => {
    if (enqueue) {
      expect(gap).toBeGreaterThanOrEqual(3);
      expect(gap).toBeLessThanOrEqual(5);
    } else {
      expect(gap).toBe(0);
    }
  });
  test('masteredAt (D7)', () => {
    if (next.level >= cfg.masterLevel) {
      expect(next.masteredAt).toBe(NOW);
    } else {
      expect(next.masteredAt).toBeNull();
    }
  });
  test('retryCountToday (D5) / unstable (D6)', () => {
    if (c.rating === 1) {
      expect(next.retryCountToday).toBe(1);
      expect(next.unstable).toBe(false); // 首次不认识，未达 MAX_RETRY
    }
  });
  test('纯函数：同参两次调用结果一致 (D9)', () => {
    expect(transition(state, c.rating, NOW, cfg)).toEqual({ next, enqueue, gap });
  });
  test('不修改入参 state（无副作用）', () => {
    expect(state.level).toBe(c.initialLevel);
    expect(state.lapseCount).toBe(c.initialLapseCount);
    expect(state.updatedAt).toBe(0);
  });
});

// ---------- 属性兜底 ----------

describe('属性测试', () => {
  test('monotonic：非「不认识」评分绝不降级（PRD 注 5）', () => {
    for (let l = 0; l <= 10; l++) {
      for (const r of [2, 3, 4] as Rating[]) {
        const { next } = transition(mkState(l, 0), r, NOW, cfg);
        expect(next.level, `L=${l} r=${r}`).toBeGreaterThanOrEqual(l);
      }
    }
  });

  test('invariants：level ∈ [0,10]，dueAt > now', () => {
    for (let l = 0; l <= 10; l++) {
      for (const r of [1, 2, 3, 4] as Rating[]) {
        const { next } = transition(mkState(l, 0), r, NOW, cfg);
        expect(next.level).toBeGreaterThanOrEqual(0);
        expect(next.level).toBeLessThanOrEqual(10);
        expect(next.dueAt).toBeGreaterThan(NOW);
      }
    }
  });

  test('FORGOT 严格归零：任何 L 答「不认识」都到 0', () => {
    for (let l = 0; l <= 10; l++) {
      const { next, enqueue } = transition(mkState(l, 0), 1, NOW, cfg);
      expect(next.level).toBe(0);
      expect(enqueue).toBe(true);
    }
  });
});
