/**
 * highlightSegments 纯函数测试（P3 真题划词）。
 */
import { describe, expect, it } from 'vitest';

import {
  buildTextSegments,
  classifySelection,
  locateHighlight,
} from '@/components/exam/highlightSegments';
import type { TextHighlight } from '@/types';

function highlight(patch: Partial<TextHighlight>): TextHighlight {
  return {
    id: patch.id ?? 'thl_1',
    anchorKind: 'passage',
    anchorId: 'draft-p-1',
    blockKey: 'p:0',
    text: patch.text ?? 'alpha',
    start: patch.start ?? null,
    color: patch.color ?? 1,
    note: patch.note ?? null,
    wordNorm: patch.wordNorm ?? null,
    createdAt: patch.createdAt ?? 1000,
    updatedAt: patch.createdAt ?? 1000,
    deletedAt: null,
  };
}

describe('locateHighlight', () => {
  const text = 'the alpha and the alpha again';

  it('无 start 提示时取第一次出现', () => {
    expect(locateHighlight(text, highlight({ text: 'alpha' }))).toBe(4);
  });

  it('带 start 提示时取离提示最近的出现', () => {
    expect(locateHighlight(text, highlight({ text: 'alpha', start: 18 }))).toBe(18);
  });

  it('文本不存在返回 -1；空文本返回 -1', () => {
    expect(locateHighlight(text, highlight({ text: 'omega' }))).toBe(-1);
    expect(locateHighlight(text, highlight({ text: '' }))).toBe(-1);
  });
});

describe('buildTextSegments', () => {
  it('无高亮时输出单段', () => {
    expect(buildTextSegments('hello world', [])).toEqual([{ text: 'hello world', highlight: null }]);
  });

  it('空文本输出空数组', () => {
    expect(buildTextSegments('', [highlight({})])).toEqual([]);
  });

  it('高亮按文本定位覆盖，前后保持未高亮分段', () => {
    const segments = buildTextSegments('the alpha end', [highlight({ text: 'alpha' })]);
    expect(segments).toEqual([
      { text: 'the ', highlight: null },
      { text: 'alpha', highlight: expect.objectContaining({ text: 'alpha' }) },
      { text: ' end', highlight: null },
    ]);
  });

  it('同一位置多条高亮时取 createdAt 最新的一档', () => {
    const older = highlight({ id: 'thl_old', text: 'alpha', color: 1, createdAt: 1000 });
    const newer = highlight({ id: 'thl_new', text: 'alpha', color: 3, createdAt: 2000 });
    const segments = buildTextSegments('the alpha end', [older, newer]);
    const covered = segments.find((segment) => segment.highlight !== null);
    expect(covered?.highlight?.id).toBe('thl_new');
    expect(covered?.highlight?.color).toBe(3);
  });

  it('相邻高亮按记录对象分段（同色不同记录不合并），未覆盖部分独立成段', () => {
    const one = highlight({ id: 'thl_a', text: 'al', color: 2 });
    const two = highlight({ id: 'thl_b', text: 'pha', color: 2, createdAt: 2000 });
    const segments = buildTextSegments('alpha!', [one, two]);
    expect(segments.map((segment) => segment.text)).toEqual(['al', 'pha', '!']);
    expect(segments[0]?.highlight?.id).toBe('thl_a');
    expect(segments[1]?.highlight?.id).toBe('thl_b');
    expect(segments[2]?.highlight).toBeNull();
  });
});

describe('classifySelection', () => {
  it('少于 2 字符判无效（防点击误触）', () => {
    expect(classifySelection('a')).toEqual({ kind: 'invalid', text: '' });
    expect(classifySelection(' ')).toEqual({ kind: 'invalid', text: '' });
    expect(classifySelection('')).toEqual({ kind: 'invalid', text: '' });
  });

  it('单个英文单词（含撇号连字符）判 word', () => {
    expect(classifySelection('alpha')).toEqual({ kind: 'word', text: 'alpha' });
    expect(classifySelection("don't")).toEqual({ kind: 'word', text: "don't" });
    expect(classifySelection('well-known')).toEqual({ kind: 'word', text: 'well-known' });
  });

  it('空白归一；句子与中文片段判 phrase', () => {
    expect(classifySelection('  the  global  economy ')).toEqual({
      kind: 'phrase',
      text: 'the global economy',
    });
    expect(classifySelection('全球经济')).toEqual({ kind: 'phrase', text: '全球经济' });
  });

  it('超长文本判 phrase（不进生词本）', () => {
    const long = 'a'.repeat(41);
    expect(classifySelection(long)).toEqual({ kind: 'phrase', text: long });
  });
});
