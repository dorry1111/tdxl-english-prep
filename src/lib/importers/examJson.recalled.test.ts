/**
 * validateExamJson 回忆版宽容模式（allowRecalledGaps）测试：
 * 答案缺失 / 序号断档 / 题量口径不符在宽容模式下降级为警告，严格模式下仍为错误。
 */
import { describe, expect, it } from 'vitest';
import { validateExamJson, type ExamJsonFile } from './examJson';

/** 最小合法卷结构（七区段） */
function paperSkeleton(): ExamJsonFile {
  return {
    schemaVersion: 1,
    paper: {
      title: '回忆卷',
      timeLimitSec: 9000,
      totalScore: 100,
      sections: [
        { type: 'dialogue', order: 1, questionCount: 10, score: 10, minutes: 15 },
        { type: 'vocabulary', order: 2, questionCount: 10, score: 10, minutes: 10 },
        { type: 'reading', order: 3, questionCount: 25, score: 25, minutes: 45 },
        { type: 'cloze', order: 4, questionCount: 10, score: 10, minutes: 10 },
        { type: 'short-completion', order: 5, questionCount: 20, score: 20, minutes: 20 },
        { type: 'translation', order: 6, questionCount: 1, score: 10, minutes: 20 },
        { type: 'writing', order: 7, questionCount: 1, score: 15, minutes: 30 },
      ],
    },
    passages: [],
    questions: [],
  };
}

/** 客观题（答案可选） */
function objQ(seq: number, type: ExamJsonFile['questions'][number]['sectionType'], withAnswer: boolean) {
  return {
    id: `q${seq}`,
    sectionType: type,
    seq,
    stem: `stem ${seq}`,
    options: [
      { key: 'A', text: 'a' },
      { key: 'B', text: 'b' },
      { key: 'C', text: 'c' },
      { key: 'D', text: 'd' },
    ],
    ...(withAnswer ? { answerKey: 'A' } : {}),
    score: 1,
  };
}

/** 主观题（参考可选） */
function subjQ(seq: number, type: 'translation' | 'writing', withRef: boolean) {
  return {
    id: `q${seq}`,
    sectionType: type,
    seq,
    stem: 'stem',
    ...(withRef ? { referenceAnswer: '参考答案' } : {}),
    score: type === 'writing' ? 15 : 10,
  };
}

describe('validateExamJson 回忆版宽容模式（allowRecalledGaps）', () => {
  it('客观题答案缺失：严格模式报错，宽容模式降级为警告', () => {
    const p = paperSkeleton();
    p.questions = [objQ(1, 'dialogue', false)];
    const strict = validateExamJson(p);
    expect(strict.ok).toBe(false);
    if (!strict.ok) {
      expect(strict.errors.some((e) => e.includes('answerKey'))).toBe(true);
    }
    const recalled = validateExamJson(p, { allowRecalledGaps: true });
    expect(recalled.ok).toBe(true);
    expect(recalled.warnings.some((w) => w.includes('answerKey') && w.includes('回忆版'))).toBe(true);
  });

  it('主观题参考答案缺失：宽容模式降级为警告', () => {
    const p = paperSkeleton();
    p.questions = [subjQ(77, 'writing', false)];
    const strict = validateExamJson(p);
    expect(strict.ok).toBe(false);
    const recalled = validateExamJson(p, { allowRecalledGaps: true });
    expect(recalled.ok).toBe(true);
    expect(recalled.warnings.some((w) => w.includes('referenceAnswer'))).toBe(true);
  });

  it('序号断档与题量口径不符：宽容模式均降级为警告，重复序号仍是错误', () => {
    const p = paperSkeleton();
    p.questions = [objQ(1, 'dialogue', true), objQ(2, 'dialogue', true), objQ(4, 'dialogue', true)];
    const recalled = validateExamJson(p, { allowRecalledGaps: true });
    expect(recalled.ok).toBe(true);
    expect(recalled.warnings.some((w) => w.includes('序号不连续'))).toBe(true);
    expect(recalled.warnings.some((w) => w.includes('questionCount'))).toBe(true);

    const dup = paperSkeleton();
    dup.questions = [objQ(1, 'dialogue', true), objQ(1, 'dialogue', true)];
    const recalledDup = validateExamJson(dup, { allowRecalledGaps: true });
    expect(recalledDup.ok).toBe(false);
    if (!recalledDup.ok) {
      expect(recalledDup.errors.some((e) => e.includes('序号重复'))).toBe(true);
    }
  });
});
