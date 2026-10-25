/**
 * 词库页的纯展示/排序逻辑（BooksPage 用，脱离 DOM 可测）。
 *
 * 排序口径：内置词库置顶 → 用户导入词库按 priority 升序 → 生词本虚拟库垫底。
 */
import { BUILTIN_BOOK_ID, NOTEBOOK_BOOK_ID } from '@/constants';
import type { WordBook } from '@/types';

/** 展示顺序：内置 0 / 导入 1 / 生词本 2 */
function rankOf(book: WordBook): number {
  if (book.id === BUILTIN_BOOK_ID) {
    return 0;
  }
  if (book.id === NOTEBOOK_BOOK_ID) {
    return 2;
  }
  return 1;
}

/** 词库卡片排序（内置 → 导入（priority 升序）→ 生词本） */
export function orderBooks(books: readonly WordBook[]): WordBook[] {
  return [...books].sort((left, right) => {
    const rankDiff = rankOf(left) - rankOf(right);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    if (rankOf(left) !== 1) {
      return 0;
    }
    // 同为导入词库：priority 升序，同优先级按创建时间
    return left.priority - right.priority || left.createdAt - right.createdAt;
  });
}

/** 学习进度百分比（总数 ≤ 0 时为 0，避免除零与显示 NaN） */
export function progressPercent(learned: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((learned / total) * 100)));
}

/** 未学词条数（已学超过总数时收敛到 0，不显示负数） */
export function remainingWords(total: number, learned: number): number {
  return Math.max(0, total - learned);
}

/** 总数为 null（分片索引未加载）时显示「—」，绝不伪造数字 */
export function formatCount(total: number | null): string {
  return total === null ? '—' : String(total);
}
