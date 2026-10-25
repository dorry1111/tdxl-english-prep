/**
 * 真题划词高亮分段纯函数（P3）。
 *
 * 把 TextHighlight 记录叠回一个文本块（passage 段落 / 题干 / 解析），
 * 产出渲染分段：每字符取 createdAt 最新的记录，相邻同色合并。
 * 与单词卡的 HighlightableText.buildSegments 同思路，
 * 区别：多了 start 提示（同一子串出现多次时优先取离 start 最近的位置）。
 */
import type { TextHighlight } from '@/types';

/** 渲染分段：一段原文 + 应用其上的高亮（null = 未高亮） */
export interface ExamTextSegment {
  text: string;
  highlight: TextHighlight | null;
}

/** 从块内文本定位高亮起点：优先离 start 最近的出现位置 */
export function locateHighlight(text: string, highlight: TextHighlight): number {
  if (highlight.text.length === 0 || highlight.text.length > text.length) {
    return -1;
  }
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let from = text.indexOf(highlight.text);
  while (from !== -1) {
    const distance =
      highlight.start === null ? Math.abs(from) : Math.abs(from - highlight.start);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = from;
    }
    from = text.indexOf(highlight.text, from + 1);
  }
  return best;
}

/** 把高亮记录叠到块内文本上，产出渲染分段 */
export function buildTextSegments(text: string, highlights: TextHighlight[]): ExamTextSegment[] {
  if (text.length === 0) {
    return [];
  }
  const cover = new Map<number, TextHighlight>();
  for (const highlight of highlights) {
    const from = locateHighlight(text, highlight);
    if (from === -1) {
      continue;
    }
    for (let index = from; index < from + highlight.text.length; index += 1) {
      const prev = cover.get(index);
      if (!prev || prev.createdAt <= highlight.createdAt) {
        cover.set(index, highlight);
      }
    }
  }
  const segments: ExamTextSegment[] = [];
  let index = 0;
  while (index < text.length) {
    const highlight = cover.get(index) ?? null;
    let end = index + 1;
    while (end < text.length && (cover.get(end) ?? null) === highlight) {
      end += 1;
    }
    segments.push({ text: text.slice(index, end), highlight });
    index = end;
  }
  return segments;
}

/** 单个英文单词（允许撇号与连字符，至少 2 字符防误触） */
const WORD_RE = /^[A-Za-z][A-Za-z'-]+$/;

/** 划选结果分类：单词（可进生词本）/ 句子片段 / 无效 */
export type SelectionKind = 'word' | 'phrase' | 'invalid';

/**
 * 归一划选文本：
 * - 去掉首尾空白后 < 2 字符 → invalid（防点击误触）；
 * - 单个英文单词（WORD_RE，≤40 字符）→ word；
 * - 其余非空 → phrase（句子/片段）。
 */
export function classifySelection(raw: string): { kind: SelectionKind; text: string } {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length < 2) {
    return { kind: 'invalid', text: '' };
  }
  if (text.length <= 40 && WORD_RE.test(text)) {
    return { kind: 'word', text };
  }
  return { kind: 'phrase', text };
}
