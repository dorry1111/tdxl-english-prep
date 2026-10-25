/**
 * NotebookPage 测试（jsdom + fake-indexeddb）。
 *
 * 覆盖：
 * 1. 纯逻辑：释义摘要、词书筛选、排序、累计分页；
 * 2. 空态：无收藏 → 引导去词书页；
 * 3. 列表：收藏词渲染（词头 + 释义摘要 + 等级），点击进词条详情；
 * 4. 词书筛选 chip 生效；
 * 5. 学习生词：装填收藏词后 start()，队列首卡即收藏词，并跳到 /study。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { ensureSeeded } from '@/db/seed';
import { stateKeyOfNorm } from '@/lib/hash';
import { now } from '@/lib/time';
import { useSessionStore } from '@/store/sessionStore';
import type { Word, WordBook, WordState } from '@/types';
import NotebookPage from './NotebookPage';
import {
  bookOptionsOf,
  filterByBook,
  meaningSummary,
  paginate,
  sortItems,
  type NotebookItem,
} from './notebookLogic';
import { restoreDefaultNewWords } from './notebookStudy';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeWord(headword: string, bookId: string): Word {
  const stamp = now();
  return {
    id: `${bookId}:${headword}`,
    bookId,
    headword,
    norm: headword,
    meanings: [
      { pos: 'n.', cn: `${headword} 释义一` },
      { pos: 'v.', cn: `${headword} 释义二` },
      { pos: 'adj.', cn: `${headword} 释义三` },
    ],
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  };
}

function makeBook(id: string, name: string): WordBook {
  const stamp = now();
  return {
    id,
    name,
    source: 'builtin',
    wordCount: 0,
    enabled: true,
    priority: 0,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  };
}

function makeState(word: Word, overrides?: Partial<WordState>): WordState {
  const stamp = now();
  return {
    stateKey: stateKeyOfNorm(word.norm),
    wordId: word.id,
    bookId: word.bookId,
    level: 2,
    dueAt: 0,
    lastRating: null,
    lastReviewAt: null,
    firstLearnedAt: null,
    reviewCount: 0,
    correctCount: 0,
    wrongCount: 0,
    lapseCount: 0,
    retryCountToday: 0,
    retryDay: '2020-01-01',
    unstable: false,
    isStarred: true,
    masteredAt: null,
    updatedAt: stamp,
    deletedAt: null,
    ...overrides,
  };
}

function itemOf(word: Word, updatedAt?: number): NotebookItem {
  const state = makeState(word, updatedAt === undefined ? {} : { updatedAt });
  return { word, state };
}

/** /study 用占位组件：只用来断言「学习生词」确实跳转到了学习页 */
function StudyMarker(): React.ReactElement {
  return <p>学习页占位</p>;
}

function mountAt(path: string): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/notebook" element={<NotebookPage />} />
          <Route path="/study" element={<StudyMarker />} />
          <Route path="/word/:id" element={<p>词条详情页</p>} />
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
  };
}

async function flushDb(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

async function waitFor<T>(check: () => T, label: string): Promise<T> {
  const deadline = Date.now() + 5000;
  let value = check();
  while (!value) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor 超时: ${label}`);
    }
    await flushDb();
    value = check();
  }
  return value;
}

function clickButton(container: HTMLElement, text: string): void {
  const found = Array.from(container.querySelectorAll('button')).find(
    (button) => (button.textContent ?? '').trim() === text,
  );
  if (!found) {
    throw new Error(`未找到按钮: ${text}`);
  }
  act(() => {
    found.click();
  });
}

/** 点击列表行（列表行是 button，但筛选 chip 也是 button）——按词条文案定位 */
function clickRow(container: HTMLElement, headword: string): void {
  const found = Array.from(
    container.querySelectorAll<HTMLButtonElement>('li button'),
  ).find((button) => (button.textContent ?? '').includes(headword));
  if (!found) {
    throw new Error(`未找到列表行: ${headword}`);
  }
  act(() => {
    found.click();
  });
}

afterEach(() => {
  restoreDefaultNewWords();
  useSessionStore.setState({
    status: 'idle',
    machine: null,
    session: null,
    currentWord: null,
    revealed: false,
    cardShownAt: null,
    duePool: [],
    newPool: [],
    settleSummary: null,
    error: null,
  });
});

describe('notebookLogic（纯逻辑）', () => {
  it('meaningSummary：取前 2 条，超出加省略号', () => {
    const word = makeWord('apple', 'core');
    expect(meaningSummary(word)).toBe('n. apple 释义一；v. apple 释义二…');
    expect(meaningSummary(word, 3)).toBe('n. apple 释义一；v. apple 释义二；adj. apple 释义三');
  });

  it('filterByBook：all 透传，指定词书只留该词书', () => {
    const core = itemOf(makeWord('apple', 'core'));
    const custom = itemOf(makeWord('brave', 'custom'));
    expect(filterByBook([core, custom], 'all')).toHaveLength(2);
    expect(filterByBook([core, custom], 'custom')).toEqual([custom]);
  });

  it('sortItems：更新时间倒序，同时间按词头字典序', () => {
    const items = [
      itemOf(makeWord('apple', 'core'), 100),
      itemOf(makeWord('brave', 'core'), 300),
      itemOf(makeWord('crane', 'core'), 300),
    ];
    expect(sortItems(items).map((item) => item.word.headword)).toEqual([
      'brave',
      'crane',
      'apple',
    ]);
  });

  it('paginate：累计分页，越界参数收敛', () => {
    const list = [1, 2, 3, 4, 5];
    expect(paginate(list, 1, 2)).toEqual([1, 2]);
    expect(paginate(list, 2, 2)).toEqual([1, 2, 3, 4]);
    expect(paginate(list, 0, 2)).toEqual([1, 2]);
  });

  it('bookOptionsOf：按出现顺序去重', () => {
    const items = [itemOf(makeWord('apple', 'core')), itemOf(makeWord('brave', 'x')), itemOf(makeWord('crane', 'core'))];
    expect(bookOptionsOf(items)).toEqual(['core', 'x']);
  });
});

describe('NotebookPage 渲染', () => {
  it('无收藏 → 空态引导去词书页', async () => {
    await ensureSeeded();
    const page = mountAt('/notebook');
    try {
      await waitFor(() => (page.container.textContent ?? '').includes('生词本还是空的'), '空态渲染');
      expect(page.container.textContent).toContain('去词书页');
      expect(page.container.textContent).toContain('共 0 个收藏词');
    } finally {
      page.unmount();
    }
  });

  it('收藏词渲染（词头 + 释义摘要 + 等级），点击进入词条详情', async () => {
    await ensureSeeded();
    const word = makeWord('apple', 'core');
    await db.words.put(word);
    await db.books.put(makeBook('core', '考纲核心词'));
    await db.wordStates.put(makeState(word, { level: 4 }));

    const page = mountAt('/notebook');
    try {
      await waitFor(() => (page.container.textContent ?? '').includes('apple'), '列表渲染');
      const text = page.container.textContent ?? '';
      expect(text).toContain('apple 释义一');
      expect(text).toContain('L4');
      expect(text).toContain('共 1 个收藏词');

      clickRow(page.container, 'apple');
      await waitFor(() => (page.container.textContent ?? '').includes('词条详情页'), '跳转到词条详情');
    } finally {
      page.unmount();
    }
  }, 20_000);

  it('词书筛选：点 chip 后只显示该词书的收藏词', async () => {
    await ensureSeeded();
    const core = makeWord('apple', 'core');
    const custom = makeWord('brave', 'custom');
    await db.words.bulkPut([core, custom]);
    await db.books.bulkPut([makeBook('core', '考纲核心词'), makeBook('custom', '我的导入词')]);
    await db.wordStates.bulkPut([makeState(core), makeState(custom)]);

    const page = mountAt('/notebook');
    try {
      await waitFor(() => (page.container.textContent ?? '').includes('apple'), '列表渲染');
      expect(page.container.textContent).toContain('考纲核心词');
      expect(page.container.textContent).toContain('我的导入词');

      clickButton(page.container, '我的导入词');
      await flushDb();
      expect(page.container.textContent).toContain('brave');
      expect(page.container.textContent).not.toContain('apple 释义一');
    } finally {
      page.unmount();
    }
  }, 20_000);

  it('学习生词：装填收藏词后 start()，队列首卡是收藏词并跳 /study', async () => {
    await ensureSeeded();
    const word = makeWord('zebra', 'core');
    await db.words.put(word);
    await db.books.put(makeBook('core', '考纲核心词'));
    await db.wordStates.put(makeState(word));

    const page = mountAt('/notebook');
    try {
      await waitFor(() => (page.container.textContent ?? '').includes('zebra'), '列表渲染');
      clickButton(page.container, '学习生词');
      await waitFor(() => useSessionStore.getState().status === 'active', '会话启动');
      expect(useSessionStore.getState().machine?.queue[0]?.wordId).toBe(word.id);
      await waitFor(() => (page.container.textContent ?? '').includes('学习页占位'), '跳转学习页');
    } finally {
      page.unmount();
    }
  }, 20_000);
});
