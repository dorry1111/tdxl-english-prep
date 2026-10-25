/**
 * SearchPage 测试（jsdom + fake-indexeddb，内置词库走注入 fetcher 不触网）。
 *
 * 覆盖：
 * 1. 纯逻辑：normalizeQuery / shouldSearch / 防抖常量；
 * 2. 搜索：输入前缀 → DB 命中（用户导入词）+ 索引命中（内置词）合并展示；
 * 3. 无结果态与初始提示；
 * 4. 点击结果 → 跳词条详情。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { now } from '@/lib/time';
import {
  setCoreFetcher,
  loadCoreIndex,
  type CoreIndex,
  type CoreShard,
} from '@/lib/wordbookCache';
import type { Word } from '@/types';
import SearchPage from './SearchPage';
import {
  SEARCH_DEBOUNCE_MS,
  normalizeQuery,
  shouldSearch,
} from './searchLogic';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeIndex(): CoreIndex {
  return {
    bookId: 'core',
    version: 2,
    total: 3,
    shards: ['core-a.json'],
    entries: [
      ['apple', 'apple', 0, 1, 'core-a.json'],
      ['apply', 'apply', 1, 2, 'core-a.json'],
      ['zebra', 'zebra', 2, null, 'core-a.json'],
    ],
  };
}

function makeShard(): CoreShard {
  return {
    letter: 'a',
    words: [
      { id: 'core:apple', bookId: 'core', headword: 'apple', norm: 'apple', meanings: [{ pos: 'n.', cn: '苹果' }] },
      { id: 'core:apply', bookId: 'core', headword: 'apply', norm: 'apply', meanings: [{ pos: 'v.', cn: '申请' }] },
      { id: 'core:zebra', bookId: 'core', headword: 'zebra', norm: 'zebra', meanings: [{ pos: 'n.', cn: '斑马' }] },
    ],
  };
}

function makeWord(headword: string, bookId: string): Word {
  const stamp = now();
  return {
    id: `${bookId}:${headword}`,
    bookId,
    headword,
    norm: headword,
    meanings: [{ pos: 'n.', cn: `${headword} 自定义释义` }],
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  };
}

function mountAt(path: string): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/search" element={<SearchPage />} />
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

/** 在受控 input 上模拟输入（React 19 需要走原生 setter） */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function findInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="search"]') as HTMLInputElement | null;
  if (!input) {
    throw new Error('未找到搜索框');
  }
  return input;
}

beforeEach(() => {
  setCoreFetcher(async (url) => {
    if (url.endsWith('core-index.json')) {
      return makeIndex();
    }
    return makeShard();
  });
});

afterEach(() => {
  setCoreFetcher(undefined);
});

describe('searchLogic（纯逻辑）', () => {
  it('normalizeQuery：小写 + 去首尾空格 + 多空格合一', () => {
    expect(normalizeQuery('  Apple  ')).toBe('apple');
    expect(normalizeQuery('a  lot')).toBe('a lot');
  });

  it('shouldSearch：空串与纯空格不搜', () => {
    expect(shouldSearch('app')).toBe(true);
    expect(shouldSearch('')).toBe(false);
    expect(shouldSearch('   ')).toBe(false);
    expect(SEARCH_DEBOUNCE_MS).toBe(300);
  });
});

describe('SearchPage 渲染与交互', () => {
  it('初始态：显示输入框与引导提示，无结果列表', async () => {
    const page = mountAt('/search');
    try {
      await flushDb();
      const text = page.container.textContent ?? '';
      expect(text).toContain('搜索');
      expect(text).toContain('支持：英文单词前缀（app → apple）、中文释义（苹果）、试卷标题、真题原句。');
      expect(page.container.querySelectorAll('li')).toHaveLength(0);
    } finally {
      page.unmount();
    }
  });

  it('输入前缀 → 防抖后合并展示 DB 命中与内置词库命中', async () => {
    // 索引先加载进缓存（searchCoreByNorm 是同步读缓存的）
    await loadCoreIndex();
    await db.words.put(makeWord('apricot', 'custom'));

    const page = mountAt('/search');
    try {
      await flushDb();
      const input = findInput(page.container);
      await act(async () => {
        typeInto(input, 'ap');
      });
      await waitFor(() => (page.container.textContent ?? '').includes('apple'), '内置词命中');
      const text = page.container.textContent ?? '';
      // 内置词库（索引）命中
      expect(text).toContain('apple');
      expect(text).toContain('apply');
      // 用户导入词（DB）命中
      expect(text).toContain('apricot');
      expect(text).toContain('apricot 自定义释义');
      expect(text).toContain('找到 3 个单词');
      // 未命中词不出现
      expect(text).not.toContain('zebra');
    } finally {
      page.unmount();
    }
  });

  it('无结果：显示无结果空态', async () => {
    await loadCoreIndex();
    const page = mountAt('/search');
    try {
      await flushDb();
      const input = findInput(page.container);
      await act(async () => {
        typeInto(input, 'xyz');
      });
      await waitFor(
        () => (page.container.textContent ?? '').includes('没有匹配的结果'),
        '无结果空态',
      );
      expect(page.container.textContent).toContain('AI 直接给出释义');
    } finally {
      page.unmount();
    }
  });

  it('点击结果 → 跳转词条详情页', async () => {
    await loadCoreIndex();
    const page = mountAt('/search');
    try {
      await flushDb();
      const input = findInput(page.container);
      await act(async () => {
        typeInto(input, 'zebra');
      });
      await waitFor(() => (page.container.textContent ?? '').includes('zebra'), '结果渲染');
      const row = Array.from(page.container.querySelectorAll('button')).find((button) =>
        (button.textContent ?? '').includes('zebra'),
      );
      expect(row).not.toBeNull();
      act(() => {
        (row as HTMLButtonElement).click();
      });
      await waitFor(
        () => (page.container.textContent ?? '').includes('词条详情页'),
        '跳转词条详情',
      );
    } finally {
      page.unmount();
    }
  });

  it('中文释义搜索命中内置词 → 点击跳转携带完整 id（回归：曾因 WordLike 丢 id 致 /word/undefined）', async () => {
    await loadCoreIndex();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let openedId = '';
    const WordRouteProbe = (): React.JSX.Element => {
      const { id } = useParams<{ id: string }>();
      openedId = id ?? '';
      return <p>词条详情页</p>;
    };
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/search']}>
          <Routes>
            <Route path="/search" element={<SearchPage />} />
            <Route path="/word/:id" element={<WordRouteProbe />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    try {
      await flushDb();
      const input = findInput(container);
      await act(async () => {
        typeInto(input, '斑马');
      });
      await waitFor(() => (container.textContent ?? '').includes('zebra'), '中文释义命中');
      const row = Array.from(container.querySelectorAll('button')).find((button) =>
        (button.textContent ?? '').includes('zebra'),
      );
      expect(row).not.toBeNull();
      act(() => {
        (row as HTMLButtonElement).click();
      });
      await waitFor(() => openedId === 'core:zebra', '详情路由携带 core:zebra');
      expect(openedId).toBe('core:zebra');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
