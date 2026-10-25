/**
 * textHighlightRepo 测试（P3 真题划词）：新增/更新/软删/按锚点查询/标脏。
 *
 * 环境由 src/test/setup.ts 提供：fake-indexeddb + 每用例清库。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { REMOTE_FILES, TABLE } from '@/constants';
import { db, getSyncMeta } from '@/db';
import {
  addTextHighlight,
  listTextHighlightsByAnchorId,
  listTextHighlightsByPaper,
  softDeleteTextHighlight,
  updateTextHighlight,
} from '@/db/repos/textHighlightRepo';

const ENTITY = REMOTE_FILES.wordbook;
const PASSAGE_ID = 'draft-p-reading-1';
const QUESTION_ID = 'draft-q-12';

async function dirtyCount(): Promise<number> {
  const meta = await getSyncMeta(ENTITY);
  return meta?.pendingCount ?? 0;
}

beforeEach(async () => {
  if (!db.isOpen()) {
    await db.open();
  }
});

describe('textHighlightRepo.addTextHighlight', () => {
  it('新增一条段落高亮，字段完整且 wordbook 被标脏', async () => {
    const saved = await addTextHighlight({
      anchorKind: 'passage',
      anchorId: PASSAGE_ID,
      blockKey: 'p:0',
      text: 'global warming',
      start: 12,
      color: 2,
      note: '高频考点词',
      wordNorm: null,
    });

    expect(saved.id).toMatch(/^thl_/);
    expect(saved.anchorKind).toBe('passage');
    expect(saved.anchorId).toBe(PASSAGE_ID);
    expect(saved.blockKey).toBe('p:0');
    expect(saved.text).toBe('global warming');
    expect(saved.start).toBe(12);
    expect(saved.color).toBe(2);
    expect(saved.note).toBe('高频考点词');
    expect(saved.deletedAt).toBeNull();
    expect(await dirtyCount()).toBe(1);

    const rows = await db.table(TABLE.textHighlights).toArray();
    expect(rows).toHaveLength(1);
  });

  it('笔记纯空白归一为 null；text 为空串时拒绝', async () => {
    const saved = await addTextHighlight({
      anchorKind: 'question',
      anchorId: QUESTION_ID,
      blockKey: 'stem',
      text: '  eclipse  ',
      start: null,
      color: 1,
      note: '   ',
      wordNorm: 'eclipse',
    });
    expect(saved.text).toBe('eclipse');
    expect(saved.note).toBeNull();

    await expect(
      addTextHighlight({
        anchorKind: 'question',
        anchorId: QUESTION_ID,
        blockKey: 'stem',
        text: '   ',
        start: null,
        color: 1,
        note: null,
        wordNorm: null,
      }),
    ).rejects.toThrow();
  });
});

describe('textHighlightRepo.updateTextHighlight', () => {
  it('更新颜色与笔记；软删后不可再更新', async () => {
    const saved = await addTextHighlight({
      anchorKind: 'passage',
      anchorId: PASSAGE_ID,
      blockKey: 'p:1',
      text: 'carbon dioxide',
      start: 3,
      color: 1,
      note: null,
      wordNorm: null,
    });

    const updated = await updateTextHighlight(saved.id, { color: 4, note: '温室气体' });
    expect(updated?.color).toBe(4);
    expect(updated?.note).toBe('温室气体');

    await softDeleteTextHighlight(saved.id);
    expect(await updateTextHighlight(saved.id, { color: 2 })).toBeNull();
  });

  it('不存在的主键返回 null，不抛错', async () => {
    expect(await updateTextHighlight('thl_missing', { color: 3 })).toBeNull();
  });
});

describe('textHighlightRepo.listTextHighlightsByAnchorId', () => {
  it('按锚点过滤且排除软删，按创建时间升序', async () => {
    const first = await addTextHighlight({
      anchorKind: 'passage',
      anchorId: PASSAGE_ID,
      blockKey: 'p:0',
      text: 'alpha',
      start: 0,
      color: 1,
      note: null,
      wordNorm: null,
    });
    const second = await addTextHighlight({
      anchorKind: 'passage',
      anchorId: PASSAGE_ID,
      blockKey: 'p:2',
      text: 'beta',
      start: 5,
      color: 2,
      note: null,
      wordNorm: null,
    });
    await addTextHighlight({
      anchorKind: 'question',
      anchorId: QUESTION_ID,
      blockKey: 'stem',
      text: 'gamma',
      start: null,
      color: 3,
      note: null,
      wordNorm: null,
    });
    await softDeleteTextHighlight(first.id);

    const rows = await listTextHighlightsByAnchorId(PASSAGE_ID);
    expect(rows.map((row) => row.id)).toEqual([second.id]);

    const questionRows = await listTextHighlightsByAnchorId(QUESTION_ID);
    expect(questionRows).toHaveLength(1);
    expect(questionRows[0]?.text).toBe('gamma');
  });
});

describe('textHighlightRepo.listTextHighlightsByPaper', () => {
  it('按锚点集合过滤；空集合直接返回空数组', async () => {
    await addTextHighlight({
      anchorKind: 'passage',
      anchorId: PASSAGE_ID,
      blockKey: 'p:0',
      text: 'alpha',
      start: 0,
      color: 1,
      note: null,
      wordNorm: null,
    });
    await addTextHighlight({
      anchorKind: 'question',
      anchorId: QUESTION_ID,
      blockKey: 'stem',
      text: 'beta',
      start: null,
      color: 2,
      note: null,
      wordNorm: null,
    });

    const rows = await listTextHighlightsByPaper([PASSAGE_ID, QUESTION_ID]);
    expect(rows).toHaveLength(2);
    expect(await listTextHighlightsByPaper([])).toEqual([]);
  });
});
