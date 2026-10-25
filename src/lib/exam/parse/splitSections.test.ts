import { describe, expect, it } from 'vitest';
import { splitSections } from './splitSections';

describe('splitSections', () => {
  it('按七题型标题行切出 7 个区段，顺序正确', () => {
    const lines = [
      '2013 年同等学力考试试题',
      'Part I Oral Communication (15 minutes, 10 points)',
      'Section A',
      '1. A: Hello',
      'Part II Vocabulary (10 minutes, 10 points)',
      '11. sentence',
      'Part III Reading Comprehension (45 minutes, 25 points)',
      'Passage One',
      'text...',
      'Part IV Cloze (10 minutes, 10 points)',
      '46. A. a B. b C. c D. d',
      'Part V Text Completion (20 minutes, 20 points)',
      '56. phrase',
      'Part VI Translation (20 minutes, 10 points)',
      'translate this',
      'Part VII Writing (30 minutes, 15 points)',
      'write that',
    ];
    const { sections } = splitSections(lines);
    expect(sections.map((s) => s.type)).toEqual([
      'dialogue',
      'vocabulary',
      'reading',
      'cloze',
      'short-completion',
      'translation',
      'writing',
    ]);
    expect(sections[0]?.lines).toHaveLength(2); // Section A + 1. A: Hello
    expect(sections[6]?.lines.map((l) => l.text)).toEqual(['write that']);
  });

  it('首个标题之前的行归入 prelude', () => {
    const { prelude, sections } = splitSections(['卷首说明', '口语交际', '1. hello']);
    expect(prelude.map((l) => l.text)).toEqual(['卷首说明']);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.type).toBe('dialogue');
  });

  it('行号保持原文本行号（1 起，含空行）', () => {
    const { sections } = splitSections(['', '词汇', '11. x', '', '12. y']);
    expect(sections[0]?.titleLineNo).toBe(2);
    expect(sections[0]?.lines.map((l) => l.lineNo)).toEqual([3, 4, 5]);
  });
});
