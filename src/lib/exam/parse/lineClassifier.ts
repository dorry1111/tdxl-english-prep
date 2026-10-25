/**
 * 行分类器（T12 管线第 3 步，ARCHITECTURE 4.3 / PRD 8.2 行级规则表）。
 *
 * classifyLine 是纯函数：一行 + 上下文 → { type, payload, lineNo }。
 * 规则全部来自 sectionRules.ts 的 LINE_RULES 数据表。
 */
import type { SectionType } from '@/types';
import { LINE_RULES, matchSectionTitle } from './sectionRules';

/** 单个选项 */
export interface ParsedOption {
  key: string; // 统一大写 'A' | 'B' | 'C' | 'D'
  text: string;
}

/** 行分类结果（判别联合，payload 按类型收窄） */
export type ClassifiedLine =
  | { lineNo: number; raw: string; type: 'blank' }
  | { lineNo: number; raw: string; type: 'sectionTitle'; section: SectionType }
  | { lineNo: number; raw: string; type: 'passageHeading'; label: string }
  | { lineNo: number; raw: string; type: 'questionNo'; seq: number; rest: string }
  | { lineNo: number; raw: string; type: 'option'; key: string; text: string }
  | { lineNo: number; raw: string; type: 'optionGroup'; options: ParsedOption[] }
  | { lineNo: number; raw: string; type: 'answer'; value: string }
  | { lineNo: number; raw: string; type: 'explanation'; text: string }
  | { lineNo: number; raw: string; type: 'score'; score: number }
  | { lineNo: number; raw: string; type: 'text' };

/** 分类上下文（供规则微调，如选项行是否必须挂在当前题上） */
export interface ClassifyContext {
  /** 是否存在当前题目（选项行一般只在该题内识别） */
  hasCurrentQuestion: boolean;
}

/** 默认上下文 */
const DEFAULT_CONTEXT: ClassifyContext = { hasCurrentQuestion: false };

/**
 * 把一行含多个选项标记的文本（如 `A. xx B. yy C. zz D. ww`）拆成选项数组。
 * 要求标记字母按 A→D 升序出现，否则放弃拆分返回 null。
 */
export function splitOptionGroup(text: string): ParsedOption[] | null {
  const markerRe = /(?:^|[\s])([A-Da-d])\s*[.、．)）]\s*/g;
  const marks: Array<{ key: string; start: number; end: number }> = [];
  for (let m = markerRe.exec(text); m !== null; m = markerRe.exec(text)) {
    marks.push({
      key: (m[1] ?? '').toUpperCase(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  // 真实选项组至少 3 个标记（A-C / A-D）；仅 2 个视为正文误判（如「vitamin A. and B.」）
  if (marks.length < 3) return null;
  // 标记必须按字母升序且不重复，否则视为误判（如正文里出现 "vitamin A."）
  for (let i = 1; i < marks.length; i += 1) {
    const prev = marks[i - 1];
    const cur = marks[i];
    if (!prev || !cur || cur.key.charCodeAt(0) !== prev.key.charCodeAt(0) + 1) return null;
  }
  const options: ParsedOption[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i];
    if (!mark) continue;
    const next = marks[i + 1];
    const segEnd = next ? next.start : text.length;
    const segText = text.slice(mark.end, segEnd).trim();
    if (segText.length === 0) return null;
    options.push({ key: mark.key, text: segText });
  }
  return options.length >= 3 ? options : null;
}

/** 从答案值里提取客观题选项字母（取第一个独立出现的 A-D） */
export function extractAnswerKey(value: string): string | null {
  const m = /(?:^|[^A-Za-z])([A-Da-d])(?:$|[^A-Za-z])/.exec(value.trim());
  if (m?.[1]) return m[1].toUpperCase();
  const first = value.trim().charAt(0).toUpperCase();
  return /^[A-D]$/.test(first) ? first : null;
}

/**
 * 对单行做分类。任何一行都会得到一个类型——「text」是兜底类型，
 * 由 buildDraft 决定归属（题干 / 文章正文 / unresolved），不允许静默丢弃。
 */
export function classifyLine(
  rawLine: string,
  lineNo: number,
  // 预留的上下文参数（如上一行类型）；当前规则表为纯行内匹配，前缀下划线规避 noUnusedParameters
  context: ClassifyContext = DEFAULT_CONTEXT,
): ClassifiedLine {
  void context;
  const base = { lineNo, raw: rawLine };
  const trimmed = rawLine.trim();

  if (trimmed.length === 0) return { ...base, type: 'blank' };

  // 区段标题（最优先：中文关键词/英文关键词/裸 Part 序号，见 sectionRules）
  const section = matchSectionTitle(trimmed);
  if (section) return { ...base, type: 'sectionTitle', section };

  // 按 LINE_RULES 表顺序匹配
  for (const rule of LINE_RULES) {
    const m = rule.re.exec(rawLine);
    if (!m) continue;
    switch (rule.kind) {
      case 'blank':
        return { ...base, type: 'blank' };
      case 'answer':
        return { ...base, type: 'answer', value: (m[1] ?? '').trim() };
      case 'explanation':
        return { ...base, type: 'explanation', text: (m[1] ?? '').trim() };
      case 'score': {
        const score = Number.parseFloat(m[1] ?? '0');
        return { ...base, type: 'score', score: Number.isFinite(score) ? score : 0 };
      }
      case 'optionGroup': {
        const groupText = trimmed;
        const options = splitOptionGroup(groupText);
        if (options) return { ...base, type: 'optionGroup', options };
        break; // 拆分失败则继续尝试后续规则
      }
      case 'option': {
        // 选项行语义上属于当前题目；无当前题时仍分类为 option，由 buildDraft 归入 unresolved
        const key = (m[1] ?? '').toUpperCase();
        const text = (m[2] ?? '').trim();
        if (key && text) return { ...base, type: 'option', key, text };
        break;
      }
      case 'questionNo': {
        const seq = Number.parseInt(m[1] ?? '0', 10);
        if (Number.isFinite(seq) && seq > 0) {
          return { ...base, type: 'questionNo', seq, rest: (m[2] ?? '').trim() };
        }
        break;
      }
      case 'passageHeading':
        return { ...base, type: 'passageHeading', label: (m[1] ?? '').trim() };
      default:
        break;
    }
  }

  // 兜底：普通文本行
  return { ...base, type: 'text' };
}
