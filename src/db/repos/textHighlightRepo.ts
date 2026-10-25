/**
 * 真题划词高亮与笔记仓库（P3 新增）。
 *
 * 远端实体：`wordbook.json`（与生词本、单词笔记同文件，写入即 markDirty）。
 * 锚点：passageId / questionId（内置卷确定性 ID，跨设备同步后仍可还原）。
 *
 * 删除一律软删（写墓碑 deletedAt），与全局同步协议保持一致（ARCHITECTURE 4.2）。
 */
import { REMOTE_FILES } from '@/constants';
import { db, markDirty, toDbError } from '@/db';
import { assertValid } from '@/lib/errors';
import { newId } from '@/lib/id';
import { now } from '@/lib/time';
import type { HighlightColor, TextAnchorKind, TextHighlight } from '@/types';

const ENTITY = REMOTE_FILES.wordbook;

/** 新增一条真题划词高亮/笔记的入参 */
export interface AddTextHighlightInput {
  anchorKind: TextAnchorKind;
  anchorId: string;
  blockKey: string;
  text: string;
  start: number | null;
  color: HighlightColor;
  note: string | null;
  wordNorm: string | null;
}

/** 更新一条高亮的颜色/笔记（主键定位，不换锚点） */
export interface UpdateTextHighlightInput {
  color?: HighlightColor;
  note?: string | null;
}

/**
 * 新增一条真题划词高亮（每次追加一条新记录，不做合并；
 * 同位置重复高亮由渲染层取 createdAt 最新的一档）。
 */
export async function addTextHighlight(input: AddTextHighlightInput): Promise<TextHighlight> {
  assertValid(input.text.trim().length > 0, 'text highlight must not be empty');
  try {
    const entry: TextHighlight = {
      id: newId('thl'),
      anchorKind: input.anchorKind,
      anchorId: input.anchorId,
      blockKey: input.blockKey,
      text: input.text.trim(),
      start: input.start,
      color: input.color,
      note: input.note && input.note.trim() !== '' ? input.note.trim() : null,
      wordNorm: input.wordNorm,
      createdAt: now(),
      updatedAt: now(),
      deletedAt: null,
    };
    await db.transaction('rw', db.textHighlights, db.syncMeta, async () => {
      await db.textHighlights.put(entry);
      await markDirty(ENTITY, 1);
    });
    return entry;
  } catch (error) {
    throw toDbError(error);
  }
}

/** 更新颜色/笔记（不存在或已软删则返回 null） */
export async function updateTextHighlight(
  id: string,
  patch: UpdateTextHighlightInput,
): Promise<TextHighlight | null> {
  try {
    let updated: TextHighlight | null = null;
    await db.transaction('rw', db.textHighlights, db.syncMeta, async () => {
      const existing = await db.textHighlights.get(id);
      if (!existing || existing.deletedAt !== null) {
        return;
      }
      const stamp = now();
      const next: TextHighlight = {
        ...existing,
        color: patch.color ?? existing.color,
        note: patch.note !== undefined ? (patch.note && patch.note.trim() !== '' ? patch.note.trim() : null) : existing.note,
        updatedAt: stamp,
      };
      await db.textHighlights.put(next);
      await markDirty(ENTITY, 1);
      updated = next;
    });
    return updated;
  } catch (error) {
    throw toDbError(error);
  }
}

/** 软删除一条真题划词高亮 */
export async function softDeleteTextHighlight(id: string): Promise<void> {
  try {
    await db.transaction('rw', db.textHighlights, db.syncMeta, async () => {
      const existing = await db.textHighlights.get(id);
      if (!existing) {
        return;
      }
      const stamp = now();
      await db.textHighlights.put({ ...existing, deletedAt: stamp, updatedAt: stamp });
      await markDirty(ENTITY, 1);
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 列出某锚点的全部有效高亮（按创建时间升序；anchorId 索引） */
export async function listTextHighlightsByAnchorId(anchorId: string): Promise<TextHighlight[]> {
  const rows = await db.textHighlights.where('anchorId').equals(anchorId).toArray();
  return rows
    .filter((row) => row.deletedAt === null)
    .sort((left, right) => left.createdAt - right.createdAt);
}

/** 列出某套卷的全部有效高亮（做题记录/搜索侧用；全表过滤，量级在千条以内） */
export async function listTextHighlightsByPaper(
  anchorIds: readonly string[],
): Promise<TextHighlight[]> {
  if (anchorIds.length === 0) {
    return [];
  }
  const wanted = new Set(anchorIds);
  const rows = await db.textHighlights.toArray();
  return rows
    .filter((row) => row.deletedAt === null && wanted.has(row.anchorId))
    .sort((left, right) => left.createdAt - right.createdAt);
}
