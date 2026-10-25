/**
 * 笔记与高亮仓库（学习页批次新增）。
 *
 * 远端实体：`wordbook.json`（与生词本、词库同文件，写入即 markDirty）。
 * 两类数据：
 * - WordNote：串记 / 联想 / 谐音（每词每类一条，upsert 语义）+ 用户例句（一词多条）；
 * - WordHighlight：卡片文本高亮（同段文本可重复高亮，渲染取最新一档）。
 *
 * 删除一律软删（写墓碑 deletedAt），与全局同步协议保持一致（ARCHITECTURE 4.2）。
 */
import { REMOTE_FILES } from '@/constants';
import { db, markDirty, toDbError } from '@/db';
import { assertValid } from '@/lib/errors';
import { newId } from '@/lib/id';
import { now } from '@/lib/time';
import type {
  HighlightColor,
  HighlightScope,
  WordHighlight,
  WordNote,
  WordNoteKind,
} from '@/types';

const ENTITY = REMOTE_FILES.wordbook;

/** 除例句外的三类笔记（每词每类一条） */
export type StructuredNoteKind = Exclude<WordNoteKind, 'example'>;

/** 写入/更新一类笔记的入参 */
export interface UpsertNoteInput {
  stateKey: string;
  wordId: string;
  kind: StructuredNoteKind;
  content: string;
}

/** 新增一条用户例句的入参（en 必填，zh 可选） */
export interface AddExampleInput {
  stateKey: string;
  wordId: string;
  en: string;
  zh: string | null;
}

/** 新增一条高亮的入参 */
export interface AddHighlightInput {
  stateKey: string;
  wordId: string;
  scope: HighlightScope;
  /** scope='example' 时为例句下标；headword/meaning 恒为 null */
  exampleIndex: number | null;
  text: string;
  color: HighlightColor;
}

/**
 * 写入/更新一类结构化笔记（chunk/assoc/homophone，每词每类一条）。
 *
 * - 已存在（含墓碑）→ 复用主键覆盖内容并复活（deletedAt 清空）；
 * - 不存在 → 新建 `wnote_xxx`。
 */
export async function upsertNote(input: UpsertNoteInput): Promise<WordNote> {
  assertValid(input.content.trim().length > 0, 'note content must not be empty');
  try {
    return await db.transaction('rw', db.wordNotes, db.syncMeta, async () => {
      const stamp = now();
      const existing = await db.wordNotes
        .where('[stateKey+kind]')
        .equals([input.stateKey, input.kind])
        .first();
      if (existing) {
        const next: WordNote = {
          ...existing,
          wordId: input.wordId,
          content: input.content,
          zh: null,
          updatedAt: stamp,
          deletedAt: null,
        };
        await db.wordNotes.put(next);
        await markDirty(ENTITY, 1);
        return next;
      }
      const created: WordNote = {
        id: newId('wnote'),
        stateKey: input.stateKey,
        wordId: input.wordId,
        kind: input.kind,
        content: input.content,
        zh: null,
        createdAt: stamp,
        updatedAt: stamp,
        deletedAt: null,
      };
      await db.wordNotes.put(created);
      await markDirty(ENTITY, 1);
      return created;
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 新增一条用户例句（一词多条，不做去重；en 必填校验在仓库层兜底） */
export async function addExample(input: AddExampleInput): Promise<WordNote> {
  const en = input.en.trim();
  assertValid(en.length > 0, 'example en must not be empty');
  const zh = input.zh?.trim() ?? '';
  try {
    const entry: WordNote = {
      id: newId('wnote'),
      stateKey: input.stateKey,
      wordId: input.wordId,
      kind: 'example',
      content: en,
      zh: zh.length > 0 ? zh : null,
      createdAt: now(),
      updatedAt: now(),
      deletedAt: null,
    };
    await db.transaction('rw', db.wordNotes, db.syncMeta, async () => {
      await db.wordNotes.put(entry);
      await markDirty(ENTITY, 1);
    });
    return entry;
  } catch (error) {
    throw toDbError(error);
  }
}

/**
 * 列出某词的笔记。
 *
 * @param stateKey 学习身份键
 * @param kind 可选，按类型过滤（走 [stateKey+kind] 复合索引）
 */
export async function listNotesByStateKey(
  stateKey: string,
  kind?: WordNoteKind,
): Promise<WordNote[]> {
  const rows = kind
    ? await db.wordNotes.where('[stateKey+kind]').equals([stateKey, kind]).toArray()
    : await db.wordNotes.where('stateKey').equals(stateKey).toArray();
  return rows
    .filter((row) => row.deletedAt === null)
    .sort((left, right) => left.createdAt - right.createdAt);
}

/** 软删除一条笔记（三类笔记与用户例句通用） */
export async function deleteNote(id: string): Promise<void> {
  try {
    await db.transaction('rw', db.wordNotes, db.syncMeta, async () => {
      const existing = await db.wordNotes.get(id);
      if (!existing) {
        return;
      }
      const stamp = now();
      await db.wordNotes.put({ ...existing, deletedAt: stamp, updatedAt: stamp });
      await markDirty(ENTITY, 1);
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 新增一条高亮（每次追加一条新记录，不做合并；同文本多记录由渲染层取最新） */
export async function addHighlight(input: AddHighlightInput): Promise<WordHighlight> {
  assertValid(input.text.trim().length > 0, 'highlight text must not be empty');
  try {
    const entry: WordHighlight = {
      id: newId('whl'),
      stateKey: input.stateKey,
      wordId: input.wordId,
      scope: input.scope,
      exampleIndex: input.exampleIndex,
      text: input.text,
      color: input.color,
      createdAt: now(),
      updatedAt: now(),
      deletedAt: null,
    };
    await db.transaction('rw', db.wordHighlights, db.syncMeta, async () => {
      await db.wordHighlights.put(entry);
      await markDirty(ENTITY, 1);
    });
    return entry;
  } catch (error) {
    throw toDbError(error);
  }
}

/** 列出某词的全部有效高亮（按创建时间升序，同文本后写的覆盖先写的） */
export async function listHighlightsByStateKey(stateKey: string): Promise<WordHighlight[]> {
  const rows = await db.wordHighlights.where('stateKey').equals(stateKey).toArray();
  return rows
    .filter((row) => row.deletedAt === null)
    .sort((left, right) => left.createdAt - right.createdAt);
}

/** 软删除一条高亮（点击已有高亮的删除按钮时调用） */
export async function deleteHighlight(id: string): Promise<void> {
  try {
    await db.transaction('rw', db.wordHighlights, db.syncMeta, async () => {
      const existing = await db.wordHighlights.get(id);
      if (!existing) {
        return;
      }
      const stamp = now();
      await db.wordHighlights.put({ ...existing, deletedAt: stamp, updatedAt: stamp });
      await markDirty(ENTITY, 1);
    });
  } catch (error) {
    throw toDbError(error);
  }
}
