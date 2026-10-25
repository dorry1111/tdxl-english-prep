/**
 * 生词本仓库。
 *
 * 远端实体：`wordbook.json`
 * 生词本条目与「学习状态」是两套东西：
 * - NotebookEntry 是用户主动收藏/从真题加入的条目（可能同一个词多条，来源不同）；
 * - 学习状态按 stateKey 共享，收藏只是 `WordState.isStarred` 的冗余标记。
 */
import { REMOTE_FILES } from '@/constants';
import { db, markDirty, toDbError } from '@/db';
import { newId } from '@/lib/id';
import { now } from '@/lib/time';
import type { NotebookEntry } from '@/types';

const ENTITY = REMOTE_FILES.wordbook;

/** 新建一条生词本条目所需的入参 */
export interface NewNotebookEntryInput {
  wordId: string;
  headword: string;
  source: 'manual' | 'exam-wrong' | 'imported';
  sourceRef?: string | null;
  note?: string;
}

/** 新增生词本条目（ID 规则：note_xxx，同一词可能多条） */
export async function add(input: NewNotebookEntryInput): Promise<NotebookEntry> {
  const stamp = now();
  const entry: NotebookEntry = {
    id: newId('note'),
    wordId: input.wordId,
    headword: input.headword,
    source: input.source,
    sourceRef: input.sourceRef ?? null,
    note: input.note ?? '',
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  };
  try {
    await db.transaction('rw', db.notebook, db.syncMeta, async () => {
      await db.notebook.put(entry);
      await markDirty(ENTITY, 1);
    });
    return entry;
  } catch (error) {
    throw toDbError(error);
  }
}

/** 列出未删除的条目（按创建时间倒序，最新的在前） */
export async function listActive(): Promise<NotebookEntry[]> {
  const rows = await db.notebook.toArray();
  return rows
    .filter((entry) => entry.deletedAt === null)
    .sort((left, right) => right.createdAt - left.createdAt);
}

/** 按来源筛选 */
export async function listBySource(
  source: NotebookEntry['source'],
): Promise<NotebookEntry[]> {
  const rows = await db.notebook.where('source').equals(source).toArray();
  return rows
    .filter((entry) => entry.deletedAt === null)
    .sort((left, right) => right.createdAt - left.createdAt);
}

/** 按词条 ID 查（用于「是否已收藏」判断） */
export async function findByWordId(wordId: string): Promise<NotebookEntry[]> {
  const rows = await db.notebook.where('wordId').equals(wordId).toArray();
  return rows.filter((entry) => entry.deletedAt === null);
}

/** 是否已收藏 */
export async function isWordInNotebook(wordId: string): Promise<boolean> {
  const rows = await findByWordId(wordId);
  return rows.length > 0;
}

/** 更新备注 */
export async function updateNote(id: string, note: string): Promise<NotebookEntry | undefined> {
  try {
    return await db.transaction('rw', db.notebook, db.syncMeta, async () => {
      const existing = await db.notebook.get(id);
      if (!existing) {
        return undefined;
      }
      const next: NotebookEntry = { ...existing, note, updatedAt: now() };
      await db.notebook.put(next);
      await markDirty(ENTITY, 1);
      return next;
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 软删除（写墓碑，另一端同步后消失且不会复活） */
export async function remove(id: string): Promise<void> {
  try {
    await db.transaction('rw', db.notebook, db.syncMeta, async () => {
      const existing = await db.notebook.get(id);
      if (!existing) {
        return;
      }
      const stamp = now();
      await db.notebook.put({ ...existing, deletedAt: stamp, updatedAt: stamp });
      await markDirty(ENTITY, 1);
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 未删除条目数（首页/侧栏小红点用） */
export async function countActive(): Promise<number> {
  const rows = await db.notebook.toArray();
  return rows.filter((entry) => entry.deletedAt === null).length;
}
