/**
 * 当前学习词书的读写（BooksPage 用，口径与取词链路一致）。
 *
 * 【一致性约定】sessionStore 的取词遍历 `settings.activeBookIds`，
 * 因此「选择词书」必须同时维护 `activeBookIds` 与 `currentBookId`，
 * 保证 HomePage「开始背单词」与学习页取词走的是同一份数据：
 * - 单书模式（bookMode='single'）：activeBookIds = [所选词书]，currentBookId = 所选词书；
 * - 叠加模式（bookMode='stack'）：activeBookIds = 用户勾选集合，currentBookId = 集合首项。
 */
import { BUILTIN_BOOK_ID } from '@/constants';
import { getSettings, patchSettings } from '@/db/repos/settingsRepo';
import type { Settings } from '@/types';

/** 取当前学习词书 ID（Settings 缺失或字段为空时回退到内置词书） */
export function currentBookIdOf(settings: Settings | undefined): string {
  const fromField = settings?.currentBookId;
  if (typeof fromField === 'string' && fromField.length > 0) {
    return fromField;
  }
  return settings?.activeBookIds[0] ?? BUILTIN_BOOK_ID;
}

/** 判断某词书是否在学习范围内（叠加模式看集合，单书模式看 currentBookId） */
export function isBookActive(settings: Settings | undefined, bookId: string): boolean {
  if (!settings) {
    return bookId === BUILTIN_BOOK_ID;
  }
  if (settings.bookMode === 'stack') {
    return settings.activeBookIds.includes(bookId);
  }
  return currentBookIdOf(settings) === bookId;
}

/**
 * 设为当前学习词书（单书模式）。
 * 同时收敛 activeBookIds，避免「选了 A 却还在背 B」。
 */
export async function selectCurrentBook(bookId: string): Promise<Settings | undefined> {
  const current = await getSettings();
  if (!current) {
    return undefined;
  }
  return patchSettings({
    currentBookId: bookId,
    activeBookIds: [bookId],
    bookMode: 'single',
  });
}

/** 叠加模式下勾选/取消勾选一个词书（至少保留一个，避免取词队列为空） */
export async function toggleStackBook(
  bookId: string,
  enabled: boolean,
): Promise<Settings | undefined> {
  const current = await getSettings();
  if (!current) {
    return undefined;
  }
  const base = current.activeBookIds.length > 0 ? current.activeBookIds : [BUILTIN_BOOK_ID];
  const set = new Set(base);
  if (enabled) {
    set.add(bookId);
  } else if (set.size > 1) {
    set.delete(bookId);
  }
  const next = [...set];
  return patchSettings({
    activeBookIds: next,
    bookMode: 'stack',
    currentBookId: next[0] ?? BUILTIN_BOOK_ID,
  });
}

/** 切换单书 / 叠加模式（切回单书时只保留当前词书） */
export async function setBookMode(mode: 'single' | 'stack'): Promise<Settings | undefined> {
  const current = await getSettings();
  if (!current) {
    return undefined;
  }
  if (mode === 'single') {
    const only = currentBookIdOf(current);
    return patchSettings({ bookMode: 'single', activeBookIds: [only], currentBookId: only });
  }
  const set = new Set(current.activeBookIds);
  set.add(currentBookIdOf(current));
  const next = [...set];
  return patchSettings({ bookMode: 'stack', activeBookIds: next, currentBookId: next[0] });
}
