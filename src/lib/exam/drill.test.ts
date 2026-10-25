/**
 * 专项抽题单测（T11 验收标准 5：固定 seed 结果可复现）。
 */
import { describe, expect, it } from 'vitest';

import { createSeededRandom, pickDrillQuestions, shuffleSeeded } from '@/lib/exam/drill';
import type { Question, SectionType } from '@/types';

const STAMP = 1_700_000_000_000;

function makeQuestion(sectionType: SectionType, seq: number): Question {
  return {
    id: `${sectionType}-${seq}`,
    paperId: 'paper-drill',
    sectionType,
    passageId: null,
    seq,
    stem: `第 ${seq} 题`,
    blankIndex: null,
    options: [{ key: 'A', text: '选项 A' }],
    answerKey: 'A',
    referenceAnswer: null,
    explanation: '',
    score: 1,
    isObjective: true,
    updatedAt: STAMP,
    deletedAt: null,
  };
}

/** 25 道阅读 + 10 道词汇（阅读序号 1..25，词汇 26..35） */
function buildPool(): Question[] {
  const pool: Question[] = [];
  for (let seq = 1; seq <= 25; seq += 1) {
    pool.push(makeQuestion('reading', seq));
  }
  for (let seq = 26; seq <= 35; seq += 1) {
    pool.push(makeQuestion('vocabulary', seq));
  }
  return pool;
}

describe('pickDrillQuestions', () => {
  it('固定 seed 调用两次结果完全一致（含顺序）', () => {
    const pool = buildPool();
    const first = pickDrillQuestions(pool, 'reading', 10, 42);
    const second = pickDrillQuestions(pool, 'reading', 10, 42);
    expect(first.map((question) => question.id)).toEqual(second.map((question) => question.id));
  });

  it('不同 seed 产生不同排列（固定数据下结果确定）', () => {
    const pool = buildPool();
    const first = pickDrillQuestions(pool, 'reading', 25, 1);
    const second = pickDrillQuestions(pool, 'reading', 25, 2);
    expect(first.map((question) => question.id)).not.toEqual(second.map((question) => question.id));
  });

  it('只返回指定题型的题目', () => {
    const pool = buildPool();
    const picked = pickDrillQuestions(pool, 'vocabulary', 10, 7);
    expect(picked).toHaveLength(10);
    expect(picked.every((question) => question.sectionType === 'vocabulary')).toBe(true);
  });

  it('count 超过池子时返回全部；count 为 0 返回空数组', () => {
    const pool = buildPool();
    expect(pickDrillQuestions(pool, 'cloze', 10, 42)).toEqual([]);
    expect(pickDrillQuestions(pool, 'reading', 99, 42)).toHaveLength(25);
    expect(pickDrillQuestions(pool, 'reading', 0, 42)).toEqual([]);
  });

  it('抽题结果是原池子的一个排列（不重不漏、不修改入参）', () => {
    const pool = buildPool();
    const snapshot = pool.map((question) => question.id);
    const picked = pickDrillQuestions(pool, 'reading', 25, 123);
    expect([...picked].sort((a, b) => a.seq - b.seq).map((question) => question.id)).toEqual(
      pool.filter((question) => question.sectionType === 'reading').map((question) => question.id),
    );
    expect(pool.map((question) => question.id)).toEqual(snapshot);
  });

  it('输入顺序不影响抽取结果（内部先按 seq 排序）', () => {
    const pool = buildPool();
    const reversed = [...pool].reverse();
    const a = pickDrillQuestions(pool, 'reading', 10, 42);
    const b = pickDrillQuestions(reversed, 'reading', 10, 42);
    expect(a.map((question) => question.id)).toEqual(b.map((question) => question.id));
  });
});

describe('shuffleSeeded / createSeededRandom', () => {
  it('同一 seed 的洗牌结果可复现', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffleSeeded(items, 42)).toEqual(shuffleSeeded(items, 42));
  });

  it('createSeededRandom 同 seed 序列一致、取值落在 [0, 1)', () => {
    const a = createSeededRandom(7);
    const b = createSeededRandom(7);
    for (let i = 0; i < 100; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
