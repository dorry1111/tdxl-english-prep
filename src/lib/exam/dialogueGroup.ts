/**
 * 口语交际（dialogue）分组与正文还原（纯函数，无 React 依赖）。
 *
 * 数据现状（2012-2026真题）：口语题 passageId 为 null，对话正文被复制进每一题的 stem，
 * 且每道 stem 只是「以本题空位为中心的一段窗口」：
 *   - 窗口里自己的空位写作 `____`，组内其它空位退化成裸数字（如 `...one book. 3`）；
 *   - 窗口之间可能完全重叠（同一段对话换了个空位标记），也可能互不重叠（对话的不同片段）。
 * 因此一屏直接罗列 10 道题会把同一段对话重复显示 3 遍以上，读不通。
 *
 * 本模块做三件事：
 *   1. 按「选项签名」把口语题分组（同一段对话共用同一组选项，签名必然相同）；
 *   2. 把窗口归一化为 `____(N)` 标记，再按重叠关系合并成一段完整对话正文；
 *   3. 提供答题页的「按组翻页」序列。
 *
 * 约束：只读，不修改任何 JSON 数据文件；组不成（如 2012 十段独立对话）时退化为「一题一组」，
 * 行为与现状一致。
 */
import type { Question } from '@/types';

/** 一组口语题（同一段对话 + 若干空位）。 */
export interface DialogueGroup {
  /** 组内题目，按空位序号升序。 */
  questions: readonly Question[];
  /** 组内空位序号，升序。 */
  blanks: readonly number[];
  /** 选项签名（分组依据）。 */
  signature: string;
  /** 归一化并合并后的对话正文，空位写作 `____(N)`。 */
  text: string;
  /** 组内第一题的 seq（翻页锚点）。 */
  anchorSeq: number;
}

/** 答题页的一屏：口语题按组，其余按题。 */
export interface QuestionPage {
  /** 点开这一屏时的定位 seq。 */
  anchorSeq: number;
  /** 这一屏包含的 seq（升序）。 */
  seqs: readonly number[];
  /** 口语组 id（非口语题为 null）。 */
  groupKey: string | null;
}

/** stem 前缀「（第 N 空）」——只剥离开口的这一枚。 */
const BLANK_PREFIX_RE = /^\s*（\s*第\s*\d+\s*空\s*）\s*/;

/** 窗口内孤立数字：仅匹配 1~2 位、且两侧不是字母数字的裸数字。 */
const BARE_NUMBER_RE = /(^|[^0-9A-Za-z])(\d{1,2})(?![0-9A-Za-z])/g;

/**
 * 自己的空位：`____`（后面不能紧跟已经写好的 `(N)`，也不能还跟着下划线，
 * 否则贪婪回溯会把 `____(3)` 切成 `___` + `_(3)`）。
 */
const OWN_BLANK_RE = /_{2,}(?![_(])/g;

/** 已生成的空位标记。 */
const MARKER_RE = /____\((\d+)\)/g;

/** 合并窗口时认可的最小重叠长度（字符数），低于此值视为「互不重叠的两个片段」。 */
const MIN_OVERLAP = 12;

/**
 * 口语题的空位序号：blankIndex 缺失时回落到 seq。
 *
 * @param question 题目。
 */
export function dialogueBlankIndex(question: Question): number {
  return question.blankIndex ?? question.seq;
}

/**
 * 选项签名：选项键 + 去空格后的选项文本。
 * 同一段对话的所有空位共用一组选项，签名相同；不同对话必然不同。
 *
 * @param question 题目。
 */
export function optionsSignatureOf(question: Question): string {
  return question.options.map((option) => `${option.key}\u0001${option.text.trim()}`).join('\u0002');
}

/**
 * 归一化单个窗口：剥离「（第 N 空）」前缀、空位写成 `____(N)`。
 *
 * @param stem 题干原文。
 * @param blanks 组内全部空位序号。
 * @param ownBlank 本题空位序号。
 * @returns 归一化后的窗口文本。
 */
export function normalizeDialogueStem(
  stem: string,
  blanks: readonly number[],
  ownBlank: number,
): string {
  // 同一段对话在不同题干里只是空格数量不同（双空格 / 单空格），先归一，才能互相去重
  const withoutPrefix = stem.replace(BLANK_PREFIX_RE, '').replace(/[ \t\u3000]+/g, ' ');
  const blankSet = new Set(blanks);
  // 先处理裸数字（此时题干里还没有 (N) 形态，不会二次替换）
  const withNumbers = withoutPrefix.replace(BARE_NUMBER_RE, (match, prefix: string, digits: string) => {
    const value = Number(digits);
    return blankSet.has(value) ? `${prefix}____(${value})` : match;
  });
  // 再处理本题自己的下划线空位
  return withNumbers.replace(OWN_BLANK_RE, `____(${ownBlank})`);
}

/**
 * 求 a 的后缀与 b 的前缀的最长重叠长度。
 *
 * @param a 左侧文本。
 * @param b 右侧文本。
 * @param minLen 认可的最小重叠长度。
 * @returns 重叠长度（0 表示无有效重叠）。
 */
function suffixPrefixOverlap(a: string, b: string, minLen: number): number {
  const max = Math.min(a.length, b.length);
  for (let size = max; size >= minLen; size--) {
    if (a.endsWith(b.slice(0, size))) {
      return size;
    }
  }
  return 0;
}

/**
 * 合并同一段对话的多个窗口为一段完整正文。
 *
 * 规则（按顺序判定）：已包含的窗口丢弃；有 ≥MIN_OVERLAP 重叠则拼接；完全覆盖则替换；
 * 都不满足视为对话的不同片段，按空格顺序拼接（换行分隔）。
 *
 * @param windows 归一化后的窗口文本列表（按空位升序）。
 * @returns 合并后的对话正文。
 */
export function mergeDialogueWindows(windows: readonly string[]): string {
  let acc = '';
  for (const raw of windows) {
    const part = raw.trim();
    if (part.length === 0) {
      continue;
    }
    if (acc.length === 0) {
      acc = part;
      continue;
    }
    if (acc.includes(part)) {
      continue;
    }
    if (part.includes(acc)) {
      acc = part;
      continue;
    }
    const forward = suffixPrefixOverlap(acc, part, MIN_OVERLAP);
    const backward = suffixPrefixOverlap(part, acc, MIN_OVERLAP);
    if (forward >= backward && forward > 0) {
      acc = acc + part.slice(forward);
      continue;
    }
    if (backward > 0) {
      acc = part + acc.slice(backward);
      continue;
    }
    acc = `${acc}\n${part}`;
  }
  return acc;
}

/**
 * 由组内题目还原对话正文。
 *
 * @param groupQuestions 同组题目（任意顺序，内部按空位排序）。
 * @returns 合并后的对话正文；空组返回空串。
 */
export function buildDialogueText(groupQuestions: readonly Question[]): string {
  if (groupQuestions.length === 0) {
    return '';
  }
  const ordered = [...groupQuestions].sort(
    (left, right) => dialogueBlankIndex(left) - dialogueBlankIndex(right),
  );
  const blanks = ordered.map((question) => dialogueBlankIndex(question));
  const windows = ordered.map((question) =>
    normalizeDialogueStem(question.stem, blanks, dialogueBlankIndex(question)),
  );
  return mergeDialogueWindows(windows);
}

/**
 * 把口语题按选项签名分组（只处理 sectionType === 'dialogue'）。
 *
 * 签名变化即开新组；2012 这类「十段独立对话」会自然退化成十个单题组。
 *
 * @param questions 全套题目。
 * @returns 口语组列表（按出现顺序）。
 */
export function groupDialogueQuestions(questions: readonly Question[]): DialogueGroup[] {
  const dialogues = questions.filter((question) => question.sectionType === 'dialogue');
  if (dialogues.length === 0) {
    return [];
  }
  const groups: DialogueGroup[] = [];
  let bucket: Question[] = [];
  let signature = '';

  const flush = (): void => {
    if (bucket.length === 0) {
      return;
    }
    const ordered = [...bucket].sort(
      (left, right) => dialogueBlankIndex(left) - dialogueBlankIndex(right),
    );
    const first = ordered[0];
    if (!first) {
      return;
    }
    groups.push({
      questions: ordered,
      blanks: ordered.map((question) => dialogueBlankIndex(question)),
      signature: optionsSignatureOf(first),
      text: buildDialogueText(ordered),
      anchorSeq: first.seq,
    });
    bucket = [];
  };

  for (const question of dialogues) {
    const current = optionsSignatureOf(question);
    if (bucket.length === 0) {
      signature = current;
      bucket = [question];
      continue;
    }
    if (current === signature) {
      bucket.push(question);
      continue;
    }
    flush();
    signature = current;
    bucket = [question];
  }
  flush();
  return groups;
}

/** 对话正文的分段：普通文本 or 空位标记。 */
export type DialogueTextPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'blank'; readonly blank: number };

/**
 * 把对话正文切成「文本 / 空位」分段，便于渲染成长下划线标记。
 *
 * @param text buildDialogueText 的产物。
 */
export function splitDialogueText(text: string): readonly DialogueTextPart[] {
  const parts: DialogueTextPart[] = [];
  let cursor = 0;
  MARKER_RE.lastIndex = 0;
  let match = MARKER_RE.exec(text);
  while (match !== null) {
    if (match.index > cursor) {
      parts.push({ kind: 'text', text: text.slice(cursor, match.index) });
    }
    parts.push({ kind: 'blank', blank: Number(match[1]) });
    cursor = match.index + match[0].length;
    match = MARKER_RE.exec(text);
  }
  if (cursor < text.length) {
    parts.push({ kind: 'text', text: text.slice(cursor) });
  }
  return parts;
}

/**
 * 构造答题页的一屏序列：口语题按组合屏，其余题型一题一屏。
 *
 * @param questions 全套题目。
 * @returns 按 seq 升序的一屏列表。
 */
export function buildQuestionPages(questions: readonly Question[]): QuestionPage[] {
  const groups = groupDialogueQuestions(questions);
  const groupOfSeq = new Map<number, string>();
  const pagesByGroup = new Map<string, QuestionPage>();
  for (const group of groups) {
    for (const question of group.questions) {
      groupOfSeq.set(question.seq, group.signature);
    }
    pagesByGroup.set(group.signature, {
      anchorSeq: group.anchorSeq,
      seqs: group.questions.map((question) => question.seq),
      groupKey: group.signature,
    });
  }
  const pages: QuestionPage[] = [];
  const seenGroups = new Set<string>();
  for (const question of questions) {
    const groupKey = groupOfSeq.get(question.seq) ?? null;
    if (groupKey !== null) {
      if (seenGroups.has(groupKey)) {
        continue;
      }
      seenGroups.add(groupKey);
      const page = pagesByGroup.get(groupKey);
      if (page) {
        pages.push(page);
      }
      continue;
    }
    pages.push({ anchorSeq: question.seq, seqs: [question.seq], groupKey: null });
  }
  return pages;
}
