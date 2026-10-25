/**
 * 词汇题考点词识别（vocabTarget）单测。
 *
 * 覆盖：句中词 / 句中短语抽取、屈折容忍（diminished / remarks / dispersed）、
 * 短语被拆开时的逐词兜底（made it all up）、以及无解析（回忆版）时的「不标」退化。
 */
import { describe, expect, it } from 'vitest';

import {
  extractVocabTarget,
  findTargetRanges,
  splitStemByTarget,
  vocabStemSegments,
} from './vocabTarget';

describe('extractVocabTarget', () => {
  it('抽取「句中词」后的单个词', () => {
    const target = extractVocabTarget('【解析】句中词 diminished 减少;削弱。');
    expect(target).not.toBeNull();
    expect(target?.text).toBe('diminished');
    expect(target?.isPhrase).toBe(false);
  });

  it('抽取「句中短语」后的两个词', () => {
    const target = extractVocabTarget('【解析】句中短语 made up 构成,编造。');
    expect(target?.text).toBe('made up');
    expect(target?.isPhrase).toBe(true);
    expect(target?.words).toEqual(['made', 'up']);
  });

  it('解析为空 / 无线索时返回 null（回忆版不猜词）', () => {
    expect(extractVocabTarget(null)).toBeNull();
    expect(extractVocabTarget('')).toBeNull();
    expect(extractVocabTarget('【解析】通读对话,是女儿让爸爸给她读书的内容。')).toBeNull();
  });
});

describe('findTargetRanges', () => {
  it('命中原形', () => {
    const target = extractVocabTarget('【解析】句中词 diminished 减少。');
    const stem = 'The supply of silver in the mine had diminished, causing great concern.';
    const ranges = findTargetRanges(stem, target);
    expect(ranges).toHaveLength(1);
    const first = ranges[0];
    expect(first).toBeDefined();
    if (first) {
      expect(stem.slice(first[0], first[1])).toBe('diminished');
    }
  });

  it('容忍屈折变化（option → options / disperse → dispersed）', () => {
    const stem = 'We have no options but to wait.';
    const range = findTargetRanges(stem, extractVocabTarget('【解析】句中词 option 选择。'))[0];
    expect(range).toBeDefined();
    expect(range ? stem.slice(range[0], range[1]) : '').toBe('options');

    const stem2 = 'The crowd dispersed quickly.';
    const range2 = findTargetRanges(stem2, extractVocabTarget('【解析】句中词 disperse 分散。'))[0];
    expect(range2).toBeDefined();
    expect(range2 ? stem2.slice(range2[0], range2[1]) : '').toBe('dispersed');
  });

  it('大小写不敏感', () => {
    const stem = 'Diminished supply caused concern.';
    const ranges = findTargetRanges(stem, extractVocabTarget('【解析】句中词 diminished 减少。'));
    expect(ranges).toHaveLength(1);
  });

  it('短语整体命中', () => {
    const stem = 'He made up an excuse for being late.';
    const ranges = findTargetRanges(stem, extractVocabTarget('【解析】句中短语 made up 编造。'));
    expect(ranges).toHaveLength(1);
    const first = ranges[0];
    expect(first).toBeDefined();
    if (first) {
      expect(stem.slice(first[0], first[1])).toBe('made up');
    }
  });

  it('短语被拆开时逐词兜底（made it all up → made + up）', () => {
    const stem = 'his mother knew that he had made it all up.';
    const ranges = findTargetRanges(stem, extractVocabTarget('【解析】句中短语 made up 编造。'));
    expect(ranges).toHaveLength(2);
    expect(ranges.map(([start, end]) => stem.slice(start, end))).toEqual(['made', 'up']);
  });

  it('未命中返回空数组', () => {
    const stem = 'Nothing relevant here.';
    expect(findTargetRanges(stem, extractVocabTarget('【解析】句中词 diminished 减少。'))).toEqual([]);
    expect(findTargetRanges(stem, null)).toEqual([]);
  });
});

describe('splitStemByTarget / vocabStemSegments', () => {
  it('命中时切成三段并标记中间段', () => {
    const segments = vocabStemSegments(
      'The supply of silver had diminished, causing concern.',
      '【解析】句中词 diminished 减少。',
    );
    expect(segments).toHaveLength(3);
    expect(segments[1]?.target).toBe(true);
    expect(segments[1]?.text).toBe('diminished');
    expect(segments[0]?.target).toBe(false);
    expect(segments[2]?.target).toBe(false);
    // 拼接回去必须和原文一致（不能吞字）
    expect(segments.map((segment) => segment.text).join('')).toBe(
      'The supply of silver had diminished, causing concern.',
    );
  });

  it('无解析时退化为单段（渲染与现状一致）', () => {
    const stem = 'A deficiency of soil nutrients can cause the crop to be of low quality.';
    expect(vocabStemSegments(stem, '')).toEqual([{ text: stem, target: false }]);
    expect(splitStemByTarget(stem, null)).toEqual([{ text: stem, target: false }]);
  });
});
