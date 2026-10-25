/**
 * 生词本列表的纯逻辑（筛选 / 排序 / 分页 / 释义摘要）。
 *
 * 单独成文件的原因：这些规则不需要 React 与 IndexedDB，
 * 抽出来后可以脱离 jsdom 直接断言（见 NotebookPage.test.tsx 的纯逻辑段）。
 */
import type { Word, WordState } from '@/types';

/** 生词本条目：收藏状态 + 对应词条 */
export interface NotebookItem {
  state: WordState;
  word: Word;
}

/** 释义摘要：取前 max 条 `pos cn`，用「；」连接，超出加省略号 */
export function meaningSummary(word: Word, max = 2): string {
  const parts = word.meanings
    .slice(0, max)
    .map((meaning) => (meaning.pos ? `${meaning.pos} ${meaning.cn}` : meaning.cn))
    .filter((text) => text.length > 0);
  const joined = parts.join('；');
  return word.meanings.length > max ? `${joined}…` : joined;
}

/** 按词书筛选；'all' 返回全部 */
export function filterByBook(items: NotebookItem[], bookId: string): NotebookItem[] {
  if (bookId === ALL_BOOKS) {
    return items;
  }
  return items.filter((item) => item.word.bookId === bookId);
}

/** 全部词书筛选项的值 */
export const ALL_BOOKS = 'all';

/** 排序：最近更新（收藏/复习）在前，同时间按词头字典序，保证顺序稳定 */
export function sortItems(items: NotebookItem[]): NotebookItem[] {
  return [...items].sort((left, right) => {
    const delta = right.state.updatedAt - left.state.updatedAt;
    if (delta !== 0) {
      return delta;
    }
    return left.word.headword.localeCompare(right.word.headword);
  });
}

/** 累计分页：第 page 页 = 前 page*pageSize 条（移动端「加载更多」语义） */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const safePage = Math.max(1, Math.trunc(page));
  const safeSize = Math.max(1, Math.trunc(pageSize));
  return items.slice(0, safePage * safeSize);
}

/** 从条目集合里提取可选词书（按出现顺序去重） */
export function bookOptionsOf(items: NotebookItem[]): string[] {
  const seen: string[] = [];
  for (const item of items) {
    if (!seen.includes(item.word.bookId)) {
      seen.push(item.word.bookId);
    }
  }
  return seen;
}
