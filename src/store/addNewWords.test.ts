/**
 * sessionStore.addNewWords 测试（BooksPage「+5 新词」入口）。
 *
 * 断言：
 * 1. 尾部追加 N 张新卡，当前卡（队首）不变；
 * 2. plannedTotal 同步抬升；
 * 3. 已在队列 / 已答过的词不会被重复加入（去重）；
 * 4. idle 状态调用是安全的空操作。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { BUILTIN_BOOK_ID } from '@/constants';
import { db } from '@/db';
import { ensureSeeded } from '@/db/seed';
import { now } from '@/lib/time';
import { setNewWordProvider, useSessionStore } from '@/store/sessionStore';
import type { Word } from '@/types';

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

const WORDS: Word[] = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10'].map(makeWord);

/** 游标式提供者：每次调用从游标处取，模拟「词库还有更多新词」 */
let cursor = 0;

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

beforeEach(async () => {
  resetStore();
  cursor = 0;
  await ensureSeeded();
  await db.words.bulkPut(WORDS);
  // 只取 3 个新词开局（设置每日新词上限 = 3）
  await db.settings.put({
    ...((await db.settings.get('global')) ?? undefined)!,
    newWordLimit: 3,
  } as never);
  setNewWordProvider(async (_settings, limit) => WORDS.slice(cursor, cursor + limit));
});

describe('sessionStore.addNewWords', () => {
  it('追加 5 个新词：队尾插入、队首不变、plannedTotal +5', async () => {
    const result = await useSessionStore.getState().start();
    expect(result).toBe('started');

    const before = useSessionStore.getState();
    const headBefore = before.machine?.queue[0]?.wordId;
    const lengthBefore = before.machine?.queue.length ?? 0;
    expect(lengthBefore).toBe(3);

    cursor = 3; // 模拟 provider 给出「后面」的新词
    const added = await useSessionStore.getState().addNewWords(5);
    expect(added).toBe(5);

    const after = useSessionStore.getState();
    expect(after.machine?.queue.length).toBe(lengthBefore + 5);
    expect(after.machine?.queue[0]?.wordId).toBe(headBefore); // 当前卡不动
    expect(after.machine?.plannedTotal).toBe((before.machine?.plannedTotal ?? 0) + 5);
  });

  it('去重：已入队列的词不会被重复加入', async () => {
    await useSessionStore.getState().start();
    // provider 只能给出「队列里已有的那 3 个词」→ 应全部被去重跳过
    setNewWordProvider(async () => WORDS.slice(0, 3));
    const added = await useSessionStore.getState().addNewWords(5);
    expect(added).toBe(0);
    expect(useSessionStore.getState().machine?.queue.length).toBe(3);
  });

  it('idle 状态调用是安全的空操作', async () => {
    const added = await useSessionStore.getState().addNewWords(5);
    expect(added).toBe(0);
    expect(useSessionStore.getState().machine).toBeNull();
  });
});
