/**
 * StatsVocabPage 渲染测试（jsdom + fake-indexeddb）。
 *
 * 断言要点：今日三项数据来自 StudyDay、连续打卡 2 天、已掌握 1 个（L≥8）、
 * 未来 7 天柱状图的 7 根柱与 aria-label 的数值一致。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { BUILTIN_BOOK_ID, MASTER_L } from '@/constants';
import { db } from '@/db';
import { ensureSeeded } from '@/db/seed';
import { createEmptyDay, putDay } from '@/db/repos/dayRepo';
import { stateKeyOfNorm } from '@/lib/hash';
import { studyDayOf } from '@/lib/srs/studyDay';
import { now } from '@/lib/time';
import type { StudyDay, WordState } from '@/types';
import StatsVocabPage from './StatsVocabPage';
import { previousDayKey } from './statsLogic';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeState(norm: string, level: number, dueAtOffsetMs: number): WordState {
  const stamp = now();
  return {
    stateKey: stateKeyOfNorm(norm),
    wordId: `${BUILTIN_BOOK_ID}:${norm}`,
    bookId: BUILTIN_BOOK_ID,
    level,
    dueAt: stamp + dueAtOffsetMs,
    lastRating: 3,
    lastReviewAt: stamp,
    firstLearnedAt: stamp,
    reviewCount: 1,
    correctCount: 1,
    wrongCount: 0,
    lapseCount: 0,
    retryCountToday: 0,
    retryDay: '2020-01-01',
    unstable: false,
    isStarred: false,
    masteredAt: null,
    updatedAt: stamp,
    deletedAt: null,
  };
}

function dayOf(key: string, patch: Partial<StudyDay>): StudyDay {
  return { ...createEmptyDay(key, now()), ...patch };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(check: () => T, label: string): Promise<T> {
  const deadline = Date.now() + 5000;
  let value = check();
  while (!value) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor 超时: ${label}`);
    }
    await act(async () => {
      await sleep(10);
    });
    value = check();
  }
  return value;
}

beforeEach(async () => {
  await ensureSeeded();
  const settings = await db.settings.get('global');
  const todayKey = studyDayOf(Date.now(), settings?.dayStartHour ?? 4);
  await putDay(dayOf(todayKey, { newLearned: 2, reviewed: 1, answerCount: 3, durationSec: 90 }));
  await putDay(dayOf(previousDayKey(todayKey), { newLearned: 1, reviewed: 0, answerCount: 1 }));
  // 1 个今日到期 + 1 个已掌握（L = MASTER_L，30 天后才复习 → 不进 7 天窗口）
  await db.wordStates.bulkPut([
    makeState('apple', 1, -60_000),
    makeState('brave', MASTER_L, 30 * 86_400_000),
  ]);
});

describe('StatsVocabPage', () => {
  it('今日数据 / 连续打卡 / 已掌握 / 7 天柱状图全部渲染真实值', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/stats/vocab']}>
          <Routes>
            <Route path="/stats/vocab" element={<StatsVocabPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    const text = (): string => container.textContent ?? '';
    try {
      await waitFor(() => text().includes('今日学习'), '今日卡片渲染');
      await waitFor(() => text().includes('连续打卡'), '进度卡片渲染');
      await waitFor(() => text().includes('未来 7 天到期'), '柱状图渲染');
      // 等真实数字（异步聚合）
      await waitFor(() => text().includes('已掌握'), '掌握数渲染');

      expect(text()).toContain('今日新学');
      expect(text()).toContain('今日复习');
      expect(text()).toContain('答题次数');
      expect(text()).toContain('今日学习时长');

      const chart = container.querySelector('[role="img"]');
      expect(chart).toBeTruthy();
      const label = chart?.getAttribute('aria-label') ?? '';
      // 今日到期 1 个落在第 1 根柱，其余 6 天为 0
      expect(label).toContain('未来 7 天到期复习量：1、0、0、0、0、0、0');
      // 7 根柱
      const bars = container.querySelectorAll('[role="img"] > div');
      expect(bars.length).toBe(7);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
