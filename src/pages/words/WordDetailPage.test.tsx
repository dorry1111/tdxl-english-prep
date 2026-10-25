/**
 * WordDetailPage 测试（jsdom + fake-indexeddb）。
 *
 * 覆盖：
 * 1. 渲染：词头 / 音标 / 义项 / 学习记录（等级、到期、累计、正确率、上次评分）/ 最近作答；
 * 2. 兜底：词条不存在 → 未找到卡片，不白屏；
 * 3. 纯逻辑：summarizeStates 的合并口径（同 norm 多状态、求和、空列表）。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { db } from '@/db';
import { stateKeyOfNorm } from '@/lib/hash';
import { fmtDate, now } from '@/lib/time';
import type { ReviewLog, Word, WordState } from '@/types';
import WordDetailPage from './WordDetailPage';
import { accuracyOf, levelText, summarizeStates } from './wordHistory';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BOOK = 'core';

function makeWord(headword: string, overrides?: Partial<Word>): Word {
  const stamp = now();
  return {
    id: `${BOOK}:${headword}`,
    bookId: BOOK,
    headword,
    norm: headword,
    phoneticUk: '/ˈæpl/',
    phoneticUs: '/ˈæp(ə)l/',
    meanings: [
      { pos: 'n.', cn: '苹果' },
      { pos: 'n.', cn: '苹果公司' },
    ],
    mnemonic: '每天一个苹果',
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
    ...overrides,
  };
}

function makeState(norm: string, overrides?: Partial<WordState>): WordState {
  const stamp = now();
  return {
    stateKey: stateKeyOfNorm(norm),
    wordId: `${BOOK}:${norm}`,
    bookId: BOOK,
    level: 3,
    dueAt: stamp + 86_400_000,
    lastRating: 3,
    lastReviewAt: stamp - 3600_000,
    firstLearnedAt: stamp - 7200_000,
    reviewCount: 5,
    correctCount: 4,
    wrongCount: 1,
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

function makeLog(id: string, rating: ReviewLog['rating'], answeredAt: number): ReviewLog {
  return {
    id,
    wordId: `${BOOK}:apple`,
    stateKey: stateKeyOfNorm('apple'),
    sessionId: 'sess_test',
    rating,
    prevLevel: 2,
    newLevel: 3,
    prevDueAt: answeredAt - 1000,
    newDueAt: answeredAt + 86_400_000,
    answeredAt,
    durationMs: 1500,
    isRetry: false,
    deviceId: 'dev_test',
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
          <Route path="/word/:id" element={<WordDetailPage />} />
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

describe('summarizeStates（纯逻辑）', () => {
  it('空列表 / 全墓碑 → null', () => {
    expect(summarizeStates([], '1')).toBeNull();
    expect(summarizeStates([makeState('apple', { deletedAt: now() })], '1')).toBeNull();
  });

  it('单条：等级与到期取该条，计数字段原样', () => {
    const summary = summarizeStates([makeState('apple')], stateKeyOfNorm('apple'));
    expect(summary?.level).toBe(3);
    expect(summary?.reviewCount).toBe(5);
    expect(summary?.lastRating).toBe(3);
    expect(summary?.stateCount).toBe(1);
    expect(accuracyOf(summary!)).toBeCloseTo(0.8);
  });

  it('同 norm 多状态：精确命中优先，计数跨状态求和', () => {
    const states = [
      // 精确命中当前 stateKey 的那份（level 5）
      makeState('apple', { level: 5, reviewCount: 3, correctCount: 3, wrongCount: 0 }),
      // 残留状态：stateKey 不同的另一份（level 1），计数仍要并入统计
      makeState('apple', {
        stateKey: 'stale-key-001',
        level: 1,
        reviewCount: 2,
        correctCount: 1,
        wrongCount: 1,
      }),
    ];
    const summary = summarizeStates(states, stateKeyOfNorm('apple'));
    expect(summary?.level).toBe(5); // 精确命中那份
    expect(summary?.reviewCount).toBe(5); // 2 + 3
    expect(summary?.stateCount).toBe(2);
    expect(accuracyOf(summary!)).toBeCloseTo(4 / 5);
  });

  it('未答对过任何题时正确率为 null（不显示 0%）', () => {
    const summary = summarizeStates(
      [makeState('apple', { correctCount: 0, wrongCount: 0 })],
      stateKeyOfNorm('apple'),
    );
    expect(accuracyOf(summary!)).toBeNull();
    expect(levelText(7)).toBe('L7');
  });
});

describe('WordDetailPage 渲染', () => {
  it('词条 + 学习记录 + 最近作答全部渲染', async () => {
    const word = makeWord('apple');
    const state = makeState('apple');
    const log = makeLog('log_1', 3, now() - 60_000);
    await db.words.put(word);
    await db.wordStates.put(state);
    await db.reviewLogs.put(log);

    const page = mountAt(`/word/${word.id}`);
    try {
      await flushDb();
      const text = page.container.textContent ?? '';
      // 词条：词头、音标、义项、助记
      expect(text).toContain('apple');
      expect(text).toContain('/ˈæpl/');
      expect(text).toContain('苹果');
      expect(text).toContain('每天一个苹果');
      // 学习记录
      expect(text).toContain('学习记录');
      expect(text).toContain('L3');
      expect(text).toContain(fmtDate(state.dueAt));
      expect(text).toContain('80%');
      expect(text).toContain('认识'); // 上次评分 = 认识(3)
      // 最近作答
      expect(text).toContain('最近作答');
      expect(text).toContain(fmtDate(log.answeredAt));
      expect(text).toContain('L2 → L3');
      // 备注与收藏区（WordDetailPanel 自带）：备注框 + 收藏态（三类笔记 tab 已移除）
      expect(text).toContain('备注');
      expect(text).not.toContain('串记');
      expect(text).not.toContain('联想');
      expect(text).not.toContain('谐音');
      expect(text).not.toContain('我的例句');
      expect(text).toContain('已收藏');
    } finally {
      page.unmount();
    }
  }, 20_000);

  it('词条不存在 → 渲染未找到卡片，不白屏', async () => {
    const page = mountAt('/word/core:missing');
    try {
      await flushDb();
      const text = page.container.textContent ?? '';
      expect(text).toContain('没有找到这个单词。');
      expect(text).toContain('它可能已被删除，或链接不正确。');
      expect(text).toContain('返回');
    } finally {
      page.unmount();
    }
  });

  it('无学习状态 → 显示「还没有学习记录」，不显示等级', async () => {
    await db.words.put(makeWord('brave'));
    const page = mountAt('/word/core:brave');
    try {
      await flushDb();
      const text = page.container.textContent ?? '';
      expect(text).toContain('brave');
      expect(text).toContain('这个词还没有学习记录，背一次就会出现在这里。');
      expect(text).toContain('还没有作答记录。');
    } finally {
      page.unmount();
    }
  });
});
