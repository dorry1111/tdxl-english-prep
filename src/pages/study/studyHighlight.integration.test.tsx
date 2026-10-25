/**
 * QA 二层验证（笔记与高亮批次必查项 4）：
 * StudyPage 端到端集成：划选答案态文本 → 浮动色板 → 选色保存（真实 noteRepo 落库）
 * → 卸载整页（模拟刷新）→ 重新进入学习页 → 高亮仍还原渲染。
 * jsdom + fake-indexeddb，全程不触网。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BUILTIN_BOOK_ID, REMOTE_FILES } from '@/constants';
import { db, getSyncMeta } from '@/db';
import { ensureSeeded } from '@/db/seed';
import { stateKeyOfNorm } from '@/lib/hash';
import { now } from '@/lib/time';
import StudyPage from './StudyPage';
import { setNewWordProvider, useSessionStore } from '@/store/sessionStore';
import type { Word, WordState } from '@/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function showModal(): void {
      this.setAttribute('open', '');
    };
  }
  if (typeof HTMLDialogElement.prototype.close !== 'function') {
    HTMLDialogElement.prototype.close = function close(): void {
      this.removeAttribute('open');
    };
  }
});

function makeWord(headword: string): Word {
  const stamp = now();
  return {
    id: `${BUILTIN_BOOK_ID}:${headword.toLowerCase()}`,
    bookId: BUILTIN_BOOK_ID,
    headword,
    norm: headword.toLowerCase(),
    meanings: [{ pos: 'n.', cn: `${headword} 的测试释义` }],
    frequencyRank: 1,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  };
}

function makeDueState(norm: string): WordState {
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

function resetStore(): void {
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

function mountAt(path: string): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/study" element={<StudyPage />} />
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

function pressKey(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

/** 在学习页答案态里划选队首复习词的 headword 前缀（jsdom Range + Selection） */
function selectHeadwordPrefix(container: HTMLElement, headword: string, prefixLength: number): void {
  // 答案态 headword 是卡片里唯一的 <h2>（文本 = 单词本身）
  const h2 = [...container.querySelectorAll('h2')].find(
    (element) => element.textContent === headword,
  );
  expect(h2).not.toBeNull();
  const textNode = h2?.firstChild?.firstChild as Text;
  const selection = window.getSelection();
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, prefixLength);
  act(() => {
    selection?.removeAllRanges();
    selection?.addRange(range);
    window.dispatchEvent(new MouseEvent('mouseup'));
  });
}

beforeEach(() => {
  resetStore();
});

describe('StudyPage 高亮集成：划选 → 色板 → 保存 → 刷新后仍在', () => {
  it('完整链路实测（真实 noteRepo + fake-indexeddb）', { timeout: 20_000 }, async () => {
    // 装载：队首一张复习卡 zulu（复习卡不触发 WRD-16 确认，链路最短）
    await ensureSeeded();
    const zulu = makeWord('zulu');
    await db.words.bulkPut([zulu, makeWord('apple'), makeWord('brave')]);
    setNewWordProvider(async () => [makeWord('apple'), makeWord('brave')]);
    await db.wordStates.bulkPut([makeDueState('zulu')]);

    // ---------- 第一轮：划选 + 色板 + 保存 ----------
    const page = mountAt('/study');
    try {
      await waitFor(() => useSessionStore.getState().status === 'active', '进入会话');
      await waitFor(
        () => useSessionStore.getState().machine?.queue[0]?.kind === 'review',
        '队首为复习卡',
      );
      pressKey(' ');
      await waitFor(() => useSessionStore.getState().revealed, '揭示答案');

      // 划选 "zul"（zulu 的前缀）
      selectHeadwordPrefix(page.container, 'zulu', 3);

      // 色板出现（role=toolbar），选 2 号色
      const palette = await waitFor(
        () => document.querySelector('[role="toolbar"]'),
        '划选后色板出现',
      );
      expect(palette).not.toBeNull();
      const color2 = palette?.querySelector('button[aria-label="高亮颜色 2"]') as HTMLButtonElement;
      expect(color2).not.toBeNull();
      act(() => {
        color2.click();
      });

      // 真实落库：wordHighlights 一条，scope=headword、color=2，wordbook.json 标脏
      await waitFor(async () => (await db.wordHighlights.count()) === 1, '高亮写入 IndexedDB');
      const saved = (await db.wordHighlights.toArray())[0];
      expect(saved?.scope).toBe('headword');
      expect(saved?.exampleIndex).toBeNull();
      expect(saved?.text).toBe('zul');
      expect(saved?.color).toBe(2);
      expect(saved?.stateKey).toBe(stateKeyOfNorm('zulu'));
      expect(saved?.deletedAt).toBeNull();
      const dirty = await getSyncMeta(REMOTE_FILES.wordbook);
      expect(dirty?.dirtyAt).not.toBeNull();
    } finally {
      // 模拟刷新：整页卸载（IndexedDB 数据保留）
      page.unmount();
    }

    // ---------- 第二轮：重新进入学习页，高亮还原 ----------
    resetStore();
    const page2 = mountAt('/study');
    try {
      // 第一轮留下了同日未完成快照 → 弹「继续上次 / 重新开始」；选「重新开始」
      await waitFor(
        () => [...document.querySelectorAll('dialog[open] button')].find(
          (button) => button.textContent === '重新开始',
        ) ?? null,
        '刷新后弹出继续/重新开始选择框',
      );
      const restartBtn = [...document.querySelectorAll('dialog[open] button')].find(
        (button) => button.textContent === '重新开始',
      ) as HTMLButtonElement;
      act(() => {
        restartBtn.click();
      });
      await waitFor(() => useSessionStore.getState().status === 'active', '刷新后进入会话');
      await waitFor(
        () => useSessionStore.getState().machine?.queue[0]?.kind === 'review',
        '刷新后队首仍为复习卡',
      );
      pressKey(' ');
      await waitFor(() => useSessionStore.getState().revealed, '刷新后揭示答案');

      // headword 上出现高亮 span：颜色与文本都与第一轮保存的一致
      const marked = await waitFor(
        () => page2.container.querySelector('span[data-whl-id]'),
        '刷新后高亮还原渲染',
      );
      expect(marked).not.toBeNull();
      expect(marked?.textContent).toBe('zul');
      expect(marked?.className).toContain('bg-hl-2');
    } finally {
      page2.unmount();
    }
  });
});
