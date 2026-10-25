import { describe, expect, it } from 'vitest';
import { classifyLine, extractAnswerKey, splitOptionGroup } from './lineClassifier';

describe('classifyLine · 选项行四种写法（PRD 8.2）', () => {
  const cases = [
    ['A. There are already too many people.', 'A'],
    ['A、There are already too many people.', 'A'],
    ['A) There are already too many people.', 'A'],
    ['a. There are already too many people.', 'A'],
  ] as const;
  for (const [line, key] of cases) {
    it(`识别「${line}」`, () => {
      const result = classifyLine(line, 1);
      expect(result.type).toBe('option');
      if (result.type === 'option') {
        expect(result.key).toBe(key);
        expect(result.text).toBe('There are already too many people.');
      }
    });
  }
});

describe('classifyLine · 选项组（一行多个选项）', () => {
  it('A. xx B. yy C. zz D. ww 拆成 4 个选项', () => {
    const result = classifyLine('A. joined B. created C. helped D. reformed', 7);
    expect(result.type).toBe('optionGroup');
    if (result.type === 'optionGroup') {
      expect(result.options.map((o) => o.key)).toEqual(['A', 'B', 'C', 'D']);
      expect(result.options[2]?.text).toBe('helped');
    }
  });

  it('标记非升序（正文含 vitamin A.）不误判为选项组', () => {
    expect(splitOptionGroup('he took vitamin A. and B. complex daily')).toBeNull();
  });
});

describe('classifyLine · 答案行三种写法', () => {
  it('【答案】B', () => {
    const r = classifyLine('【答案】B', 3);
    expect(r.type).toBe('answer');
    if (r.type === 'answer') expect(r.value).toBe('B');
  });

  it('答案：B', () => {
    const r = classifyLine('答案：B', 4);
    expect(r.type).toBe('answer');
    if (r.type === 'answer') expect(r.value).toBe('B');
  });

  it('Answer: B', () => {
    const r = classifyLine('Answer: B', 5);
    expect(r.type).toBe('answer');
    if (r.type === 'answer') expect(r.value).toBe('B');
  });

  it('主观题长答案整行捕获（referenceAnswer 用）', () => {
    const r = classifyLine('【答案】不开心的情绪就像一种传染病，它使人们远离患者。', 6);
    expect(r.type).toBe('answer');
    if (r.type === 'answer') expect(r.value).toContain('传染病');
  });
});

describe('classifyLine · 其他行类型', () => {
  it('解析行【解析】与 Explanation:', () => {
    expect(classifyLine('【解析】句中词 take after 长得像。', 1).type).toBe('explanation');
    expect(classifyLine('Explanation: because of X', 2).type).toBe('explanation');
  });

  it('分值行（2 分）/（0.5分）', () => {
    const r = classifyLine('（2 分）', 1);
    expect(r.type).toBe('score');
    if (r.type === 'score') expect(r.score).toBe(2);
    const r2 = classifyLine('(0.5分)', 2);
    expect(r2.type).toBe('score');
    if (r2.type === 'score') expect(r2.score).toBe(0.5);
  });

  it('题号行 11. / 11）', () => {
    const r = classifyLine('11. I read the newspaper every day.', 1);
    expect(r.type).toBe('questionNo');
    if (r.type === 'questionNo') {
      expect(r.seq).toBe(11);
      expect(r.rest).toBe('I read the newspaper every day.');
    }
    expect(classifyLine('12）next', 2).type).toBe('questionNo');
  });

  it('区段标题：中文关键词 / Part N / Part I Translation 归翻译', () => {
    expect(classifyLine('Part I Oral Communication (15 minutes, 10points)', 1).type).toBe('sectionTitle');
    expect(classifyLine('Part V Text Completion(20 minutes，20 points)', 2).type).toBe('sectionTitle');
    expect(classifyLine('口语交际', 3).type).toBe('sectionTitle');
    const t = classifyLine('Part I Translation (30minutes, 20 points)', 4);
    expect(t.type).toBe('sectionTitle');
    if (t.type === 'sectionTitle') expect(t.section).toBe('translation');
  });

  it('空行与普通文本行', () => {
    expect(classifyLine('   ', 1).type).toBe('blank');
    expect(classifyLine('Directions: In this section...', 2).type).toBe('text');
  });
});

describe('extractAnswerKey', () => {
  it('提取独立字母 A-D', () => {
    expect(extractAnswerKey('B')).toBe('B');
    expect(extractAnswerKey('b')).toBe('B');
    expect(extractAnswerKey('A 不开心的情绪')).toBe('A');
  });
  it('非选项字母返回 null 之外的兜底由调用方处理', () => {
    expect(extractAnswerKey('参考译文如下')).toBeNull();
  });
});
