/**
 * 回忆版试卷（2023-2026 单文件、答案内嵌）解析辅助（T12 管线扩展）。
 *
 * 与 2012-2022 标准管线的差异：
 * - 无独立解析 PDF：答案内嵌在试题文本中，两种形态——
 *   ① 序列式：「参考答案：BCA」（按对话组空位顺序连续认领）；
 *   ② 空位内嵌式：答案字母直接黏在空位号后（「…interview go? 1B」「56A」，
 *      含 OCR 数字混淆「l0A」=10A、「6lA」=61A）。
 * - 2026 文本层部分行字符级镜像反转（如 `.teehS` ← "Sheet"），需逐行方向修复；
 * - 主观题参考答案以「参考译文：」「参考范文：」标记内嵌，阅读文章可能中英混排。
 *
 * 本模块全部为纯函数、无运行时外部依赖；脚本侧 scripts/build_exams.ts 负责编排。
 */

/* ------------------------------------------------------------------ */
/* CJK 判定                                                            */
/* ------------------------------------------------------------------ */

/**
 * 判定一行是否以中文为主导（回忆版中英混排文本里区分英文题干与中文参考）。
 * 规则：含 CJK 且 CJK 字符数 ≥ 拉丁字母数 × threshold（默认 0.3）。
 * 「paternity leave(降产)」→ 2 CJK vs 14 字母 → 非中文行；
 * 「评论1：减少上网时间…」→ 全 CJK → 中文行。
 */
export function isCjkDominant(text: string, threshold = 0.3): boolean {
  let cjk = 0;
  let latin = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x4e00 && code <= 0x9fff) cjk += 1;
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin += 1;
  }
  return cjk > 0 && cjk >= latin * threshold;
}

/* ------------------------------------------------------------------ */
/* 行方向修复（2026 字符级镜像）                                        */
/* ------------------------------------------------------------------ */

/** 英文常见词表（≥3 字母；镜像行丢失空格，只能做子串匹配） */
const EN_COMMON_WORDS: readonly string[] = [
  'the', 'and', 'that', 'with', 'this', 'from', 'have', 'has', 'had', 'not', 'are', 'was', 'were',
  'you', 'your', 'they', 'their', 'there', 'these', 'those', 'which', 'what', 'when', 'where',
  'how', 'why', 'who', 'whom', 'but', 'all', 'can', 'will', 'would', 'could', 'should', 'may',
  'might', 'more', 'than', 'been', 'into', 'also', 'some', 'such', 'each', 'other', 'about',
  'because', 'while', 'people', 'work', 'time', 'years', 'year', 'make', 'made', 'many', 'much',
  'answer', 'sheet', 'section', 'directions', 'passage', 'dialogue', 'question', 'questions',
  'part', 'points', 'point', 'minutes', 'minute', 'writing', 'translation', 'vocabulary',
  'reading', 'comprehension', 'cloze', 'completion', 'text', 'comment', 'comments', 'choose',
  'choose', 'mark', 'best', 'blank', 'blanks', 'word', 'words', 'study', 'research', 'student',
  'students', 'according', 'following', 'underline', 'underlined', 'phrase', 'phrases',
  'choices', 'choice', 'three', 'four', 'ten', 'twenty', 'incomplete', 'conversation',
  'oral', 'communication', 'paper', 'write', 'composition', 'in this', 'there is', 'there are',
  'of the', 'in the', 'on the', 'to the', 'for the', 'with the', 'and the', 'from the',
];

/** 中文常用双字词（镜像中文行反转后应大量命中；反转态几乎不命中） */
const ZH_COMMON_BIGRAMS: readonly string[] = [
  '我们', '他们', '你们', '这个', '那个', '什么', '一个', '一些', '可以', '应该', '或者', '因为',
  '所以', '但是', '如果', '已经', '没有', '就是', '也是', '还有', '对于', '关于', '通过', '进行',
  '问题', '答案', '参考', '试卷', '考试', '英语', '题目', '选择', '文章', '阅读', '理解', '翻译',
  '写作', '词汇', '完形', '填空', '对话', '口语', '交际', '评论', '研究', '工作', '生活', '自己',
  '重要', '影响', '环境', '社会', '学生', '大学', '可能', '需要', '认为', '表示', '发现', '知道',
  '时间', '现在', '以后', '以前', '时候', '地方', '一样', '不同', '非常', '更多', '以及其他',
];

/** 行方向合理性得分：英文常见词 + 中文常用双字词的命中加权和 */
export function textPlausibilityScore(text: string): number {
  let score = 0;
  const lower = text.toLowerCase();
  for (const w of EN_COMMON_WORDS) {
    let idx = lower.indexOf(w);
    while (idx !== -1) {
      score += w.length >= 5 ? 2 : 1;
      idx = lower.indexOf(w, idx + w.length);
    }
  }
  for (const bg of ZH_COMMON_BIGRAMS) {
    let idx = text.indexOf(bg);
    while (idx !== -1) {
      score += 2;
      idx = text.indexOf(bg, idx + bg.length);
    }
  }
  return score;
}

/** 字符级反转一行（用码点数组，避免代理对被拆开） */
export function reverseLine(line: string): string {
  return [...line].reverse().join('');
}

/** 行方向修复结果 */
export interface DirectionFixResult {
  /** 修复后的完整文本 */
  text: string;
  /** 非空行总数 */
  totalLines: number;
  /** 被判定为镜像并反转的行数 */
  reversedLines: number;
}

/**
 * 逐行方向修复：对每个非空行计算正/反两个方向的合理性得分，
 * 反向显著更高才反转（严格大于，打平保持原样——避免误伤正常行）。
 * 混排行（半行镜像半行正常）只能部分修复，残余乱码由调用方报告，不编造补全。
 */
export function fixLineDirections(raw: string): DirectionFixResult {
  let totalLines = 0;
  let reversedLines = 0;
  const lines = raw.split('\n').map((line) => {
    if (line.trim().length === 0) return line;
    totalLines += 1;
    const reversed = reverseLine(line);
    if (reversed === line) return line;
    const forward = textPlausibilityScore(line);
    const backward = textPlausibilityScore(reversed);
    if (backward > forward && backward > 0) {
      reversedLines += 1;
      return reversed;
    }
    return line;
  });
  return { text: lines.join('\n'), totalLines, reversedLines };
}

/* ------------------------------------------------------------------ */
/* 内嵌答案提取                                                        */
/* ------------------------------------------------------------------ */

/**
 * 空位内嵌答案 token：数字（含 OCR 「l/1」混淆：l0=10、6l=61）+ 可选空白 + A-D。
 * 前向断言字母后不得紧跟字母（排除「1Bs」类单词）；后向排除字母/点号前缀（排除小数、ID 编号）。
 */
const INLINE_ANSWER_TOKEN_RE = /(?<![\w.）)])(\d{1,2}|l\d|\dl)\s*([A-D])(?![A-Za-z])/g;

/** 内嵌答案提取结果 */
export interface InlineAnswerExtraction {
  /** 处理后的行（答案字母已被剥除，空位号保留，供下游 BLANK_TOKEN 识别） */
  lines: string[];
  /** 空位号 → 答案字母（同一空位首次出现者优先） */
  answers: Map<number, string>;
}

/**
 * 剥除空位内嵌答案字母并收集答案。
 * 仅处理 [minSeq, maxSeq] 范围内的空位号，范围外的「数字+字母」序列原样保留。
 * 「…interview go? 1B」→「…interview go? 1」+ answers[1]=B；
 * 「Receptionist Okay. l0A」→「Receptionist Okay. 10」+ answers[10]=A。
 */
export function stripInlineAnswerLetters(
  lines: readonly string[],
  minSeq: number,
  maxSeq: number,
): InlineAnswerExtraction {
  const answers = new Map<number, string>();
  const out = lines.map((line) =>
    line.replace(INLINE_ANSWER_TOKEN_RE, (whole: string, numRaw: string, letter: string) => {
      const digits = numRaw.replace(/l/g, '1');
      const n = Number.parseInt(digits, 10);
      if (!Number.isFinite(n) || n < minSeq || n > maxSeq || answers.has(n)) return whole;
      answers.set(n, letter.toUpperCase());
      return digits;
    }),
  );
  return { lines: out, answers };
}

/** 序列式答案标记：「参考答案：BCA」（冒号可省略，回忆版镜像还原后亦同） */
const ANSWER_SEQ_RE = /参考答案\s*[:：]?\s*([A-D]{2,12})/g;

/** 序列式答案提取结果 */
export interface AnswerSeqExtraction {
  /** 处理后的行（「参考答案：XXX」标记已移除，空位号保留） */
  lines: string[];
  /** 空位号 → 答案字母（按出现顺序从 startSeq 起连续认领） */
  answers: Map<number, string>;
}

/**
 * 提取序列式内嵌答案（回忆版对话组）。
 * 「参考答案：BCA」按出现顺序把 B/C/A 依次分配给从 startSeq 起的连续空位；
 * 标记本身从行中移除（黏在空位行尾时保留空位号，如「…is. 6 ... 参考答案：CBA」）。
 */
export function extractAnswerSequences(lines: readonly string[], startSeq = 1): AnswerSeqExtraction {
  const answers = new Map<number, string>();
  let next = startSeq;
  const out = lines.map((line) => {
    if (!line.includes('参')) return line;
    return line.replace(ANSWER_SEQ_RE, (_whole: string, seq: string) => {
      for (const ch of seq) {
        if (next >= 1 && next <= 99) answers.set(next, ch.toUpperCase());
        next += 1;
      }
      return '';
    });
  });
  return { lines: out, answers };
}

/* ------------------------------------------------------------------ */
/* 主观题参考答案拆分                                                  */
/* ------------------------------------------------------------------ */

/** 主观题参考答案标记（参考译文 / 参考范文 / 范文N） */
const REFERENCE_MARKER_RE = /参考译文|参考范文|范文\s*\d*\s*[：:]/;

/** 主观题拆分结果 */
export interface ReferenceSplit {
  /** 题干（英文部分） */
  stem: string;
  /** 参考答案（中文部分）；无则空串 */
  reference: string;
}

/** 多行拼接（保段落空行，与脚本侧 joinContent 口径一致） */
function joinLines(lines: readonly string[]): string {
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 把英中混排的主观题文本拆成题干与参考答案：
 * ① 有「参考译文：」「参考范文：」「范文N：」标记 → 标记前为题干、标记起（含同行余文）为参考；
 * ② 无标记 → 首个中文主导行起为参考（回忆版翻译段英中交替排版）。
 */
export function splitReferenceAnswer(text: string): ReferenceSplit {
  const lines = text.split('\n');
  const markerIdx = lines.findIndex((l) => REFERENCE_MARKER_RE.test(l));
  if (markerIdx >= 0) {
    const markerLine = lines[markerIdx] ?? '';
    const m = REFERENCE_MARKER_RE.exec(markerLine);
    const cut = m ? markerLine.slice(m.index) : markerLine;
    const referenceBody = cut.replace(/^(参考译文|参考范文|范文\s*\d*)\s*[:：]?/, '').trim();
    const reference = joinLines([referenceBody, ...lines.slice(markerIdx + 1)]);
    const stem = joinLines(lines.slice(0, markerIdx));
    return { stem, reference };
  }
  const firstCjk = lines.findIndex((l) => isCjkDominant(l));
  if (firstCjk < 0) return { stem: joinLines(lines), reference: '' };
  return {
    stem: joinLines(lines.slice(0, firstCjk)),
    reference: joinLines(lines.slice(firstCjk)),
  };
}
