/**
 * BooksPage 渲染与交互测试（jsdom + fake-indexeddb）。
 *
 * 覆盖：词库卡片列表（内置 + 生词本）、每个卡片的「共 / 已学 / 待复习」真实数字、
 * 「设为当前」写回 Settings、「开始学习」走 start() → 进会话。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BUILTIN_BOOK_ID, NOTEBOOK_BOOK_ID, NOTEBOOK_BOOK_NAME } from '@/constants';
import { db } from '@/db';
import { ensureSeeded } from '@/db/seed';
import { stateKeyOfNorm } from '@/lib/hash';
import { setCoreFetcher } from '@/lib/wordbookCache';
import { now } from '@/lib/time';
import { setNewWordProvider, useSessionStore } from '@/store/sessionStore';
import type { Word, WordState } from '@/types';
import BooksPage from './BooksPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 内置词库索引桩：3 词 / 1 分片（避免测试真的去 fetch 静态文件） */
const CORE_INDEX = {
  bookId: BUILTIN_BOOK_ID,
  version: 2,
  total: 3,
  shards: ['core-a'],
  entries: [
    ['apple', 'apple', 0, null, 'core-a'],
    ['brave', 'brave', 1, null, 'core-a'],
    ['cloud', 'cloud', 2, null, 'core-a'],
  ] as ReadonlyArray<readonly [string, string, number, number | null, string]>,
};

function makeWord(headword: string): Word {
  const stamp = now();
  return {
    id: `${BUILTIN_BOOK_ID}:${headword.toLowerCase()}`,
    bookId: BUILTIN_BOOK_ID,
    headword,
    norm: headword.toLowerCase(),
    meanings: [{ pos: 'n.', cn: `${headword} 释义` }],
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  };
}

/** 已学且已到期的状态（计入「已学」与「待复习」） */
function makeLearnedDueState(norm: string): WordState {
  const stamp = now();
  return {
    stateKey: stateKeyOfNorm(norm),
    wordId: `${BUILTIN_BOOK_ID}:${norm}`,
    bookId: BUILTIN_BOOK_ID,
    level: 1,
    dueAt: stamp - 60_000,
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

interface Mounted {
  container: HTMLElement;
  unmount: () => void;
  text: () => string;
}

function mountBooks(): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/books']}>
        <Routes>
          <Route path="/books" element={<BooksPage />} />
          {/* 仅用于吸收跳转，避免 react-router 警告 */}
          <Route path="/study" element={<div>学习页</div>} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
    text: () => container.textContent ?? '',
  };
}

function clickButton(container: HTMLElement, label: string): void {
  const found = Array.from(container.querySelectorAll('button')).find((button) =>
    (button.textContent ?? '').includes(label),
  );
  if (!found) {
    throw new Error(`未找到按钮: ${label}`);
  }
  act(() => {
    found.click();
  });
}

beforeEach(async () => {
  setCoreFetcher(async (url: string) =>
    url.includes('core-index') ? CORE_INDEX : { letter: 'a', words: [] },
  );
  await ensureSeeded();
  await db.words.bulkPut(['apple', 'brave', 'cloud'].map(makeWord));
  await db.wordStates.bulkPut([makeLearnedDueState('apple'), makeLearnedDueState('brave')]);
  setNewWordProvider(async () => [makeWord('cloud')]);
  useSessionStore.setState({ status: 'idle', machine: null, session: null, currentWord: null });
});

afterEach(() => {
  setCoreFetcher(undefined);
});

describe('BooksPage', () => {
  it('列出内置词库与生词本，并显示真实的共 / 已学 / 待复习数字', async () => {
    const page = mountBooks();
    try {
      await waitFor(() => page.text().includes('考纲核心词'), '内置词库卡片渲染');
      // 三个数字是异步聚合出来的，等到真实值渲染完成再断言
      await waitFor(() => page.text().includes('已学 67%'), '聚合数字渲染');
      const text = page.text();
      expect(text).toContain('考纲核心词');
      expect(text).toContain(NOTEBOOK_BOOK_NAME);
      expect(text).toContain('已学');
      expect(text).toContain('待复习');
      // 内置词库：索引 total=3，2 条已学且到期
      const coreCard = Array.from(page.container.querySelectorAll('section')).find((section) =>
        (section.textContent ?? '').includes('考纲核心词'),
      );
      expect(coreCard).toBeTruthy();
      expect(coreCard?.textContent ?? '').toContain('3');
      // 2 / 3 已学 → 进度 67%
      expect(coreCard?.textContent ?? '').toContain('已学 67%');
    } finally {
      page.unmount();
    }
  });

  it('点「设为当前」把该词库写入 Settings，且 activeBookIds 同步', async () => {
    const page = mountBooks();
    try {
      await waitFor(() => page.text().includes(NOTEBOOK_BOOK_NAME), '生词本卡片渲染');
      await waitFor(
        () =>
          Array.from(page.container.querySelectorAll('button')).some((button) =>
            (button.textContent ?? '').includes('设为当前'),
          ),
        '「设为当前」按钮渲染',
      );
      // 内置词库是当前词库（按钮显示「当前学习」），第一个「设为当前」是生词本卡片
      clickButton(page.container, '设为当前');
      await act(async () => {
        await sleep(50);
      });
      const settings = await db.settings.get('global');
      expect(settings?.currentBookId).toBe(NOTEBOOK_BOOK_ID);
      expect(settings?.currentBookId).toBeTruthy();
      expect(settings?.activeBookIds[0]).toBe(settings?.currentBookId);
    } finally {
      page.unmount();
    }
  });

  it('点「开始学习」进入会话（复用 HomePage 的 start → /study 路径）', async () => {
    const page = mountBooks();
    try {
      await waitFor(() => page.text().includes('开始学习'), '开始学习按钮渲染');
      clickButton(page.container, '开始学习');
      await waitFor(() => useSessionStore.getState().status === 'active', '进入会话');
      expect(useSessionStore.getState().machine?.queue.length).toBeGreaterThan(0);
    } finally {
      page.unmount();
      useSessionStore.getState().exit();
    }
  });
});
