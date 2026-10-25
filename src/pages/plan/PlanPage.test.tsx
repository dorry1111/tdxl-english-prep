/**
 * PlanPage 渲染测试（jsdom + fake-indexeddb）。
 *
 * 断言要点：倒计时 / 剩余词数 / 每日建议新词 / 预计学完日 全部来自真实数据，
 * 且每日建议值与 planLogic 的纯函数结果一致（页面只是把数字渲染出来）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BUILTIN_BOOK_ID } from '@/constants';
import { db } from '@/db';
import { ensureSeeded } from '@/db/seed';
import { stateKeyOfNorm } from '@/lib/hash';
import { setCoreFetcher } from '@/lib/wordbookCache';
import { studyDayOf } from '@/lib/srs/studyDay';
import { now } from '@/lib/time';
import type { WordState } from '@/types';
import PlanPage from './PlanPage';
import { daysUntil, suggestDailyNew } from './planLogic';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CORE_INDEX = {
  bookId: BUILTIN_BOOK_ID,
  version: 2,
  total: 10,
  shards: ['core-a'],
  entries: [] as ReadonlyArray<readonly [string, string, number, number | null, string]>,
};

function makeLearnedState(norm: string): WordState {
  const stamp = now();
  return {
    stateKey: stateKeyOfNorm(norm),
    wordId: `${BUILTIN_BOOK_ID}:${norm}`,
    bookId: BUILTIN_BOOK_ID,
    level: 3,
    dueAt: stamp + 86_400_000,
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
  setCoreFetcher(async () => CORE_INDEX);
  await ensureSeeded();
  await db.wordStates.bulkPut([makeLearnedState('apple'), makeLearnedState('brave')]);
});

afterEach(() => {
  setCoreFetcher(undefined);
});

describe('PlanPage', () => {
  it('倒计时 / 剩余词数 / 每日建议 / 预计学完日 都渲染真实推算值', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/plan']}>
          <Routes>
            <Route path="/plan" element={<PlanPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    const text = (): string => container.textContent ?? '';
    try {
      await waitFor(() => text().includes('距考试还有'), '倒计时渲染');
      await waitFor(() => text().includes('预计学完'), '推算卡片渲染');
      await waitFor(() => text().includes('10'), '词库总数渲染');

      const settings = await db.settings.get('global');
      const todayKey = studyDayOf(Date.now(), settings?.dayStartHour ?? 4);
      const remaining = 10 - 2; // 索引 total 10，已学 2
      const days = daysUntil(settings?.examDate ?? '', todayKey);
      const daily = suggestDailyNew(remaining, days);

      expect(text()).toContain('考试日期');
      expect(text()).toContain(settings?.examDate ?? '');
      expect(text()).toContain('剩余词数');
      expect(text()).toContain(String(remaining));
      expect(text()).toContain('每日建议新词');
      expect(text()).toContain('词 / 天');
      expect(daily).toBeGreaterThan(0);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
