/**
 * 词库仓库（WordBook 的读写）。
 *
 * 远端实体：`wordbook.json`（词库 + 用户导入词 + 生词本同属一个文件，见 ARCHITECTURE 4.2）
 * 分层约束：只有仓库可以访问 db；每个写操作都在事务内完成并标记脏分片。
 */
import { REMOTE_FILES } from '@/constants';
import { db, markDirty, toDbError } from '@/db';
import { AppError } from '@/lib/errors';
import { now } from '@/lib/time';
import type { WordBook } from '@/types';

/** 该仓库对应的远端实体文件 */
const ENTITY = REMOTE_FILES.wordbook;

/** 列出全部词库（默认过滤墓碑），按优先级升序 */
export async function listBooks(includeDeleted = false): Promise<WordBook[]> {
  const books = await db.books.toArray();
  return books
    .filter((book) => (includeDeleted ? true : book.deletedAt === null))
    .sort((left, right) => left.priority - right.priority);
}

/** 按 ID 取词库（墓碑记录也返回，便于同步对账） */
export async function getBook(id: string): Promise<WordBook | undefined> {
  return db.books.get(id);
}

/** 新建或整体覆盖一个词库 */
export async function upsertBook(book: WordBook): Promise<void> {
  try {
    await db.transaction('rw', db.books, db.syncMeta, async () => {
      await db.books.put(book);
      await markDirty(ENTITY, 1);
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 局部更新一个词库（不存在则抛 BOOK_NOT_FOUND） */
export async function patchBook(
  id: string,
  partial: Partial<Omit<WordBook, 'id'>>,
): Promise<WordBook> {
  try {
    return await db.transaction('rw', db.books, db.syncMeta, async () => {
      const existing = await db.books.get(id);
      if (!existing) {
        throw new AppError('BOOK_NOT_FOUND', { id });
      }
      const next: WordBook = { ...existing, ...partial, updatedAt: now() };
      await db.books.put(next);
      await markDirty(ENTITY, 1);
      return next;
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 启用/停用一个词库 */
export async function setEnabled(id: string, enabled: boolean): Promise<WordBook> {
  return patchBook(id, { enabled });
}

/** 软删除（写墓碑，同步时另一端会跟着删除） */
export async function softDeleteBook(id: string): Promise<void> {
  try {
    await db.transaction('rw', db.books, db.syncMeta, async () => {
      const existing = await db.books.get(id);
      if (!existing) {
        throw new AppError('BOOK_NOT_FOUND', { id });
      }
      const stamp = now();
      await db.books.put({ ...existing, deletedAt: stamp, updatedAt: stamp, enabled: false });
      await markDirty(ENTITY, 1);
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 词库总数（不含墓碑） */
export async function countBooks(): Promise<number> {
  const books = await db.books.toArray();
  return books.filter((book) => book.deletedAt === null).length;
}
