/**
 * StudyPage 组件级交互测试（QA 二层验证，jsdom + fake-indexeddb）。
 *
 * 覆盖任务书必查项：
 * 1. 评分无弹窗：四档（含新词首现「熟识」）直接提交落库，不弹任何确认框；
 * 2. 未揭示时 1~4 数字键无效；空格揭示后才能评分；
 * 3. 「上一个」：答完可回退到上一张卡重答，不产生重复学习记录；
 * 4. 会话链路：作答→落库→切卡；settled → 跳 /study/summary；
 * 5. 边界反例：输入框聚焦时按键被忽略、queue[0] 词内容缺失时的渲染兜底。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BUILTIN_BOOK_ID } from '@/constants';
import { db } from '@/db';
import { ensureSeeded } from '@/db/seed';
import { stateKeyOfNorm } from '@/lib/hash';
import StudyPage from './StudyPage';
import StudySummaryPage from './StudySummaryPage';
import { setNewWordProvider, useSessionStore } from '@/store/sessionStore';
import { now } from '@/lib/time';
import type { Word, WordState } from '@/types';

// React act() 环境标记：vitest jsdom 下需要显式声明，否则告警
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 未实现 <dialog>.showModal()，这里打桩使其与浏览器语义一致（打开即带 open 属性）
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

/** 装载新词：词条必须写入 db.words，否则 loadWord 取不到 → currentWord=null */
async function seedNewWords(...headwords: string[]): Promise<Word[]> {
  await ensureSeeded();
  const words = headwords.map(makeWord);
  await db.words.bulkPut(words);
  setNewWordProvider(async () => words);
  return words;
}

/** 构造一个已到期、需要复习的 WordState（level=1，dueAt=过去） */
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
    history: [],
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 轮询直到条件成立并返回该值（所有等待都包在 act 里，避免 React 状态更新告警） */
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
}

function mountAt(path: string): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/study" element={<StudyPage />} />
          <Route path="/study/summary" element={<StudySummaryPage />} />
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

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (button) => (button.textContent ?? '').includes(label),
  );
  if (!found) {
    throw new Error(`未找到按钮: ${label}`);
  }
  return found;
}

function findOpenDialog(container: HTMLElement, titlePart: string): HTMLDialogElement | null {
  return (
    Array.from(
      container.querySelectorAll<HTMLDialogElement>('dialog[open]'),
    ).find((dialog) => (dialog.textContent ?? '').includes(titlePart)) ?? null
  );
}

function pressKey(key: string, target?: HTMLElement): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true });
  (target ?? window).dispatchEvent(event);
}

beforeEach(() => {
  resetStore();
});

describe('StudyPage：评分无弹窗 + 返回上一个', () => {
  it('任意评分（含新词首现「熟识」）都不弹确认框，直接提交落库', async () => {
    await seedNewWords('apple');
    const page = mountAt('/study');
    try {
      await waitFor(() => useSessionStore.getState().status === 'active', '进入会话');

      // 揭示后点「熟识」——历史上这里会弹 WRD-16 确认框，现在必须直接提交
      pressKey(' ');
      await waitFor(() => useSessionStore.getState().revealed, '揭示答案');
      act(() => {
        (page.container.querySelector('button[aria-label*="熟识"]') as HTMLButtonElement).click();
      });

      // 无任何确认框出现，且评分已生效：唯一一张卡答完 → settled
      await waitFor(() => useSessionStore.getState().status === 'settled', '直接进入 settled');
      expect(findOpenDialog(page.container, '确定认识')).toBeNull();
      const summary = useSessionStore.getState().settleSummary;
      expect(summary?.answeredCount).toBe(1);
      expect(summary?.ratingCounts['4']).toBe(1);
      expect(await db.reviewLogs.count()).toBe(1);
    } finally {
      page.unmount();
    }
  });

  it('「上一个」：答完回退到上一张卡可重答，不产生重复学习记录', async () => {
    await seedNewWords('apple', 'brave');
    const page = mountAt('/study');
    try {
      await waitFor(() => useSessionStore.getState().status === 'active', '进入会话');
      const firstWord = useSessionStore.getState().currentWord;
      expect(firstWord?.norm).toBe('apple');

      // 答第一张（apple）：认识（aria-label 形如「认识（快捷键 3）」，用 ^ 前缀避免误中「不认识」）
      pressKey(' ');
      await waitFor(() => useSessionStore.getState().revealed, '揭示 apple');
      act(() => {
        (
          page.container.querySelector('button[aria-label^="认识"]') as HTMLButtonElement
        ).click();
      });
      await waitFor(
        () => useSessionStore.getState().currentWord?.norm === 'brave',
        '切到第二张卡',
      );
      expect(await db.reviewLogs.count()).toBe(1);
      expect(useSessionStore.getState().history).toHaveLength(1);

      // 点「上一个」回退：回到 apple（已揭示态）
      act(() => {
        (
          page.container.querySelector('button[aria-label="上一个"]') as HTMLButtonElement
        ).click();
      });
      await waitFor(
        () => useSessionStore.getState().currentWord?.norm === 'apple',
        '回退到 apple',
      );
      expect(useSessionStore.getState().revealed).toBe(true);
      expect(await db.reviewLogs.count()).toBe(0); // 学习记录已撤销
      expect(useSessionStore.getState().session!.answerCount).toBe(0);

      // 改答「模糊」→ 下一张 brave 认识 → settled
      act(() => {
        (
          page.container.querySelector('button[aria-label^="模糊"]') as HTMLButtonElement
        ).click();
      });
      await waitFor(
        () => useSessionStore.getState().currentWord?.norm === 'brave',
        '重答后切到 brave',
      );
      pressKey(' ');
      await waitFor(() => useSessionStore.getState().revealed, '揭示 brave');
      act(() => {
        (
          page.container.querySelector('button[aria-label^="认识"]') as HTMLButtonElement
        ).click();
      });
      await waitFor(() => useSessionStore.getState().status === 'settled', '会话结算');

      // 全程只有两条学习记录（apple 模糊 + brave 认识），答错的那次已撤销
      const logs = await db.reviewLogs.toArray();
      expect(logs).toHaveLength(2);
      expect(logs.map((log) => log.rating).sort()).toEqual([2, 3]);
      expect(await db.wordStates.count()).toBe(2);
      expect(useSessionStore.getState().session!.answerCount).toBe(2);
    } finally {
      page.unmount();
    }
  });
});

describe('StudyPage：键盘门禁（未揭示不可评分）', () => {
  it('未揭示时 1~4 无效；空格揭示后数字键才评分并切卡', async () => {
    // 队首放一张到期复习卡（复习卡按数字键不会触发 WRD-16 确认）
    await seedNewWords('apple', 'brave');
    await db.wordStates.bulkPut([makeDueState('zulu')]);
    await db.words.bulkPut([makeWord('zulu')]);
    const page = mountAt('/study');
    try {
      await waitFor(() => useSessionStore.getState().status === 'active', '进入会话');
      await waitFor(
        () => useSessionStore.getState().machine?.queue[0]?.kind === 'review',
        '队首为复习卡',
      );
      const firstWord = useSessionStore.getState().currentWord;

      // 未揭示：数字键全部无效
      for (const key of ['1', '2', '3', '4']) {
        pressKey(key);
      }
      await act(async () => {
        await sleep(30);
      });
      expect(useSessionStore.getState().revealed).toBe(false);
      expect(await db.wordStates.count()).toBe(1); // 只有预置的 zulu 状态
      expect(await db.reviewLogs.count()).toBe(0);

      // 空格揭示；再按 2 → 提交评分
      pressKey(' ');
      await waitFor(() => useSessionStore.getState().revealed, '空格揭示');
      pressKey('2');
      await waitFor(
        () => useSessionStore.getState().machine?.queue.length === 2,
        '落库后切到下一张卡',
      );

      // 作答 → 落库 → 切卡（顺序证据：落库内容与新卡同时成立）
      const after = useSessionStore.getState();
      expect(after.machine?.queue[0]?.wordId).toBe(`${BUILTIN_BOOK_ID}:apple`);
      expect(after.currentWord?.norm).toBe('apple');
      expect(after.currentWord?.id).not.toBe(firstWord?.id);
      expect(after.revealed).toBe(false); // 新卡回到未揭示
      expect(await db.wordStates.count()).toBe(1); // 复习卡 zulu 原地更新（apple 尚未作答）
      expect(await db.reviewLogs.count()).toBe(1);
      const logs = await db.reviewLogs.toArray();
      expect(logs[0]?.rating).toBe(2);
    } finally {
      page.unmount();
    }
  });

  it('输入框聚焦时按键被忽略（不会误触评分）', async () => {
    await seedNewWords('apple');
    const page = mountAt('/study');
    try {
      await waitFor(() => useSessionStore.getState().status === 'active', '进入会话');

      const input = document.createElement('input');
      document.body.appendChild(input);
      pressKey(' ', input);
      pressKey('4', input);
      await act(async () => {
        await sleep(30);
      });
      expect(useSessionStore.getState().revealed).toBe(false);
      expect(await db.reviewLogs.count()).toBe(0);
      input.remove();
    } finally {
      page.unmount();
    }
  });
});

describe('StudyPage：边界反例', () => {
  it('queue[0] 对应的词条缺失（currentWord=null）时渲染兜底文案，不白屏', async () => {
    await seedNewWords('apple');
    const page = mountAt('/study');
    try {
      await waitFor(() => useSessionStore.getState().status === 'active', '进入会话');
      act(() => {
        useSessionStore.setState({ currentWord: null });
      });
      expect(page.container.textContent).toContain('没有找到这个单词。');
      // 会话仍在进行：进度条与退出按钮还在
      expect(page.container.textContent).toContain('退出');
    } finally {
      page.unmount();
    }
  });

  it('退出确认框打开时空格键被忽略', async () => {
    await seedNewWords('apple');
    const page = mountAt('/study');
    try {
      await waitFor(() => useSessionStore.getState().status === 'active', '进入会话');
      act(() => {
        findButton(page.container, '退出').click();
      });
      await waitFor(
        () => findOpenDialog(page.container, '退出学习？') !== null,
        '退出确认框弹出',
      );
      pressKey(' ');
      await act(async () => {
        await sleep(30);
      });
      expect(useSessionStore.getState().revealed).toBe(false);
      // 取消退出后会话继续
      act(() => {
        findButton(findOpenDialog(page.container, '退出学习？')!, '取消').click();
      });
      await waitFor(
        () => findOpenDialog(page.container, '退出学习？') === null,
        '取消后关闭退出框',
      );
      expect(useSessionStore.getState().status).toBe('active');
    } finally {
      page.unmount();
    }
  });
});

describe('StudyPage：单栏一屏直出（iPhone）', () => {
  it('揭示门控：未揭示不渲染内联笔记区与必应链接（防泄题），揭示后一屏直出', async () => {
    await seedNewWords('apple');
    const page = mountAt('/study');
    try {
      await waitFor(() => useSessionStore.getState().status === 'active', '进入会话');

      // 未揭示：笔记可能写了词义，绝不能提前露出（含必应词典外链）
      expect(page.container.textContent).not.toContain('备注');
      expect(page.container.querySelector('a[href*="bing.com/dict"]')).toBeNull();
      // 单栏不渲染双栏词条详情面板
      expect(page.container.textContent).not.toContain('词条详情');

      // 揭示后：备注框 + 必应词典链接一屏直出
      await act(async () => {
        [...page.container.querySelectorAll('button')]
          .find((button) => button.textContent === '显示答案')!
          .click();
      });
      await waitFor(
        () => page.container.textContent?.includes('备注') ?? false,
        '揭示后内联备注区渲染',
      );
      expect(page.container.textContent).not.toContain('串记');
      expect(page.container.textContent).not.toContain('联想');
      expect(page.container.textContent).not.toContain('谐音');
      // 备注编辑区直接可写（无需抽屉/面板点击）
      expect(page.container.querySelector('textarea')).not.toBeNull();
      // 旧版抽屉入口按钮已移除
      expect(page.container.textContent).not.toContain('笔记与详情');

      // 必应词典链接：指向当前单词的必应词典页
      const bing = page.container.querySelector<HTMLAnchorElement>('a[href*="bing.com/dict"]');
      expect(bing).not.toBeNull();
      expect(bing!.textContent).toContain('必应词典');
      expect(bing!.getAttribute('href')).toBe(
        `https://cn.bing.com/dict/search?q=${encodeURIComponent('apple')}`,
      );
      expect(bing!.getAttribute('target')).toBe('_blank');

      // 会话仍在进行
      expect(useSessionStore.getState().status).toBe('active');
    } finally {
      page.unmount();
    }
  });
});
