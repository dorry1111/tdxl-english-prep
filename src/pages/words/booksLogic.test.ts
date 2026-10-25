/**
 * 词库页纯逻辑单测：排序与进度展示。
 */
import { describe, expect, it } from 'vitest';

import { BUILTIN_BOOK_ID, NOTEBOOK_BOOK_ID } from '@/constants';
import type { WordBook } from '@/types';
import { formatCount, orderBooks, progressPercent, remainingWords } from './booksLogic';

function book(id: string, priority: number, createdAt = 0): WordBook {
  return {
    id,
    name: id,
    source: id === BUILTIN_BOOK_ID ? 'builtin' : id === NOTEBOOK_BOOK_ID ? 'virtual-notebook' : 'imported',
    wordCount: 0,
    enabled: true,
    priority,
    createdAt,
    updatedAt: 0,
    deletedAt: null,
  };
}

describe('orderBooks', () => {
  it('内置置顶、生词本垫底、导入词库按 priority 升序', () => {
    const ordered = orderBooks([
      book(NOTEBOOK_BOOK_ID, 99),
      book('custom-b', 5),
      book(BUILTIN_BOOK_ID, 0),
      book('custom-a', 2),
    ]);
    expect(ordered.map((item) => item.id)).toEqual([
      BUILTIN_BOOK_ID,
      'custom-a',
      'custom-b',
      NOTEBOOK_BOOK_ID,
    ]);
  });
});

describe('进度展示', () => {
  it('progressPercent：总数为 0 时为 0，上限 100', () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(580, 5802)).toBe(10);
    expect(progressPercent(9999, 100)).toBe(100);
  });

  it('remainingWords：已学超过总数时收敛到 0', () => {
    expect(remainingWords(5802, 580)).toBe(5222);
    expect(remainingWords(10, 20)).toBe(0);
  });

  it('formatCount：总数未知显示「—」，绝不伪造数字', () => {
    expect(formatCount(5802)).toBe('5802');
    expect(formatCount(null)).toBe('—');
  });
});
