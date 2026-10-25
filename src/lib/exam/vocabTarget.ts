/**
 * 词汇题「目标词」识别：从 explanation 的解析文本里抽取考点词/短语，再回定位到 stem。
 *
 * 背景：源 PDF 里考点词带下划线，OCR 成 JSON 后下划线丢失，stem 内没有任何标记。
 * 但 2012-2022 的 explanation 有稳定线索，例如：
 *   【解析】句中词 diminished 减少;削弱。
 *   【解析】句中短语 made up 构成,编造。
 * 2023-2025（回忆版）没有 explanation，此时本模块一律返回「未命中」，保持原渲染不动，绝不猜词。
 *
 * 约束：只读纯函数，不修改任何 JSON 数据文件。
 */

/** 解析出来的目标词/短语。 */
export interface VocabTarget {
  /** 目标词或短语原文，例如 `made up`。 */
  readonly text: string;
  /** 构成短语/单词的词元列表。 */
  readonly words: readonly string[];
  /** 是否短语（多于一个词）。 */
  readonly isPhrase: boolean;
}

/** stem 分段结果，便于按段渲染（命中段加粗+主题色+下划线）。 */
export interface StemSegment {
  readonly text: string;
  /** true 表示这一段命中目标词，需要高亮。 */
  readonly target: boolean;
}

/** 匹配「句中词 X」「句中短语 X Y」「考查短语 X Y」等写法。 */
const TARGET_RE =
  /句中(?:词|短语|的词|词组)?\s*[:：]?\s*([A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*)?)/;

/** 明确写成短语的优先取两个词。 */
const PHRASE_RE =
  /(?:句中短语|考查短语)\s*[:：]?\s*([A-Za-z][A-Za-z'’-]*\s+[A-Za-z][A-Za-z'’-]*)/;

/** 定位时容忍的常见屈折后缀（diminished / remarks / stepped ...）。 */
const SUFFIXES = ['ies', 'ing', 'ied', 'es', 'ed', 'ped', 'ged', 'ted', 'ded', 's', 'd'] as const;

/** 单词级匹配的最短长度：单目标词时要保守，避免满篇命中。 */
const MIN_WORD_LEN = 3;

/** 短语拆分兜底时的最短长度：短语上下文里短词（up / in）也是有效线索。 */
const PHRASE_FALLBACK_MIN_WORD_LEN = 2;

/**
 * 从解析文本中抽取目标词/短语。
 *
 * @param explanation 题目解析原文；为空或无线索时返回 null。
 * @returns 目标词描述，或 null（表示不标注）。
 */
export function extractVocabTarget(explanation: string | null | undefined): VocabTarget | null {
  if (explanation === null || explanation === undefined) return null;
  const source = explanation.trim();
  if (source.length === 0) return null;

  const raw: string | null = pickRaw(source);
  if (raw === null) return null;

  const words = raw.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return null;

  return {
    text: words.join(' '),
    words,
    isPhrase: words.length > 1,
  };
}

/**
 * 在 stem 中定位目标词出现的位置（大小写不敏感，容忍屈折后缀）。
 *
 * @param stem 题干原文。
 * @param target 目标词描述。
 * @returns 命中的 [start, end) 区间列表（升序、互不重叠）；未命中为空数组。
 */
export function findTargetRanges(
  stem: string,
  target: VocabTarget | null | undefined,
): Array<readonly [number, number]> {
  if (target === undefined || target === null) return [];
  if (stem.length === 0 || target.words.length === 0) return [];

  if (target.isPhrase) {
    const phraseRanges = matchPhrase(stem, target.words);
    if (phraseRanges.length > 0) return phraseRanges;
    // 短语整体未命中（如 made it all up）时退化为逐词命中，把短语各词都标出来。
    return matchWords(stem, target.words, PHRASE_FALLBACK_MIN_WORD_LEN);
  }
  return matchWords(stem, [target.words[0] ?? ''], MIN_WORD_LEN);
}

/**
 * 按目标词把 stem 切成若干段，命中段 `target = true`。
 *
 * @param stem 题干原文。
 * @param target 目标词描述；为 null 时返回单段（渲染结果与现状完全一致）。
 */
export function splitStemByTarget(
  stem: string,
  target: VocabTarget | null | undefined,
): readonly StemSegment[] {
  const ranges = findTargetRanges(stem, target);
  if (ranges.length === 0) return [{ text: stem, target: false }];

  const segments: StemSegment[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) segments.push({ text: stem.slice(cursor, start), target: false });
    segments.push({ text: stem.slice(start, end), target: true });
    cursor = end;
  }
  if (cursor < stem.length) segments.push({ text: stem.slice(cursor), target: false });
  return segments;
}

/**
 * 便捷入口：直接从 stem + explanation 得到渲染分段。
 *
 * @param stem 题干原文。
 * @param explanation 题目解析原文。
 */
export function vocabStemSegments(
  stem: string,
  explanation: string | null | undefined,
): readonly StemSegment[] {
  return splitStemByTarget(stem, extractVocabTarget(explanation));
}

// ---------------------------------------------------------------------------
// 内部实现
// ---------------------------------------------------------------------------

/** 优先取明确写作「短语」的两词写法，否则取通用正则的第一个词/两词。 */
function pickRaw(source: string): string | null {
  const phrase = PHRASE_RE.exec(source);
  if (phrase !== null && phrase[1] !== undefined) return phrase[1];
  const generic = TARGET_RE.exec(source);
  if (generic !== null && generic[1] !== undefined) return generic[1];
  return null;
}

/** 构造单词正则源码：原词 + 可选屈折后缀。 */
function wordPattern(word: string): string {
  const escaped = escapeRegExp(word);
  const suffix = `(?:${SUFFIXES.join('|')})?`;
  return `${escaped}${suffix}`;
}

/** 转义正则元字符。 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 短语整体匹配：允许词间为一段空白（含全角空格）。 */
function matchPhrase(stem: string, words: readonly string[]): Array<readonly [number, number]> {
  const pattern = words.map(wordPattern).join('[ \\u3000]+');
  const regex = new RegExp(`(^|[^A-Za-z])(?:${pattern})(?![A-Za-z])`, 'i');
  const match = regex.exec(stem);
  if (match === null) return [];
  const leading = match[1]?.length ?? 0;
  const start = match.index + leading;
  return [[start, start + match[0].length - leading]];
}

/** 逐词匹配（短语整体未命中时的兜底）。 */
function matchWords(
  stem: string,
  words: readonly string[],
  minWordLen: number,
): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  for (const word of words) {
    if (word.length < minWordLen) continue;
    const regex = new RegExp(`(^|[^A-Za-z])(?:${wordPattern(word)})(?![A-Za-z])`, 'i');
    const match = regex.exec(stem);
    if (match === null) continue;
    const leading = match[1]?.length ?? 0;
    const start = match.index + leading;
    ranges.push([start, start + match[0].length - leading]);
  }
  return mergeRanges(ranges);
}

/** 升序合并重叠区间。 */
function mergeRanges(ranges: Array<readonly [number, number]>): Array<readonly [number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<readonly [number, number]> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range[0] <= last[1]) {
      merged[merged.length - 1] = [last[0], Math.max(last[1], range[1])];
      continue;
    }
    merged.push(range);
  }
  return merged;
}
