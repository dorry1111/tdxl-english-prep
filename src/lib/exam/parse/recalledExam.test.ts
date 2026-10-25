/**
 * 回忆版解析辅助测试（T12 扩展）：内嵌答案提取（序列式/空位内嵌式）、
 * 2026 行方向修复、主观题参考答案拆分。
 */
import { describe, expect, it } from 'vitest';
import {
  extractAnswerSequences,
  fixLineDirections,
  isCjkDominant,
  reverseLine,
  splitReferenceAnswer,
  stripInlineAnswerLetters,
} from './recalledExam';

describe('stripInlineAnswerLetters（空位内嵌答案提取）', () => {
  it('提取口语对话空位内嵌答案，含 OCR 数字混淆（l0A=10A）', () => {
    const { lines, answers } = stripInlineAnswerLetters(
      [
        'Nathan: Me too. So, how did your interview go? 1B',
        'Alicia: 3A',
        'Ashley:Thirty? 5B What else are you selling?',
        'Receptionist Okay. l0A',
        "Ronald: It's 643-0547.",
      ],
      1,
      10,
    );
    expect(answers.get(1)).toBe('B');
    expect(answers.get(3)).toBe('A');
    expect(answers.get(5)).toBe('B');
    expect(answers.get(10)).toBe('A');
    expect(answers.size).toBe(4);
    // 答案字母剥除、空位号保留
    expect(lines[0]).toBe('Nathan: Me too. So, how did your interview go? 1');
    expect(lines[3]).toBe('Receptionist Okay. 10');
    // 电话号码等非空位数字不受影响
    expect(lines[4]).toBe("Ronald: It's 643-0547.");
  });

  it('短文完成空位内嵌答案（56A / 6lA=61A），范围外的数字+字母不动', () => {
    const { lines, answers } = stripInlineAnswerLetters(
      [
        'A.satisfy the global 56A for beet',
        'forests were changed into land for cattle to 6lA .By eating less beef',
        'they should arrive in 10 mins',
        'meet me at the library after 7 then?',
      ],
      56,
      75,
    );
    expect(answers.get(56)).toBe('A');
    expect(answers.get(61)).toBe('A');
    expect(answers.size).toBe(2);
    expect(lines[0]).toBe('A.satisfy the global 56 for beet');
    expect(lines[1]).toBe('forests were changed into land for cattle to 61 .By eating less beef');
    expect(lines[2]).toBe('they should arrive in 10 mins');
    expect(lines[3]).toBe('meet me at the library after 7 then?');
  });

  it('带空格的空位内嵌答案（2025 口语「1 B」）与「11l」类单词误判防护', () => {
    const { lines, answers } = stripInlineAnswerLetters(
      ['Julia: 1 B While we\'re here, let\'s pick up the ingredients.', 'I think 11l hold off on buying other books'],
      1,
      10,
    );
    expect(answers.get(1)).toBe('B');
    expect(answers.size).toBe(1);
    expect(lines[0]).toBe("Julia: 1 While we're here, let's pick up the ingredients.");
    // 「11l」中 11 后跟字母 l（非 A-D），不得误剥
    expect(lines[1]).toBe('I think 11l hold off on buying other books');
  });
});

describe('extractAnswerSequences（序列式内嵌答案，2023「参考答案：BCA」）', () => {
  it('按出现顺序连续认领空位，并从行中移除标记（保留空位号）', () => {
    const { lines, answers } = extractAnswerSequences([
      'B: 1',
      '参考答案：BCA',
      'W: Hey, I think I know what the problem is. 6 ... 参考答案：CBA',
      'Interviewer: OK, well, 10',
      '参考答案：CDAB',
    ]);
    expect([...answers.entries()]).toEqual([
      [1, 'B'],
      [2, 'C'],
      [3, 'A'],
      [4, 'C'],
      [5, 'B'],
      [6, 'A'],
      [7, 'C'],
      [8, 'D'],
      [9, 'A'],
      [10, 'B'],
    ]);
    expect(answers.size).toBe(10);
    // 标记被移除，黏在空位行尾时空位号保留
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('W: Hey, I think I know what the problem is. 6 ... ');
  });
});

describe('fixLineDirections（2026 字符级镜像行修复）', () => {
  it('镜像行被还原为正常阅读方向', () => {
    const mirrored = reverseLine('Part I Oral Communication (10points)');
    expect(mirrored).not.toBe('Part I Oral Communication (10points)');
    const fixed = fixLineDirections(`.teehS\n${mirrored}\nBAC:案答考参`);
    expect(fixed.reversedLines).toBeGreaterThanOrEqual(2);
    expect(fixed.text).toContain('Part I Oral Communication (10points)');
    expect(fixed.text).toContain('Sheet');
    // 「案答考参」镜像 ← 「参考答案:CAB」
    expect(fixed.text).toContain('参考答案:CAB');
  });

  it('正常行与空行原样保留（不误反）', () => {
    const raw = 'The quick brown fox jumps over the lazy dog.\n参考答案：BCA\n\nDirections: Fill in each of the blanks.';
    const fixed = fixLineDirections(raw);
    expect(fixed.reversedLines).toBe(0);
    expect(fixed.text).toBe(raw);
  });

  it('混合方向文本：仅镜像行被翻转，正常行不受影响', () => {
    const raw = [
      reverseLine('Part I Oral Communication (10points)'),
      'Part II Vocabulary',
    ].join('\n');
    const fixed = fixLineDirections(raw);
    expect(fixed.reversedLines).toBe(1);
    expect(fixed.text).toContain('Part I Oral Communication (10points)');
    expect(fixed.text).toContain('Part II Vocabulary');
  });
});

describe('isCjkDominant / splitReferenceAnswer（主观题参考拆分）', () => {
  it('isCjkDominant 区分中文行与含少量中文注释的英文行', () => {
    expect(isCjkDominant('评论1：减少上网时间是减少焦虑的一个重要因素。')).toBe(true);
    expect(isCjkDominant('a report showed that almost half of all men failed to take up their offering of paternity leave(降产).')).toBe(false);
    expect(isCjkDominant('Part VI Translation (10points)')).toBe(false);
  });

  it('splitReferenceAnswer 按「参考译文：」标记拆分（2024 翻译）', () => {
    const text = [
      'Directions: Translate the following passage into Chinese.',
      'Robots often have trouble picking up objects.',
      '参考译文:机器人经常在捡起物体时遇到困难。',
      '它们无法判断拿东西的力度。',
    ].join('\n');
    const { stem, reference } = splitReferenceAnswer(text);
    expect(stem).toContain('Robots often have trouble');
    expect(stem).not.toContain('机器人');
    expect(reference).toBe('机器人经常在捡起物体时遇到困难。\n它们无法判断拿东西的力度。');
  });

  it('splitReferenceAnswer 无标记时按首个中文主导行拆分（2023 翻译英中交替）', () => {
    const text = ['While everyone\'s image of their dream home looks different.', '虽然每个人的梦想家园看起来有点不同。'].join('\n');
    const { stem, reference } = splitReferenceAnswer(text);
    expect(stem).toBe("While everyone's image of their dream home looks different.");
    expect(reference).toBe('虽然每个人的梦想家园看起来有点不同。');
  });
});
