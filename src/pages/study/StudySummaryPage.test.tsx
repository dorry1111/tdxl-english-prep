/**
 * StudySummaryPage 组件级测试（QA 二层验证）。
 *
 * 覆盖：
 * - 直接访问 /study/summary 无结算数据 → 空态而非白屏；
 * - settleSummary 就绪 → 词数 / 正确率 / 四档分布 / 用时 / 不稳定词正确渲染；
 * - 边界：四档计数全 0 不产生 NaN；「返回首页」触发 exit()。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { useSessionStore, type SettleSummary } from '@/store/sessionStore';
import StudySummaryPage from './StudySummaryPage';
import type { StudySession } from '@/types';

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

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor 超时: ${label}`);
    }
    await act(async () => {
      await sleep(10);
    });
  }
}

function mountAt(path: string): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
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

function makeSummary(overrides?: Partial<SettleSummary>): SettleSummary {
  return {
    answeredCount: 5,
    accuracy: { correct: 4, total: 5, rate: 0.8 },
    ratingCounts: { '1': 1, '2': 0, '3': 3, '4': 1 },
    durationSec: 750,
    unstableCount: 2,
    ...overrides,
  };
}

function makeSession(newCount: number, reviewCount: number): StudySession {
  return {
    id: 'sess_test',
    studyDay: '2026-10-24',
    startedAt: Date.now() - 750_000,
    endedAt: Date.now(),
    newCount,
    reviewCount,
    answerCount: 5,
    correctCount: 4,
    ratingCounts: { '1': 1, '2': 0, '3': 3, '4': 1 },
    durationSec: 750,
    unstableWordIds: ['core:a', 'core:b'],
    deviceId: 'dev',
    updatedAt: Date.now(),
    deletedAt: null,
  };
}

beforeEach(() => {
  resetStore();
});

describe('StudySummaryPage：空态', () => {
  it('直接访问且无结算数据 → 明确空态，不白屏', async () => {
    const page = mountAt('/study/summary');
    try {
      await waitFor(
        () => (page.container.textContent ?? '').length > 0,
        '页面渲染',
      );
      expect(page.container.textContent).toContain('本次学习');
      expect(page.container.textContent).toContain('没有可显示的结算数据');
      expect(page.container.textContent).not.toContain('NaN');
    } finally {
      page.unmount();
    }
  });

  it('空态点「返回首页」→ 触发 exit()（内存会话被清理）', async () => {
    // 预置非 idle 状态，用 exit() 后回到 idle 证明被调用
    useSessionStore.setState({ status: 'settled', settleSummary: null });
    const page = mountAt('/study/summary');
    try {
      await waitFor(
        () => (page.container.textContent ?? '').includes('返回首页'),
        '空态渲染',
      );
      const back = Array.from(page.container.querySelectorAll('button')).find(
        (button) => button.textContent === '返回首页',
      );
      expect(back).toBeDefined();
      act(() => {
        back!.click();
      });
      expect(useSessionStore.getState().status).toBe('idle');
    } finally {
      page.unmount();
    }
  });
});

describe('StudySummaryPage：结算数据渲染', () => {
  it('展示词数 / 新复习拆分 / 正确率 / 四档分布 / 用时 / 不稳定词', async () => {
    useSessionStore.setState({
      status: 'settled',
      session: makeSession(3, 2),
      settleSummary: makeSummary(),
    });
    const page = mountAt('/study/summary');
    try {
      const text = page.container.textContent ?? '';
      expect(text).toContain('本次学习');
      expect(text).toContain('5'); // 本次词数
      expect(text).toContain('新词 3 · 复习 2');
      expect(text).toContain('80%（4/5）'); // 用例 A 口径正确率
      expect(text).toContain('12 分 30 秒'); // 750s
      // 四档分布四行都在（标签来自 STUDY 常量）
      expect(text).toContain('不认识');
      expect(text).toContain('模糊');
      expect(text).toContain('认识');
      expect(text).toContain('熟识');
      // 不稳定词提醒卡
      expect(text).toContain('不稳定词');
      expect(text).toContain('2 个词今日达重现上限仍答错');
      expect(text).not.toContain('NaN');
    } finally {
      page.unmount();
    }
  });

  it('不稳定词为 0 时不渲染提醒卡', async () => {
    useSessionStore.setState({
      status: 'settled',
      session: makeSession(0, 1),
      settleSummary: makeSummary({ unstableCount: 0 }),
    });
    const page = mountAt('/study/summary');
    try {
      await waitFor(
        () => (page.container.textContent ?? '').includes('本次学习'),
        '渲染',
      );
      expect(page.container.textContent).not.toContain('建议明天优先重背');
    } finally {
      page.unmount();
    }
  });

  it('边界：四档计数全为 0 → 分布条渲染为 0 宽，不产生 NaN/Infinity', async () => {
    useSessionStore.setState({
      status: 'settled',
      session: makeSession(0, 0),
      settleSummary: makeSummary({
        answeredCount: 0,
        accuracy: { correct: 0, total: 0, rate: 0 },
        ratingCounts: { '1': 0, '2': 0, '3': 0, '4': 0 },
        durationSec: 0,
        unstableCount: 0,
      }),
    });
    const page = mountAt('/study/summary');
    try {
      await waitFor(
        () => (page.container.textContent ?? '').includes('本次学习'),
        '渲染',
      );
      const text = page.container.textContent ?? '';
      expect(text).toContain('—'); // 无正确率数据占位
      expect(text).toContain('0 秒'); // durationMs 为 0
      expect(text).not.toContain('NaN');
      expect(text).not.toContain('Infinity');
      // 四条分布条都是 0 宽度
      const bars = Array.from(
        page.container.querySelectorAll<HTMLElement>('div[style*="width"]'),
      );
      expect(bars.length).toBe(4);
      for (const bar of bars) {
        expect(bar.style.width).toBe('0%');
      }
    } finally {
      page.unmount();
    }
  });
});
