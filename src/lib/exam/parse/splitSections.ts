/**
 * 区段切分（T12 管线第 2 步，ARCHITECTURE 4.3）。
 *
 * 按区段标题行把规范化后的行序列切成七题型区段；
 * 首个标题之前的行归入 prelude（由 buildDraft 决定标题/未识别归属）。
 */
import type { SectionType } from '@/types';
import { matchSectionTitle } from './sectionRules';

/** 一行及其在规范化文本中的行号（1 起） */
export interface NumberedLine {
  lineNo: number;
  text: string;
}

/** 一个区段的原始切分结果（尚未分类行） */
export interface SectionSpan {
  type: SectionType;
  /** 标题行原文 */
  title: string;
  /** 标题行行号 */
  titleLineNo: number;
  /** 区段内除标题外的行（有序） */
  lines: NumberedLine[];
}

/** 区段切分结果 */
export interface SplitSectionsResult {
  /** 首个区段标题之前的内容（含整卷标题行） */
  prelude: NumberedLine[];
  /** 按出现顺序排列的区段 */
  sections: SectionSpan[];
}

/**
 * 把规范化后的行序列切分区段。
 * 命中区段标题行即开新区段（PRD 8.2：按顺序匹配，命中即切新区段）。
 */
export function splitSections(lines: readonly string[]): SplitSectionsResult {
  const prelude: NumberedLine[] = [];
  const sections: SectionSpan[] = [];

  let current: SectionSpan | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i] ?? '';
    const lineNo = i + 1;
    const sectionType = matchSectionTitle(text);
    if (sectionType) {
      current = { type: sectionType, title: text.trim(), titleLineNo: lineNo, lines: [] };
      sections.push(current);
      continue;
    }
    if (current) {
      current.lines.push({ lineNo, text });
    } else {
      prelude.push({ lineNo, text });
    }
  }
  return { prelude, sections };
}
