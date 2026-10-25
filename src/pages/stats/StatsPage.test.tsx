/**
 * StatsPage 渲染冒烟测试（jsdom + fake-indexeddb）。
 *
 * 断言要点：顶部长横条三指标（总词汇量 / 总学习时间 / 记忆度三档百分比）、
 * 两个功能区标题与时间范围二级菜单、遗忘曲线折线与双系列柱状图都渲染真实值。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { BUILTIN_BOOK_ID } from '@/constants';
import { db } from '@/db';
import { ensureSeeded } from '@/db/seed';
import { createEmptyDay, putDay } from '@/db/repos/dayRepo';
import { stateKeyOfNorm } from '@/lib/hash';
import { studyDayOf, studyDayStart } from '@/lib/srs/studyDay';
import { now } from '@/lib/time';
import type { Rating, ReviewLog, StudyDay, WordState } from '@/types';
import StatsPage from './StatsPage';
import { previousDayKey } from './statsLogic';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeState(
  norm: string,
  options: { lastRating: Rating; firstLearnedAt: number },
): WordState {
  const stamp = now();
  return {
    stateKey: stateKeyOfNorm(norm),
    wordId: `${BUILTIN_BOOK_ID}:${norm}`,
    bookId: BUILTIN_BOOK_ID,
    level: 1,
    dueAt: stamp + 86_400_000,
    lastRating: options.lastRating,
    lastReviewAt: stamp,
    firstLearnedAt: options.firstLearnedAt,
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

function makeLog(norm: string, answeredAt: number): ReviewLog {
  return {
    id: `log-${norm}-${answeredAt}`,
    wordId: `${BUILTIN_BOOK_ID}:${norm}`,
    stateKey: stateKeyOfNorm(norm),
    sessionId: 'sess-1',
    rating: 3,
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
  const dayStartHour = settings?.dayStartHour ?? 4;
  const todayKey = studyDayOf(Date.now(), dayStartHour);
  const yesterdayKey = previousDayKey(todayKey);
  const todayAt = studyDayStart(todayKey, dayStartHour) + 8 * 60 * 60 * 1000;
  const yesterdayAt = studyDayStart(yesterdayKey, dayStartHour) + 8 * 60 * 60 * 1000;

  // 两天学习日汇总（今日 3 新 / 5 复习 / 90 秒；昨日 2 新 / 1 复习 / 60 秒）
  await putDay(dayOf(todayKey, { newLearned: 3, reviewed: 5, answerCount: 8, durationSec: 90 }));
  await putDay(
    dayOf(yesterdayKey, { newLearned: 2, reviewed: 1, answerCount: 3, durationSec: 60 }),
  );

  // 今日首学 2 词（4 分 / 模糊），昨日首学 2 词（认识 / 不认识）
  await db.wordStates.bulkPut([
    makeState('remember', { lastRating: 4, firstLearnedAt: todayAt }),
    makeState('fuzzy', { lastRating: 2, firstLearnedAt: todayAt }),
    makeState('keep', { lastRating: 3, firstLearnedAt: yesterdayAt }),
    makeState('lost', { lastRating: 1, firstLearnedAt: yesterdayAt }),
  ]);
  // 昨日两个词当天有答题流水（保持率分母 = 当日有活动的词）
  await db.reviewLogs.bulkAdd([makeLog('keep', yesterdayAt), makeLog('lost', yesterdayAt)]);
});

describe('StatsPage', () => {
  it('三指标卡 / 遗忘曲线 / 学习情况全部渲染真实值', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/stats']}>
          <Routes>
            <Route path="/stats" element={<StatsPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    const text = (): string => container.textContent ?? '';
    try {
      // 顶部长横条卡
      await waitFor(() => text().includes('总词汇量'), '总词汇量渲染');
      expect(text()).toContain('总学习时间');
      expect(text()).toContain('记忆度');
      expect(text()).toContain('记忆');
      expect(text()).toContain('模糊');
      expect(text()).toContain('陌生');
      // 记忆度：4 词中 2 记 / 1 模糊 / 1 陌生 → 50% / 25% / 25%
      expect(text()).toContain('50%');
      expect(text()).toContain('25%');

      // 功能区① 艾宾浩斯遗忘曲线
      await waitFor(() => text().includes('艾宾浩斯遗忘曲线'), '曲线卡片渲染');
      // 两天的保持率都是 50%，折线与数据点都渲染出来
      await waitFor(
        () => container.querySelector('svg[role="img"] path') !== null,
        '折线渲染',
      );

      // 功能区② 学习情况
      await waitFor(() => text().includes('学习情况'), '学习情况卡片渲染');
      expect(text()).toContain('新学');
      expect(text()).toContain('复习');
      expect(text()).toContain('今日学习时长');
      // 今日 90 秒 → 1 分 30 秒
      expect(text()).toContain('1 分 30 秒');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
