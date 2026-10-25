/**
 * noteRepo 测试（笔记与高亮批次）：读写 / upsert 语义 / 软删除 / 标脏。
 *
 * 环境由 src/test/setup.ts 提供：fake-indexeddb + 每用例清库。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { REMOTE_FILES, TABLE } from '@/constants';
import { db, getSyncMeta } from '@/db';
import {
  addExample,
  addHighlight,
  deleteHighlight,
  deleteNote,
  listHighlightsByStateKey,
  listNotesByStateKey,
  upsertNote,
} from '@/db/repos/noteRepo';
import { setStarred } from '@/db/repos/stateRepo';
import { stateKeyOfNorm } from '@/lib/hash';

const WORD_ID = 'core:alpha';
const STATE_KEY = stateKeyOfNorm('alpha');
const ENTITY = REMOTE_FILES.wordbook;

async function dirtyCount(): Promise<number> {
  const meta = await getSyncMeta(ENTITY);
  return meta?.pendingCount ?? 0;
}

beforeEach(async () => {
  if (!db.isOpen()) {
    await db.open();
  }
});

describe('noteRepo.upsertNote', () => {
  it('新建一条串记，字段完整且 wordbook.json 被标脏', async () => {
    const saved = await upsertNote({
      stateKey: STATE_KEY,
      wordId: WORD_ID,
      kind: 'chunk',
      content: 'alpha 和 alphabet 串起来记',
    });

    expect(saved.id).toMatch(/^wnote_/);
    expect(saved.kind).toBe('chunk');
    expect(saved.content).toBe('alpha 和 alphabet 串起来记');
    expect(saved.zh).toBeNull();
    expect(saved.deletedAt).toBeNull();
    expect(await dirtyCount()).toBe(1);

    const rows = await db.table(TABLE.wordNotes).toArray();
    expect(rows).toHaveLength(1);
  });

  it('同词同类再次写入 = 覆盖同一条（upsert，不产生第二行）', async () => {
    const first = await upsertNote({
      stateKey: STATE_KEY,
      wordId: WORD_ID,
      kind: 'chunk',
      content: 'v1',
    });
    const second = await upsertNote({
      stateKey: STATE_KEY,
      wordId: WORD_ID,
      kind: 'chunk',
      content: 'v2',
    });

    expect(second.id).toBe(first.id);
    const rows = await db.table(TABLE.wordNotes).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBe('v2');
  });

  it('不同类型互不影响；其他词的同类互不影响', async () => {
    await upsertNote({ stateKey: STATE_KEY, wordId: WORD_ID, kind: 'chunk', content: 'c' });
    await upsertNote({ stateKey: STATE_KEY, wordId: WORD_ID, kind: 'assoc', content: 'a' });
    await upsertNote({ stateKey: STATE_KEY, wordId: WORD_ID, kind: 'homophone', content: 'h' });
    await upsertNote({
      stateKey: stateKeyOfNorm('bravo'),
      wordId: 'core:bravo',
      kind: 'chunk',
      content: 'other',
    });

    const mine = await listNotesByStateKey(STATE_KEY);
    expect(mine).toHaveLength(3);
    expect(mine.map((note) => note.kind).sort()).toEqual(['assoc', 'chunk', 'homophone']);
  });

  it('按 kind 过滤查询走复合索引语义', async () => {
    await upsertNote({ stateKey: STATE_KEY, wordId: WORD_ID, kind: 'chunk', content: 'c' });
    await upsertNote({ stateKey: STATE_KEY, wordId: WORD_ID, kind: 'assoc', content: 'a' });
    const onlyChunk = await listNotesByStateKey(STATE_KEY, 'chunk');
    expect(onlyChunk).toHaveLength(1);
    expect(onlyChunk[0]?.kind).toBe('chunk');
  });

  it('软删除后 list 不再返回；再 upsert 同类会复活', async () => {
    const saved = await upsertNote({ stateKey: STATE_KEY, wordId: WORD_ID, kind: 'chunk', content: 'c' });
    await deleteNote(saved.id);
    expect(await listNotesByStateKey(STATE_KEY)).toHaveLength(0);
    // 墓碑仍在库里
    const rows = await db.table(TABLE.wordNotes).toArray();
    expect(rows[0]?.deletedAt).not.toBeNull();

    const revived = await upsertNote({ stateKey: STATE_KEY, wordId: WORD_ID, kind: 'chunk', content: 'c2' });
    expect(revived.id).toBe(saved.id);
    expect(revived.deletedAt).toBeNull();
    expect(await listNotesByStateKey(STATE_KEY)).toHaveLength(1);
  });
});

describe('noteRepo.addExample', () => {
  it('en 必填：空串抛 INVALID_INPUT，不写库', async () => {
    await expect(
      addExample({ stateKey: STATE_KEY, wordId: WORD_ID, en: '   ', zh: null }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await db.table(TABLE.wordNotes).count()).toBe(0);
  });

  it('一词多条例句；zh 空白归一为 null', async () => {
    const one = await addExample({ stateKey: STATE_KEY, wordId: WORD_ID, en: 'Alpha wins.', zh: ' Alpha 赢了。 ' });
    const two = await addExample({ stateKey: STATE_KEY, wordId: WORD_ID, en: 'Beta loses.', zh: '   ' });

    expect(one.id).not.toBe(two.id);
    expect(one.zh).toBe('Alpha 赢了。');
    expect(two.zh).toBeNull();

    const rows = await listNotesByStateKey(STATE_KEY, 'example');
    expect(rows).toHaveLength(2);
    expect(rows.map((note) => note.content)).toEqual(['Alpha wins.', 'Beta loses.']);
  });
});

describe('noteRepo.addHighlight / deleteHighlight', () => {
  it('新增高亮并按 stateKey 查询；同文本可多条（后写覆盖渲染由渲染层决定）', async () => {
    const first = await addHighlight({
      stateKey: STATE_KEY,
      wordId: WORD_ID,
      scope: 'headword',
      exampleIndex: null,
      text: 'alpha',
      color: 1,
    });
    const second = await addHighlight({
      stateKey: STATE_KEY,
      wordId: WORD_ID,
      scope: 'example',
      exampleIndex: 0,
      text: 'wins',
      color: 3,
    });

    expect(first.id).toMatch(/^whl_/);
    expect(second.exampleIndex).toBe(0);
    expect(await listHighlightsByStateKey(STATE_KEY)).toHaveLength(2);
    expect(await dirtyCount()).toBe(2);
  });

  it('空文本拒绝写入', async () => {
    await expect(
      addHighlight({ stateKey: STATE_KEY, wordId: WORD_ID, scope: 'headword', exampleIndex: null, text: '', color: 2 }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('软删除后不再返回，且墓碑保留', async () => {
    const saved = await addHighlight({
      stateKey: STATE_KEY,
      wordId: WORD_ID,
      scope: 'meaning',
      exampleIndex: null,
      text: '字母 A',
      color: 4,
    });
    await deleteHighlight(saved.id);
    expect(await listHighlightsByStateKey(STATE_KEY)).toHaveLength(0);
    const rows = await db.table(TABLE.wordHighlights).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).not.toBeNull();
  });
});

describe('stateRepo.setStarred（收藏，本批次配套）', () => {
  it('状态不存在时创建初始状态（L=0 未调度）并置 isStarred', async () => {
    await setStarred(STATE_KEY, WORD_ID, true);
    const state = await db.wordStates.get(STATE_KEY);
    expect(state?.isStarred).toBe(true);
    expect(state?.level).toBe(0);
    expect(state?.dueAt).toBe(0);
    expect(state?.firstLearnedAt).toBeNull();
    // 标脏落在 stateKey 对应分片
    const metas = await db.syncMeta.toArray();
    expect(metas.some((meta) => meta.entity.startsWith('wordstate-') && meta.dirtyAt !== null)).toBe(true);
  });

  it('已有状态只翻转 isStarred，其他字段不动', async () => {
    const stamp = Date.now();
    await db.wordStates.put({
      stateKey: STATE_KEY,
      wordId: WORD_ID,
      bookId: 'core',
      level: 3,
      dueAt: stamp,
      lastRating: 3,
      lastReviewAt: stamp,
      firstLearnedAt: stamp,
      reviewCount: 5,
      correctCount: 4,
      wrongCount: 1,
      lapseCount: 0,
      retryCountToday: 0,
      retryDay: '2026-10-24',
      unstable: false,
      isStarred: false,
      masteredAt: null,
      updatedAt: stamp,
      deletedAt: null,
    });

    await setStarred(STATE_KEY, WORD_ID, true);
    let state = await db.wordStates.get(STATE_KEY);
    expect(state?.isStarred).toBe(true);
    expect(state?.reviewCount).toBe(5);
    expect(state?.level).toBe(3);

    await setStarred(STATE_KEY, WORD_ID, false);
    state = await db.wordStates.get(STATE_KEY);
    expect(state?.isStarred).toBe(false);
  });
});
