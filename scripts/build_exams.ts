/**
 * 11 年真题离线管线（T12 配套，ARCHITECTURE 4.3 / PRD 8.3）。
 *
 * 输入：data-raw/exams/<year>-exam.txt / <year>-sol.txt
 *       （由 scripts/extract_pdf_text.py 从真题/解析 PDF 的文本层抽取）
 * 输出：
 *  - public/data/exams/<year>.json      PRD 8.3 格式试卷（2012-2022 共 11 份）
 *  - src/test/fixtures/paperText.ts     2013 年 77 题整卷纯文本 fixture（T12 回归基准）
 *  - data-raw/exams/parse-report.md     质量报告（区段/题量/答案/未识别行等指标）
 *
 * 运行：npx vite-node scripts/build_exams.ts
 * 幂等：输出只取决于输入文本，可重复执行。
 *
 * 数据事实说明：all_pages.json 是大纲词汇表 OCR，不是真题；
 * 真题/解析 PDF 自带文本层，直接抽取即可（详见 parse-report.md）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalizeText } from '@/lib/exam/parse/normalize';
import { splitSections } from '@/lib/exam/parse/splitSections';
import {
  extractAnswerSequences,
  fixLineDirections,
  isCjkDominant,
  splitReferenceAnswer,
  stripInlineAnswerLetters,
} from '@/lib/exam/parse/recalledExam';
import { validateExamJson, type ExamJsonFile, type ExamJsonOption } from '@/lib/importers/examJson';

/* ------------------------------------------------------------------ */
/* 基础                                                                */
/* ------------------------------------------------------------------ */

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, 'data-raw', 'exams');
const OUT_DIR = path.join(ROOT, 'public', 'data', 'exams');
const FIXTURE_PATH = path.join(ROOT, 'src', 'test', 'fixtures', 'paperText.ts');
const REPORT_PATH = path.join(DATA_DIR, 'parse-report.md');

const YEARS = [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022];

/** 回忆版年份（2023-2026 单文件、答案内嵌；逐卷验证后加入） */
const RECALLED_YEARS = [2023, 2024, 2025, 2026];

const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'];

type SectionType = ExamJsonFile['questions'][number]['sectionType'];
type Option = ExamJsonOption;

interface RawQuestion {
  seq: number;
  sectionType: SectionType;
  stem: string;
  options: Option[];
  answerKey: string | null;
  referenceAnswer: string | null;
  explanation: string;
  score: number;
  passageId: string | null;
  blankIndex: number | null;
}

interface SectionSpec {
  type: SectionType;
  order: number;
  questionCount: number;
  score: number;
  minutes: number;
}

interface YearPaper {
  year: number;
  sections: SectionSpec[];
  passages: ExamJsonFile['passages'];
  questions: RawQuestion[];
  /** 质量指标 */
  stats: YearStats;
}

interface YearStats {
  /** 预期区段数 */
  expectedSections: number;
  /** 预期题量 */
  expectedQuestions: number;
  /** 预期客观题答案数 */
  expectedAnswers: number;
  identifiedSections: number;
  questions: number;
  answersExtracted: number;
  explanationsExtracted: number;
  subjectiveRefs: number;
  /** 被管线忽略的行（Directions 等非数据行） */
  ignoredLines: number;
  /** 无法归类的行 */
  unresolvedLines: number;
  unresolvedSamples: string[];
  /** 回忆版题号笔误被机械重编号的题目（原 seq → 新 seq；真实缺题断档不在此列） */
  renumberedSeqs?: Array<{ from: number; to: number }>;
  /** 回忆版方向修复（2026）：被判定为镜像并反转的行数 / 非空行总数 */
  directionFixed?: { reversed: number; total: number };
  /** 回忆版解析出的空题干废题数（2026 混排残片，无内容价值，丢弃并计数） */
  droppedEmptyStems?: number;
}

/** 新大纲格式（2013-2022）：口语10/词汇10/阅读25/完形10/短文完成20/翻译1×10/写作1×15 */
function newFormatSections(): SectionSpec[] {
  return [
    { type: 'dialogue', order: 1, questionCount: 10, score: 10, minutes: 15 },
    { type: 'vocabulary', order: 2, questionCount: 10, score: 10, minutes: 10 },
    { type: 'reading', order: 3, questionCount: 25, score: 25, minutes: 45 },
    { type: 'cloze', order: 4, questionCount: 10, score: 10, minutes: 10 },
    { type: 'short-completion', order: 5, questionCount: 20, score: 20, minutes: 20 },
    { type: 'translation', order: 6, questionCount: 1, score: 10, minutes: 20 },
    { type: 'writing', order: 7, questionCount: 1, score: 15, minutes: 30 },
  ];
}

/** 旧格式（2012）：口语10/词汇20×0.5/阅读30/完形15/翻译2×10/写作1×15 */
function oldFormatSections(): SectionSpec[] {
  return [
    { type: 'dialogue', order: 1, questionCount: 10, score: 10, minutes: 10 },
    { type: 'vocabulary', order: 2, questionCount: 20, score: 10, minutes: 20 },
    { type: 'reading', order: 3, questionCount: 30, score: 30, minutes: 45 },
    { type: 'cloze', order: 4, questionCount: 15, score: 15, minutes: 15 },
    { type: 'translation', order: 5, questionCount: 2, score: 20, minutes: 30 },
    { type: 'writing', order: 6, questionCount: 1, score: 15, minutes: 30 },
  ];
}

/** 读取并规范化年份文本 */
function loadYearText(year: number, kind: 'exam' | 'sol'): string {
  const file = path.join(DATA_DIR, `${year}-${kind}.txt`);
  const raw = fs.readFileSync(file, 'utf-8');
  const withoutPageMarks = raw
    .split('\n')
    .filter((l) => !/^<<<PAGE \d+>>>$/.test(l.trim()))
    .join('\n');
  // 页脚模式 =「口号行 + 纯页码行」成对出现，先成对剔除；
  // 其余纯数字行（口语对话的空位号）必须保留，不能当页码删。
  const withoutFooterPairs = withoutPageMarks.replace(/有志者事竟成\n\d{1,4}\n/g, '有志者事竟成\n');
  const normalized = normalizeText(withoutFooterPairs, {
    extraHeaderFooter: [/^有志者事竟成$/],
    keepBareNumberLines: true,
  });
  return ensureMarkersOnOwnLines(normalized);
}

/**
 * PDF 文本层常把结构标记拼在上一行末尾（如「…D. The student. Passage Two」、
 * 「…grateful friends. Part VII Writing (30 minutes, 15 points)」），甚至粘连成
 * 「PartIIVocabulary」。把这些标记拆到独立行并补空格，后续按行切区段才可靠。
 */
function ensureMarkersOnOwnLines(text: string): string {
  // 粘连修复：PartII Vocabulary → Part II Vocabulary
  let out = text.replace(
    /\bPart(II|III|IV|VI|VII|IX|I|V|X)(?=(Vocabulary|Reading|Cloze|Writing|Translation|Text\s*Completion|Oral|Dialogue|Comprehension|Communication))/g,
    'Part $1 ',
  );
  const markerLookaheads: RegExp[] = [
    /(?<=\S)\s+(?=Paper\s+(?:One|Two)\b)/g,
    /(?<=\S)\s+(?=Part\s+(?:[IVX]+|[ⅠⅡⅢⅣⅤⅥⅦ]|\d+)\s*[A-Z（(])/g,
    /(?<=\S)\s+(?=Section\s+[AB]\b)/g,
    /(?<=\S)\s+(?=Dialogue\s+(?:One|Two|Three|Four)\b)/g,
    /(?<=\S)\s+(?=Passage\s+(?:One|Two|Three|Four|Five|Six)\b)/g,
    /(?<=\S)\s+(?=Text\s+(?:One|Two|Three|Four)\b)/g,
  ];
  for (const re of markerLookaheads) {
    out = out.replace(re, '\n');
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 回忆版数据源（2023-2026 单文件，答案内嵌）                            */
/* ------------------------------------------------------------------ */

/** 回忆版广告/页脚/占位行（eduego 招生网水印、尾页广告块、「更多题目待补充」占位） */
const RECALLED_AD_RE =
  /在职研究生|eduego\.com|微信服务号|微信订阅号|招生简章|门户网站|咨询电话|扫一扫|备考资料|历年真题|考试大纲|大纲解析|复习指导|应有尽有|答疑服务|同等学力|在职硕士|在职博士|国际博士|国际硕士|非全日制|中外合办|高端培训|院校研修|专业硕士|EMBA|MBA|更多题目待补充/;

/** 读取并规范化回忆版年份文本（单文件、无独立解析 PDF） */
function loadRecalledYearText(
  year: number,
  report?: { reversed: number; total: number },
): string {
  const raw = fs.readFileSync(path.join(DATA_DIR, `${year}-exam.txt`), 'utf-8');
  const withoutPageMarks = raw
    .split('\n')
    .filter((l) => !/^<<<PAGE \d+>>>$/.test(l.trim()))
    .join('\n');
  // 2026 文本层部分行字符级镜像反转，先做逐行方向修复再走常规规范化
  let filtered: string;
  if (year === 2026) {
    const fixedRes = fixLineDirections(withoutPageMarks);
    if (report) {
      report.reversed = fixedRes.reversedLines;
      report.total = fixedRes.totalLines;
    }
    filtered = fixedRes.text;
  } else {
    filtered = withoutPageMarks;
  }
  const cleaned = filtered
    .split('\n')
    .filter((l) => !RECALLED_AD_RE.test(l))
    .join('\n');
  const normalized = normalizeText(cleaned, {
    extraHeaderFooter: [
      /^英语试卷$/,
      /^第\s*\d+\s*共页\s*\d+\s*页$/,
      /^卷试语英$/,
      // 回忆版页脚变体：「第 11 页 共 13 页」（无斜杠，与旧卷「第 X 页/共 Y 页」不同）
      /^第\s*\d+\s*页\s*共\s*\d+\s*页$/,
    ],
    keepBareNumberLines: true,
  });
  return ensureMarkersOnOwnLines(normalized);
}

/** 2023 无 Part I 标题（Dialogue One 直接跟在 Paper One 后）：注入口语交际区段头 */
function injectDialogueHeader2023(lines: string[]): string[] {
  return lines.flatMap((l) => (/^Paper One\b/i.test(l.trim()) ? [l, '口语交际'] : [l]));
}

/* ------------------------------------------------------------------ */
/* 解析文本工具                                                        */
/* ------------------------------------------------------------------ */

/** 把一段行流按「行首题号」切成题块；序号必须在 [minSeq, maxSeq] 且递增 */
function splitQuestionBlocks(lines: string[], minSeq: number, maxSeq: number): Array<{ seq: number; lines: string[] }> {
  const blocks: Array<{ seq: number; lines: string[] }> = [];
  let current: { seq: number; lines: string[] } | null = null;
  let expected = minSeq;
  const startRe = /^\s*(\d{1,3})\s*[.、．](?!\s*\d)/;
  for (const line of lines) {
    const m = startRe.exec(line);
    const n = m ? Number.parseInt(m[1] ?? '0', 10) : 0;
    if (m && n >= expected && n <= maxSeq && (current === null || n === current.seq + 1 || n >= expected)) {
      // 题号必须单调递增且落在预期范围内（防止正文里「the perfect 15.」误切）
      if (current === null || n > current.seq) {
        current = { seq: n, lines: [line.replace(startRe, '')] };
        blocks.push(current);
        expected = n + 1;
        continue;
      }
    }
    if (current) current.lines.push(line);
  }
  return blocks;
}

/**
 * 修复 PDF 文本层黏连：「recommendD. debate」→「recommend D. debate」。
 * 仅在小写字母后「紧跟」A-D + 点号类标点处预插空格再拆；
 * 大写缩写（DNA. / ID.）前是大写字母不匹配，单词内部大写（kB.D 之类）实践中不存在。
 */
function unglueOptionMarkers(text: string): string {
  return text.replace(/([a-z])([A-D])([.、．)）])/g, '$1 $2$3');
}

/** 在一段文本中拆出 A-D 选项：从第一个 A 标记起取最长连续升序串 */
function splitOptionsFrom(text: string): { stem: string; options: Option[] } | null {
  text = unglueOptionMarkers(text);
  // 标记字母允许紧跟在点号后（「46.A. on」这种 PDF 粘连）；
  // 回忆版（2024 Q30「D,Fireworks…」）标记后也可为逗号
  const markerRe = /(?:^|[\s(（.．、])([A-D])\s*[.、．)）,，]\s*/g;
  const marks: Array<{ key: string; start: number; end: number }> = [];
  for (let m = markerRe.exec(text); m !== null; m = markerRe.exec(text)) {
    marks.push({ key: m[1] ?? '', start: m.index, end: m.index + m[0].length });
  }
  if (marks.length < 2) return null;
  // 从第一个 A 标记起，按位置顺序收集不重复的选项标记（容忍 PDF 拼接导致的乱序，如 A、C、B），
  // 遇到重复 key（如 Directions 里的「A, B, C and D.」）即停
  let first = marks.findIndex((mk) => mk.key === 'A');
  if (first < 0) return null;
  const seen = new Set<string>();
  const ordered: Array<{ key: string; start: number; end: number }> = [];
  for (let i = first; i < marks.length; i += 1) {
    const mark = marks[i];
    if (!mark) continue;
    if (seen.has(mark.key)) break;
    seen.add(mark.key);
    ordered.push(mark);
  }
  if (ordered.length < 3) return null;
  const options: Option[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const mark = ordered[i];
    if (!mark) continue;
    const next = ordered[i + 1];
    const segEnd = next ? next.start : text.length;
    // 选项文本在结构标记（Section/Directions/Passage/Text）处截断
    const segText = text
      .slice(mark.end, segEnd)
      .split(/\s+(?=Section\s+[AB]\b|Directions\b|Passage\s+\w+\b|Text\s+\w+\b)/)[0]
      .trim();
    if (!segText) return null;
    options.push({ key: mark.key, text: segText });
  }
  options.sort((a, b) => a.key.localeCompare(b.key));
  const firstMark = ordered[0];
  if (!firstMark) return null;
  const stem = text.slice(0, firstMark.start).trim();
  return { stem, options };
}

/**
 * 宽松选项拆分（完形兜底）：容忍「B replaces」「C.affects」这类缺点号写法。
 * 仅在严格拆分失败时使用，要求连续升序 ≥3 且每段 ≤ 40 字符。
 */
function splitOptionsLoose(text: string, maxSeg = 40): Option[] | null {
  text = unglueOptionMarkers(text);
  const markerRe = /(?:^|[\s(（.．、])([A-D])\s*(?:[.、．)）]\s*|\s+)/g;
  const marks: Array<{ key: string; start: number; end: number }> = [];
  for (let m = markerRe.exec(text); m !== null; m = markerRe.exec(text)) {
    marks.push({ key: m[1] ?? '', start: m.index, end: m.index + m[0].length });
  }
  let first = marks.findIndex((mk) => mk.key === 'A');
  if (first < 0) return null;
  const run: Array<{ key: string; start: number; end: number }> = [marks[first]!];
  for (let i = first + 1; i < marks.length; i += 1) {
    const prev = run[run.length - 1];
    const cur = marks[i];
    if (!prev || !cur || cur.key.charCodeAt(0) !== prev.key.charCodeAt(0) + 1) break;
    run.push(cur);
  }
  if (run.length < 3) return null;
  const options: Option[] = [];
  for (let i = 0; i < run.length; i += 1) {
    const mark = run[i];
    if (!mark) continue;
    const next = run[i + 1];
    const segEnd = next ? next.start : text.length;
    const segText = text.slice(mark.end, segEnd).trim();
    if (!segText || segText.length > maxSeg) return null;
    options.push({ key: mark.key, text: segText });
  }
  return options;
}

/** 题块 → { stem, options }：合并行后在全文里找选项序列 */
function parseStemAndOptions(blockLines: string[]): { stem: string; options: Option[] } {
  const joined = blockLines.map((l) => l.trim()).join(' ').replace(/\s+/g, ' ');
  const parsed = splitOptionsFrom(joined);
  if (parsed) {
    // 标准卷为 4 选项；严格拆分缺项（如「C. attend to D stick to」缺点号粘连）时用宽松拆分补齐
    if (parsed.options.length < 4) {
      const loose = splitOptionsLoose(joined, 80);
      if (loose && loose.length > parsed.options.length) {
        return { stem: parsed.stem, options: loose };
      }
    }
    return parsed;
  }
  // 严格拆分失败时用宽松拆分兜底（「B Negative. C. Unclear」这类缺点号写法）
  const loose = splitOptionsLoose(joined);
  if (loose) {
    const firstA = /(?:^|[\s(（.．、])A\s*(?:[.、．)）]|\s+)/.exec(joined);
    const stem = firstA ? joined.slice(0, firstA.index).trim() : '';
    return { stem, options: loose };
  }
  return { stem: joined, options: [] };
}

/** 纯文本段落拼接（保段落空行） */
function joinContent(lines: string[]): string {
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ------------------------------------------------------------------ */
/* 解析「解析」文本（答案 + 逐题解析 + 主观题参考答案）                   */
/* ------------------------------------------------------------------ */

interface SolutionData {
  /** 客观题答案（含口语的 1-10） */
  answers: Map<number, string>;
  /** 逐题解析（来自【解析】及后续块） */
  explanations: Map<number, string>;
  /** 英译汉参考译文（新格式 1 篇 / 旧格式 Section A） */
  translationA: string;
  /** 汉译英参考译文（仅旧格式 Section B） */
  translationB: string;
  /** 写作范文 */
  writing: string;
}

function parseSolution(solText: string, oldFormat: boolean): SolutionData {
  const lines = solText.split('\n');
  const answers = new Map<number, string>();
  const explanations = new Map<number, string>();
  const data: SolutionData = { answers, explanations, translationA: '', translationB: '', writing: '' };

  // 容忍两种粘连：「1.【答案】A」与「4【. 答案】B」（点号在括号内）
  const qStartRe = /^\s*(\d{1,3})\s*[.、．]?[\s【（(]*[.、．]?\s*答案\s*】?\s*[:：]?\s*(.*)$/;
  const keyLineRe = /^\s*\d{1,2}\s*[.、．]\s*[A-D]\s+\d{1,2}\s*[.、．]\s*[A-D]/;
  const pairRe = /(\d{1,2})\s*[.、．]\s*([A-D])(?=\s|$)/g;

  // 1. 批量答案行（如「1. B 2. B 3. C …」）
  for (const line of lines) {
    if (!keyLineRe.test(line)) continue;
    for (const m of line.matchAll(pairRe)) {
      const seq = Number.parseInt(m[1] ?? '0', 10);
      const key = m[2] ?? '';
      if (seq > 0 && key && !answers.has(seq)) answers.set(seq, key);
    }
  }

  // 2. 逐题「N.【答案】X」块：解析文本 = 答案行之后到下一题/Part 边界
  // PDF 换行会把「68.【答案】C」粘到上一行末尾（2017 等年），先把行中嵌入的答案标记拆到行首
  const ansMarkerGlobal = /(\d{1,3})\s*[.、．]?[\s【（(]*[.、．]?\s*答案\s*】?/g;
  const expanded: string[] = [];
  for (const line of lines) {
    const cuts: number[] = [];
    for (const m of line.matchAll(ansMarkerGlobal)) {
      const idx = m.index ?? 0;
      if (idx > 0 && idx < line.length) cuts.push(idx);
    }
    if (cuts.length === 0) {
      expanded.push(line);
      continue;
    }
    let prev = 0;
    for (const c of [...cuts, line.length]) {
      expanded.push(line.slice(prev, c ?? line.length));
      prev = c ?? line.length;
    }
  }
  const partRe = /^\s*(?:Paper|Part\s+[IVX0-9])/i;
  let currentSeq = 0;
  let buffer: string[] = [];
  const flush = () => {
    if (currentSeq > 0 && buffer.length > 0) {
      const prev = explanations.get(currentSeq) ?? '';
      explanations.set(currentSeq, joinContent([...(prev ? [prev] : []), ...buffer]));
    }
    buffer = [];
  };
  for (const line of expanded) {
    const m = qStartRe.exec(line);
    if (m) {
      flush();
      currentSeq = Number.parseInt(m[1] ?? '0', 10);
      const rest = (m[2] ?? '').trim();
      // 答案字母通常紧跟「】」之后（如「A 根据前一句…」「B。」），取行首独立 A-D 字母
      const keyM = /^([A-D])(?![A-Za-z])/.exec(rest);
      if (keyM && keyM[1]) answers.set(currentSeq, keyM[1]);
      continue;
    }
    // 无题号的「【答案】X」行（2018：PDF 丢失「3.」「66.」题号）：
    // 归属为 currentSeq+1（仅当该题尚无答案时）
    const noNum = /^\s*【\s*答案\s*】\s*[:：]?\s*\(?([A-D])\)?(?![A-Za-z])/.exec(line);
    if (noNum && currentSeq > 0 && currentSeq < 75 && !answers.has(currentSeq + 1)) {
      flush();
      currentSeq += 1;
      const key = noNum[1] ?? '';
      if (key) answers.set(currentSeq, key);
      continue;
    }
    if (partRe.test(line)) {
      flush();
      currentSeq = 0;
      continue;
    }
    if (currentSeq > 0 && line.trim()) buffer.push(line.trim());
  }
  flush();

  // 3. 主观题参考答案
  const findPart = (re: RegExp): number => lines.findIndex((l) => re.test(l));
  if (oldFormat) {
    const transIdx = findPart(/^\s*Part\s+I\s+Translation/i);
    const writeIdx = findPart(/^\s*Part\s+II\s+Writing/i);
    const transLines = transIdx >= 0 ? lines.slice(transIdx + 1, writeIdx >= 0 ? writeIdx : undefined) : [];
    const secA = transLines.findIndex((l) => /^\s*Section\s+A\s*$/i.test(l));
    const secB = transLines.findIndex((l) => /^\s*Section\s+B\s*$/i.test(l));
    const refRe = /^\s*【\s*参考译文\s*】\s*$/;
    const extractRef = (from: number, to: number): string => {
      const seg = transLines.slice(from, to >= 0 ? to : undefined);
      const refAt = seg.findIndex((l) => refRe.test(l));
      return joinContent((refAt >= 0 ? seg.slice(refAt + 1) : seg).map((l) => l.trim()));
    };
    data.translationA = extractRef(secA + 1, secB);
    data.translationB = secB >= 0 ? extractRef(secB + 1, transLines.length) : '';
    data.writing = writeIdx >= 0 ? joinContent(lines.slice(writeIdx + 1).map((l) => l.trim())) : '';
  } else {
    const transIdx = findPart(/^\s*Part\s+[IVX]+\s*Translation/i);
    const writeIdx = findPart(/^\s*Part\s+[IVX]+\s*Writing/i);
    data.translationA =
      transIdx >= 0 ? joinContent(lines.slice(transIdx + 1, writeIdx >= 0 ? writeIdx : undefined).map((l) => l.trim())) : '';
    data.writing = writeIdx >= 0 ? joinContent(lines.slice(writeIdx + 1).map((l) => l.trim())) : '';
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* 解析「试题」文本                                                     */
/* ------------------------------------------------------------------ */

interface ExtractContext {
  year: number;
  oldFormat: boolean;
  solution: SolutionData;
  passages: ExamJsonFile['passages'];
  questions: RawQuestion[];
  stats: YearStats;
  passageSeq: number;
}

function pid(year: number, n: number): string {
  return `e${year}-p${n}`;
}

function qid(year: number, seq: number): string {
  return `e${year}-q${seq}`;
}

/** 加一篇文章（translation 可选：回忆版阅读文章的中英混排译文归档） */
function addPassage(ctx: ExtractContext, sectionType: SectionType, content: string, translation?: string): string {
  ctx.passageSeq += 1;
  const id = pid(ctx.year, ctx.passageSeq);
  ctx.passages.push({
    id,
    sectionType,
    order: ctx.passages.length + 1,
    content,
    ...(translation ? { translation } : {}),
  });
  return id;
}

/** 加一道题 */
function addQuestion(ctx: ExtractContext, q: Omit<RawQuestion, 'seq' | 'id'> & { seq: number }): void {
  ctx.questions.push(q);
  if (q.answerKey) ctx.stats.answersExtracted += 1;
  if (q.explanation) ctx.stats.explanationsExtracted += 1;
  if (q.referenceAnswer) ctx.stats.subjectiveRefs += 1;
}

/** 找到内容起始行：跳过 Directions 说明段（以「Answer Sheet」行结尾，容忍跨行断词） */
function skipDirectionsBlock(lines: string[], ctx: ExtractContext): string[] {
  let i = 0;
  let found = false;
  // 上限 15 行：回忆版（2023）部分区段整体没有 Directions 段，找不到时原样返回，不能吞掉整段内容
  while (i < lines.length && i < 15) {
    const t = (lines[i] ?? '').trim();
    const next = (lines[i + 1] ?? '').trim();
    i += 1;
    if (/answer\s*sheet/i.test(t)) {
      found = true;
      break;
    }
    if (/answer\s*$/i.test(t) && /^sheet/i.test(next)) {
      i += 1;
      found = true;
      break;
    }
  }
  if (!found) return lines;
  ctx.stats.ignoredLines += i;
  return lines.slice(i);
}

/** 找到内容起始行（跳过单行 Directions 说明行） */
function skipDirections(lines: string[]): string[] {
  let i = 0;
  while (i < lines.length) {
    const t = (lines[i] ?? '').trim();
    if (/^Directions/i.test(t)) {
      i += 1;
      continue;
    }
    break;
  }
  return lines.slice(i);
}

/** 把行流里内嵌的题号（如「…D. The woman can come next time. 8. Man: …」）拆到行首 */
function splitInlineNumbers(lines: string[], minSeq: number, maxSeq: number): string[] {
  const out: string[] = [];
  // lookbehind 不吃前导空格；点号后不能是数字（排除小数）；「47A.」粘连用 lookahead 兜底
  const re = /(?<=\s|^)(\d{1,3})(?:[.、．](?!\d)|(?=A\s*[.、．)）]))/g;
  let last = minSeq - 1;
  for (const line of lines) {
    let rest = line;
    let guard = 0;
    while (guard < 40) {
      guard += 1;
      let found: { index: number; n: number } | null = null;
      re.lastIndex = 0;
      for (let m = re.exec(rest); m !== null; m = re.exec(rest)) {
        const n = Number.parseInt(m[1] ?? '0', 10);
        if (n > last && n <= maxSeq) {
          found = { index: m.index, n };
          break;
        }
      }
      if (!found || found.index === 0) break;
      out.push(rest.slice(0, found.index).trim());
      rest = rest.slice(found.index).trim();
      last = found.n;
    }
    out.push(rest);
  }
  return out;
}

/* ---------------- 口语交际 ---------------- */

const SPEAKER_RE = /^[A-Za-z][A-Za-z'’]*\s*[：:]/;
/** 多字母说话人（Girl: / Interviewer:），用于区分单字母盒标记「A: B: C:」 */
const MULTI_LETTER_SPEAKER = /[A-Z][a-z][A-Za-z'’]*\s*[：:]/;
/** 空位 token：独立数字（不含时间「10:00」的冒号跟随） */
const BLANK_TOKEN = /(?<=[\s（(]|^)(\d{1,2})(?=[\s，。、）).,]|$)/g;

function blankTokenAt(line: string, n: number): RegExp {
  return new RegExp(`(?<=[\\s（(]|^)${n}(?=[\\s，。、）).,]|$)`);
}

/**
 * 对话选项盒行拆分（宽松版）：不要求从 A 开始、不要求升序，≥2 个不同 key 即拆。
 * 支持点号/括号/冒号三种标记（2021 盒用「A: … B: … C: …」冒号式）。
 */
function splitBoxLine(text: string): Option[] | null {
  const markerRe = /(?:^|[\s（(])([A-D])\s*(?:[.、．)）]|[：:])\s*/g;
  const marks: Array<{ key: string; start: number; end: number }> = [];
  for (let m = markerRe.exec(text); m !== null; m = markerRe.exec(text)) {
    marks.push({ key: m[1] ?? '', start: m.index, end: m.index + m[0].length });
  }
  if (marks.length < 2) return null;
  const opts: Option[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i];
    if (!mark) continue;
    const next = marks[i + 1];
    const segText = text.slice(mark.end, next ? next.start : text.length).trim();
    if (!segText) return null;
    opts.push({ key: mark.key, text: segText });
  }
  // key 重复说明是杂讯（如同一行里说话人 A:/B: 与盒标记混淆），放弃拆分
  const keys = new Set(opts.map((o) => o.key));
  if (keys.size !== opts.length) return null;
  return opts;
}

/** 按 key 去重追加盒选项（先到先得，防止对话行误入的重复标记污染盒） */
function pushUniqueOptions(box: Option[], opts: Option[]): void {
  for (const o of opts) {
    if (!box.some((b) => b.key === o.key)) box.push(o);
  }
}

function extractDialogue(ctx: ExtractContext, lines: string[]): void {
  const year = ctx.year;
  // 先把内嵌题号（2012 旧格式「…don't be mad. 2. A: The train…」）拆到行首
  const numbered = splitInlineNumbers(lines, 1, 10);
  const numberedStart = /^\s*(\d{1,2})\s*[.、．]\s*/;
  const numberedLineCount = numbered.filter((l) => numberedStart.test(l)).length;
  if (numberedLineCount >= 5) {
    // 旧格式（2012）：每题自带 A-D 选项，按题号切块
    const blocks = splitQuestionBlocks(numbered, 1, 10);
    for (const b of blocks) {
      const { stem, options } = parseStemAndOptions(b.lines);
      addQuestion(ctx, {
        seq: b.seq,
        sectionType: 'dialogue',
        stem,
        options,
        answerKey: ctx.solution.answers.get(b.seq) ?? null,
        referenceAnswer: null,
        explanation: ctx.solution.explanations.get(b.seq) ?? '',
        score: 1,
        passageId: null,
        blankIndex: b.seq,
      });
    }
    return;
  }

  // 新格式（2013+）：对话 + 选项盒 + 行内空位
  const groupStart = /^(Dialogue\s+\w+|Section\s+[AB])\s*$/i;
  const groups: Array<{ box: Option[]; dialogueLines: string[] }> = [];
  let current: { box: Option[]; dialogueLines: string[] } | null = null;
  for (const line of numbered) {
    const t = line.trim();
    if (groupStart.test(t)) {
      if (current) groups.push(current);
      current = { box: [], dialogueLines: [] };
      continue;
    }
    if (!current) continue;
    // ① 行首冒号式盒标记（2021 Dialogue Two「A: … B: … C: …」）：
    // 行内无多字母说话人时整行归盒；单标记行（说话人 A:/B: 对话）自动落到对话
    if (/^[A-D]\s*[：:]/.test(t) && !MULTI_LETTER_SPEAKER.test(t)) {
      const opts = splitBoxLine(t);
      if (opts) {
        pushUniqueOptions(current.box, opts);
        continue;
      }
    }
    // ② 行内「选项盒 + 后续对话」粘连（2015 Section B / 2019 Dialogue Two 等）：
    // 在第一个说话人冒号处切开，前半归盒、后半归对话
    if (!SPEAKER_RE.test(t)) {
      const mSpeaker = /(?<![A-Za-z])[A-Z][A-Za-z'’]*\s*[：:]\s/.exec(t);
      if (mSpeaker && mSpeaker.index > 0) {
        const boxPart = t.slice(0, mSpeaker.index).trim();
        const talkPart = t.slice(mSpeaker.index).trim();
        const strict = splitOptionsFrom(boxPart);
        const boxOpts = strict && strict.stem === '' ? strict.options : splitBoxLine(boxPart);
        if (boxOpts) {
          pushUniqueOptions(current.box, boxOpts);
          if (talkPart) current.dialogueLines.push(talkPart);
          continue;
        }
      }
    }
    // ③ 选项盒行：纯选项（组行或单行），不含说话人冒号；盒可能出现在对话之后
    if (!SPEAKER_RE.test(t)) {
      const parsed = splitOptionsFrom(t);
      if (parsed && parsed.stem === '') {
        pushUniqueOptions(current.box, parsed.options);
        continue;
      }
      // 两选项同行（2015：A. … B. …）：splitOptionsFrom 要求 ≥3，这里用宽松拆分兜底
      const boxOpts = splitBoxLine(t);
      if (boxOpts) {
        pushUniqueOptions(current.box, boxOpts);
        continue;
      }
      // Directions 行尾粘连的盒选项（2022 Section B：…Answer sheet. A. …）：
      // 仅当盒中还没有 A 且行内有「 A. 」标记时，从标记处起截取归盒（标记前的 Directions 杂讯丢弃）
      if (!current.box.some((b) => b.key === 'A')) {
        const midMark = /(?:[\s(（.．、])A\s*[.、．)）]/.exec(t);
        if (midMark && (midMark.index ?? 0) > 0) {
          const boxPart = t.slice(midMark.index + 1).trim();
          const singleMid = /^([A-D])\s*[.、．)）]\s*(.+)$/.exec(boxPart);
          if (singleMid) {
            current.box.push({ key: singleMid[1] ?? '', text: (singleMid[2] ?? '').trim() });
            continue;
          }
        }
      }
      const single = /^([A-D])\s*[.、．)）]\s*(.+)$/.exec(t);
      if (single) {
        const raw = single[2] ?? '';
        const mSpk = /\s+[A-Za-z][A-Za-z'’]*\s*[：:]\s/.exec(raw);
        const text = (mSpk ? raw.slice(0, mSpk.index) : raw).trim();
        if (text) {
          current.box.push({ key: single[1] ?? '', text });
          // 选项后粘连的对话内容不能丢（2016/2018：D.… Interviewer: … 7）
          const talkPart = mSpk ? raw.slice(mSpk.index).trim() : '';
          if (talkPart) current.dialogueLines.push(talkPart);
          continue;
        }
      }
    }
    current.dialogueLines.push(t);
  }
  if (current) groups.push(current);
  for (const g of groups) g.box.sort((a, b) => a.key.localeCompare(b.key));

  // 收集全部空位候选（按原文出现顺序），再按 k=1..10 顺序认领：
  // - 「强」候选：紧邻标点（前为标点或后为标点/行尾）——真实空位特征（"Winfrey: 9"、"Clinton, 7 Thank"）
  // - 「弱」候选：两侧都是字母/空格——多为正文数字（"at 10 o'clock"），仅在无强候选时兜底
  // - 按 k 递增且位置严格递增认领，某空原文缺失时跳过（不硬凑），后续空位仍可恢复
  type BlankCand = { n: number; groupIdx: number; line: string; strong: boolean };
  const cands: BlankCand[] = [];
  groups.forEach((g, gi) => {
    for (const line of g.dialogueLines) {
      for (const m of line.matchAll(BLANK_TOKEN)) {
        const n = Number.parseInt(m[1] ?? '0', 10);
        if (!(n >= 1 && n <= 10)) continue;
        const idx = m.index ?? 0;
        const before = line.slice(0, idx);
        const after = line.slice(idx + m[0].length);
        const strong =
          /[，。、,.:：;；)）！？!?]\s*$/.test(before) ||
          /^\s*[，。、).,]/.test(after) ||
          after.trim() === '';
        cands.push({ n, groupIdx: gi, line, strong });
      }
    }
  });
  let ci = 0;
  for (let k = 1; k <= 10; k++) {
    let firstIdx = -1;
    let strongIdx = -1;
    for (let i = ci; i < cands.length; i++) {
      const c = cands[i];
      if (!c || c.n !== k) continue;
      if (firstIdx === -1) firstIdx = i;
      if (c.strong) {
        strongIdx = i;
        break;
      }
    }
    const pick = strongIdx !== -1 ? strongIdx : firstIdx;
    if (pick === -1) continue; // 该空在原文中缺失，保持缺失
    const c = cands[pick];
    if (!c) continue;
    ci = pick + 1;
    const g = groups[c.groupIdx];
    if (!g) continue;
    const stem = c.line.replace(blankTokenAt(c.line, c.n), ' ____ ');
    addQuestion(ctx, {
      seq: c.n,
      sectionType: 'dialogue',
      stem: `（第 ${c.n} 空）${stem}`,
      options: g.box,
      answerKey: ctx.solution.answers.get(c.n) ?? null,
      referenceAnswer: null,
      explanation: ctx.solution.explanations.get(c.n) ?? '',
      score: 1,
      passageId: null,
      blankIndex: c.n,
    });
  }
  void year;
}

/* ---------------- 词汇 ---------------- */

function extractVocabulary(ctx: ExtractContext, lines: string[], minSeq: number, maxSeq: number, score: number): void {
  const numbered = splitInlineNumbers(lines, minSeq, maxSeq);
  const blocks = splitQuestionBlocks(numbered, minSeq, maxSeq);
  for (const b of blocks) {
    const { stem, options } = parseStemAndOptions(b.lines);
    addQuestion(ctx, {
      seq: b.seq,
      sectionType: 'vocabulary',
      stem,
      options,
      answerKey: ctx.solution.answers.get(b.seq) ?? null,
      referenceAnswer: null,
      explanation: ctx.solution.explanations.get(b.seq) ?? '',
      score,
      passageId: null,
      blankIndex: null,
    });
  }
}

/* ---------------- 阅读理解 ---------------- */

/** extractReading 回忆版选项 */
interface ExtractReadingOptions {
  /** 中文主导行从文章正文剥离、按文章归入 passage.translation（2023 中英混排） */
  cjkAsTranslation?: boolean;
  /** 题号行容忍逗号（2024 Q37「37,Previous…」PDF 文本层变体） */
  allowCommaSeq?: boolean;
}

function extractReading(
  ctx: ExtractContext,
  lines: string[],
  minSeq: number,
  maxSeq: number,
  opts: ExtractReadingOptions = {},
): void {
  const passageHead = /^\s*Passage\s+(One|Two|Three|Four|Five|Six|\d+)\s*$/i;
  const qStartRe = opts.allowCommaSeq
    ? /^\s*(\d{1,3})\s*[.、．,，]\s*/
    : /^\s*(\d{1,3})\s*[.、．]\s*/;
  const numbered = splitInlineNumbers(lines, minSeq, maxSeq);
  const body = skipDirectionsBlock(numbered, ctx);

  // 切文章：Passage N 标题 → 正文直到第一个题号行
  interface PassageGroup {
    content: string[];
    translation: string[];
    questions: Array<{ seq: number; lines: string[] }>;
  }
  const groups: PassageGroup[] = [];
  let current: PassageGroup | null = null;
  let firstQuestionSeen = false;
  for (const line of body) {
    const t = line.trim();
    if (passageHead.test(t)) {
      current = { content: [], translation: [], questions: [] };
      groups.push(current);
      firstQuestionSeen = false;
      continue;
    }
    if (/^Section\s+[AB]\s*$/i.test(t)) {
      // Section B（博客+评论）没有 Passage 标题 → 先不开新组，让第一段正文兜底
      if (current && current.questions.length > 0) current = null;
      continue;
    }
    if (!current) {
      current = { content: [], translation: [], questions: [] };
      groups.push(current);
      firstQuestionSeen = false;
    }
    const m = qStartRe.exec(t);
    if (m) {
      const n = Number.parseInt(m[1] ?? '0', 10);
      if (n >= minSeq && n <= maxSeq) {
        firstQuestionSeen = true;
        current.questions.push({ seq: n, lines: [t.replace(qStartRe, '')] });
        continue;
      }
    }
    if (firstQuestionSeen) {
      const q = current.questions[current.questions.length - 1];
      if (q) q.lines.push(t);
    } else {
      if (!t || /^Directions/i.test(t)) {
        ctx.stats.ignoredLines += 1;
      } else if (opts.cjkAsTranslation && isCjkDominant(t)) {
        current.translation.push(t);
      } else {
        current.content.push(t);
      }
    }
  }

  for (const g of groups) {
    const content = joinContent(g.content);
    const translation = joinContent(g.translation);
    const passageId = content ? addPassage(ctx, 'reading', content, translation || undefined) : null;
    for (const q of g.questions) {
      const { stem, options } = parseStemAndOptions(q.lines);
      addQuestion(ctx, {
        seq: q.seq,
        sectionType: 'reading',
        stem,
        options,
        answerKey: ctx.solution.answers.get(q.seq) ?? null,
        referenceAnswer: null,
        explanation: ctx.solution.explanations.get(q.seq) ?? '',
        score: 1,
        passageId,
        blankIndex: null,
      });
    }
  }
}

/* ---------------- 完形填空 ---------------- */

function extractCloze(ctx: ExtractContext, lines: string[], minSeq: number, maxSeq: number): void {
  // 「46.A. on」与「47A. possible」两种粘连都容忍（点号可省略）
  const optionLine = /^\s*(\d{1,3})\s*[.、．]?\s*A\s*[.、．)）]\s*/;
  const numbered = splitInlineNumbers(lines, minSeq, maxSeq);
  const body = skipDirectionsBlock(numbered, ctx);
  const contentLines: string[] = [];
  const questionBlocks: Array<{ seq: number; lines: string[] }> = [];
  let current: { seq: number; lines: string[] } | null = null;
  for (const line of body) {
    const t = line.trim();
    const m = optionLine.exec(t);
    if (m) {
      const n = Number.parseInt(m[1] ?? '0', 10);
      if (n >= minSeq && n <= maxSeq) {
        // 「47A. possible」数字与 A 粘连：补空格让 A 标记可被识别（「47 A. possible」）
        const normalized = t.replace(/^(\d{1,3})\s*[.、．]?\s*(A\s*[.、．)）]\s*)/, '$1 $2');
        current = { seq: n, lines: [normalized] };
        questionBlocks.push(current);
        continue;
      }
    }
    if (current) {
      const mm = /^\s*(\d{1,3})\s*[.、．]\s*/.exec(t);
      if (mm) {
        const n = Number.parseInt(mm[1] ?? '0', 10);
        if (n === current.seq + 1 && n <= maxSeq) {
          current = { seq: n, lines: [t] };
          questionBlocks.push(current);
          continue;
        }
      }
      current.lines.push(t);
    } else if (t) {
      contentLines.push(t);
    }
  }

  const passageId = addPassage(ctx, 'cloze', joinContent(contentLines));
  for (const b of questionBlocks) {
    // 保留原始行（含「46. A. …」），让 parseStemAndOptions 能找到 A-D 完整序列
    const parsed = parseStemAndOptions(b.lines);
    const options = parsed.options.length >= 2 ? parsed.options : (splitOptionsLoose(parsed.stem) ?? parsed.options);
    addQuestion(ctx, {
      seq: b.seq,
      sectionType: 'cloze',
      stem: `（完形第 ${b.seq} 空）`,
      options,
      answerKey: ctx.solution.answers.get(b.seq) ?? null,
      referenceAnswer: null,
      explanation: ctx.solution.explanations.get(b.seq) ?? '',
      score: 1,
      passageId,
      blankIndex: b.seq,
    });
  }
}

/* ---------------- 短文完成（仅新格式） ---------------- */

function extractShortCompletion(ctx: ExtractContext, lines: string[]): void {
  const minSeq = 56;
  const maxSeq = 75;
  const textHead = /^\s*Text\s+(One|Two|Three|Four|\d+)\s*$/i;
  const body = skipDirectionsBlock(lines, ctx);

  interface TextGroup {
    box: Option[];
    phraseLines: string[];
    bodyLines: string[];
  }
  const groups: TextGroup[] = [];
  let current: TextGroup | null = null;
  let inPhrases = false;
  let inBody = false;
  for (const line of body) {
    const t = line.trim();
    if (textHead.test(t)) {
      current = { box: [], phraseLines: [], bodyLines: [] };
      groups.push(current);
      inPhrases = false;
      inBody = false;
      continue;
    }
    if (!current) continue;
    if (/^Phrases\s*[:：]?\s*$/i.test(t)) {
      inPhrases = true;
      continue;
    }
    if (inBody) {
      current.bodyLines.push(t);
      continue;
    }
    if (inPhrases) {
      // 短语行以选项标记开头；首个非标记行即正文开始
      if (/^[A-D]\s*[.、．)）]/.test(t)) {
        current.phraseLines.push(t);
      } else if (t) {
        inBody = true;
        current.bodyLines.push(t);
      }
      continue;
    }
    const parsed = splitOptionsFrom(t);
    if (parsed && parsed.stem === '') {
      current.box.push(...parsed.options);
      continue;
    }
    const single = /^([A-D])\s*[.、．)）]\s*(.+)$/.exec(t);
    if (single) {
      current.box.push({ key: single[1] ?? '', text: (single[2] ?? '').trim() });
      continue;
    }
    current.bodyLines.push(t);
    inBody = true;
  }

  // 找空位 → 题
  const claimed = new Set<number>();
  const pushQuestion = (n: number, stem: string, passageId: string | null, box: Option[]): void => {
    if (claimed.has(n)) return;
    claimed.add(n);
    // 本组盒为空时兜底取第一个非空盒（不静默丢选项）
    const options = box.length > 0 ? box : (groups.find((g) => g.box.length > 0)?.box ?? []);
    addQuestion(ctx, {
      seq: n,
      sectionType: 'short-completion',
      stem,
      options,
      answerKey: ctx.solution.answers.get(n) ?? null,
      referenceAnswer: null,
      explanation: ctx.solution.explanations.get(n) ?? '',
      score: 1,
      passageId,
      blankIndex: n,
    });
  };

  // 每组先落文章（box + Phrases + 正文）
  const passageIds = groups.map((g) =>
    addPassage(
      ctx,
      'short-completion',
      joinContent([...g.box.map((o) => `${o.key}. ${o.text}`), 'Phrases:', ...g.phraseLines, '', ...g.bodyLines]),
    ),
  );

  // 全局按序认领空位（与 extractDialogue 同策略）：
  // 候选按文档顺序（各组短语行 → 正文行）收集，k=56..75 递增、位置游标单调前进。
  // 这样正文里的内容数字（如 2023 短语行「58 from 73 different sources」中的 73）
  // 即使落在 [56,75] 区间，也会因「位置已被真空位越过」而被跳过，不再挤占后续空位。
  interface BlankCand {
    n: number;
    groupIdx: number;
    /** 短语行为该行原文；正文行为拼接后的正文（取窗口用） */
    line: string;
    strong: boolean;
    inBody: boolean;
  }
  const cands: BlankCand[] = [];
  const collect = (line: string, groupIdx: number, inBody: boolean): void => {
    for (const m of line.matchAll(BLANK_TOKEN)) {
      const n = Number.parseInt(m[1] ?? '0', 10);
      if (!(n >= minSeq && n <= maxSeq)) continue;
      const idx = m.index ?? 0;
      const before = line.slice(0, idx);
      const after = line.slice(idx + m[0].length);
      const strong =
        /[，。、,.:：;；)）！？!?]\s*$/.test(before) || /^\s*[，。、).,]/.test(after) || after.trim() === '';
      cands.push({ n, groupIdx, line, strong, inBody });
    }
  };
  groups.forEach((g, gi) => {
    for (const line of g.phraseLines) collect(line, gi, false);
    collect(g.bodyLines.join(' '), gi, true);
  });

  let ci = 0;
  for (let k = minSeq; k <= maxSeq; k++) {
    let firstIdx = -1;
    let strongIdx = -1;
    for (let i = ci; i < cands.length; i++) {
      const c = cands[i];
      if (!c || c.n !== k) continue;
      if (firstIdx === -1) firstIdx = i;
      if (c.strong) {
        strongIdx = i;
        break;
      }
    }
    const pick = strongIdx !== -1 ? strongIdx : firstIdx;
    if (pick === -1) continue; // 该空在原文中缺失，保持缺失
    const c = cands[pick];
    if (!c) continue;
    ci = pick + 1;
    const g = groups[c.groupIdx];
    if (!g) continue;
    const passageId = passageIds[c.groupIdx] ?? null;
    if (c.inBody) {
      // 正文空位：取空位前后窗口作题干
      const idx = blankTokenIndex(c.line, k);
      const from = Math.max(0, idx - 80);
      const to = Math.min(c.line.length, idx + 90);
      const window = (from > 0 ? '…' : '') + c.line.slice(from, to).trim() + (to < c.line.length ? '…' : '');
      pushQuestion(k, `（第 ${k} 空）${window.replace(blankTokenAt(window, k), ' ____ ')}`, passageId, g.box);
    } else {
      const stem = c.line.replace(blankTokenAt(c.line, k), ' ____ ');
      pushQuestion(k, `（第 ${k} 空）${stem}`, passageId, g.box);
    }
  }
}

/** 空位 token 在行中的位置（找不到返回 -1） */
function blankTokenIndex(line: string, n: number): number {
  const m = blankTokenAt(line, n).exec(line);
  return m ? (m.index ?? -1) : -1;
}

/* ---------------- 英译汉 / 写作 ---------------- */

/** 去掉段落开头的 Directions 说明（到「Answer Sheet.」为止） */
function stripDirectionsPrefix(text: string): string {
  return text.replace(/^Directions[\s\S]*?answer\s*sheet\.\s*/i, '');
}

function extractTranslationNew(ctx: ExtractContext, lines: string[]): void {
  const seq = 76;
  const content = stripDirectionsPrefix(joinContent(lines.filter((l) => !/^\s*Section\s+[AB]\s*$/i.test(l.trim()))));
  addQuestion(ctx, {
    seq,
    sectionType: 'translation',
    stem: `将下面短文译成汉语：\n${content}`,
    options: [],
    answerKey: null,
    referenceAnswer: ctx.solution.translationA || null,
    explanation: '',
    score: 10,
    passageId: null,
    blankIndex: null,
  });
}

function extractTranslationOld(ctx: ExtractContext, lines: string[]): void {
  // Section A：英译汉（10 分）；Section B：汉译英（10 分）
  const secBIdx = lines.findIndex((l) => /^\s*Section\s+B\s*$/i.test(l.trim()));
  const secA = lines.slice(0, secBIdx >= 0 ? secBIdx : undefined);
  const secB = secBIdx >= 0 ? lines.slice(secBIdx + 1) : [];
  const clean = (ls: string[]): string =>
    stripDirectionsPrefix(joinContent(ls.filter((l) => !/^\s*Section\s+[AB]\s*$/i.test(l.trim()))));
  addQuestion(ctx, {
    seq: 76,
    sectionType: 'translation',
    stem: `将下面短文译成汉语：\n${clean(secA)}`,
    options: [],
    answerKey: null,
    referenceAnswer: ctx.solution.translationA || null,
    explanation: '',
    score: 10,
    passageId: null,
    blankIndex: null,
  });
  addQuestion(ctx, {
    seq: 77,
    sectionType: 'translation',
    stem: `将下面短文译成英语：\n${clean(secB)}`,
    options: [],
    answerKey: null,
    referenceAnswer: ctx.solution.translationB || null,
    explanation: '',
    score: 10,
    passageId: null,
    blankIndex: null,
  });
}

function extractWriting(ctx: ExtractContext, lines: string[], seq: number): void {
  // 写作题干保留 Directions（含题目与提纲）
  const content = joinContent(lines.filter((l) => !/^\s*Section\s+[AB]\s*$/i.test(l.trim())));
  addQuestion(ctx, {
    seq,
    sectionType: 'writing',
    stem: content,
    options: [],
    answerKey: null,
    referenceAnswer: ctx.solution.writing || null,
    explanation: '',
    score: 15,
    passageId: null,
    blankIndex: null,
  });
}

/* ---------------- 回忆版：英译汉 / 写作（参考答案内嵌） ---------------- */

/** 回忆版英译汉：题干英文段 + 内嵌中文参考译文（「参考译文：」标记或中文主导行） */
function extractTranslationRecalled(ctx: ExtractContext, lines: string[]): void {
  const cleaned = lines.filter((l) => !/^\s*Section\s+[AB]\s*$/i.test(l.trim()));
  const { stem, reference } = splitReferenceAnswer(joinContent(cleaned));
  addQuestion(ctx, {
    seq: 76,
    sectionType: 'translation',
    stem: `将下面短文译成汉语：\n${stripDirectionsPrefix(stem)}`,
    options: [],
    answerKey: null,
    referenceAnswer: reference || null,
    explanation: '',
    score: 10,
    passageId: null,
    blankIndex: null,
  });
}

/** 回忆版写作：题干 + 内嵌范文（「参考范文：」「范文N：」标记；无范文时参考为 null） */
function extractWritingRecalled(ctx: ExtractContext, lines: string[], seq: number): void {
  const content = joinContent(lines.filter((l) => !/^\s*Section\s+[AB]\s*$/i.test(l.trim())));
  const { stem, reference } = splitReferenceAnswer(content);
  addQuestion(ctx, {
    seq,
    sectionType: 'writing',
    stem,
    options: [],
    answerKey: null,
    referenceAnswer: reference || null,
    explanation: '',
    score: 15,
    passageId: null,
    blankIndex: null,
  });
}

/* ------------------------------------------------------------------ */
/* 回忆版整卷组装（2023-2026）                                          */
/* ------------------------------------------------------------------ */

/**
 * 解析一份回忆版试卷（2023-2026）。
 *
 * 与标准管线的差异：
 * - 无独立解析 PDF：答案从试题文本内嵌标记中提取（序列式「参考答案：BCA」/
 *   空位内嵌式「1B」「56A」），填入 solution.answers 后复用既有提取器；
 * - 词汇/阅读/完形答案在回忆版源文本中整体缺失（客观题 11-55），如实置 null 并入报告；
 * - 主观题参考答案按「参考译文：」「范文：」标记从题干中拆分。
 */
function buildRecalledYear(year: number): YearPaper {
  const directionFix = { reversed: 0, total: 0 };
  let lines = loadRecalledYearText(year, directionFix).split('\n');
  if (year === 2023) lines = injectDialogueHeader2023(lines);

  const answers = new Map<number, string>();
  const solution: SolutionData = {
    answers,
    explanations: new Map<number, string>(),
    translationA: '',
    translationB: '',
    writing: '',
  };
  const stats: YearStats = {
    expectedSections: 7,
    expectedQuestions: 77,
    expectedAnswers: 75,
    identifiedSections: 0,
    questions: 0,
    answersExtracted: 0,
    explanationsExtracted: 0,
    subjectiveRefs: 0,
    ignoredLines: 0,
    unresolvedLines: 0,
    unresolvedSamples: [],
  };
  const ctx: ExtractContext = {
    year,
    oldFormat: false,
    solution,
    passages: [],
    questions: [],
    stats,
    passageSeq: 0,
  };

  const spans = cutSections(lines);
  stats.identifiedSections = spans.length;

  for (const span of spans) {
    switch (span.type) {
      case 'dialogue': {
        // ① 序列式（2023「参考答案：BCA」）② 空位内嵌式（2024/2025「1B」）
        const seqRes = extractAnswerSequences(span.lines, 1);
        for (const [k, v] of seqRes.answers) if (!answers.has(k)) answers.set(k, v);
        const tokRes = stripInlineAnswerLetters(seqRes.lines, 1, 10);
        for (const [k, v] of tokRes.answers) if (!answers.has(k)) answers.set(k, v);
        extractDialogue(ctx, tokRes.lines);
        break;
      }
      case 'vocabulary':
        extractVocabulary(ctx, span.lines, 11, 20, 1);
        break;
      case 'reading':
        extractReading(ctx, span.lines, 21, 45, {
          cjkAsTranslation: year === 2023,
          allowCommaSeq: true,
        });
        break;
      case 'cloze':
        extractCloze(ctx, span.lines, 46, 55);
        break;
      case 'short-completion': {
        const tokRes = stripInlineAnswerLetters(span.lines, 56, 75);
        for (const [k, v] of tokRes.answers) if (!answers.has(k)) answers.set(k, v);
        extractShortCompletion(ctx, tokRes.lines);
        break;
      }
      case 'translation':
        extractTranslationRecalled(ctx, span.lines);
        break;
      case 'writing':
        extractWritingRecalled(ctx, span.lines, 77);
        break;
      default:
        break;
    }
  }

  stats.questions = ctx.questions.length;

  // 回忆版混排残片（2026）：空题干题无内容价值，丢弃并计数（避免校验硬失败）
  const beforeDrop = ctx.questions.length;
  ctx.questions = ctx.questions.filter((q) => q.stem.trim().length > 0);
  if (ctx.questions.length < beforeDrop) {
    stats.droppedEmptyStems = beforeDrop - ctx.questions.length;
  }

  // 回忆版源卷题号笔误修复（如 2025 阅读第二个「25.」实为 26 的 OCR 误写）：
  // 仅当题号相对前题「倒退/重复」时按顺序重编号；真实缺题造成的断档保持原样（由校验警告）。
  const renumberedSeqs: Array<{ from: number; to: number }> = [];
  let expected = 1;
  for (const q of ctx.questions) {
    if (q.seq < expected) {
      renumberedSeqs.push({ from: q.seq, to: expected });
      q.seq = expected;
    }
    expected = Math.max(expected, q.seq) + 1;
  }
  if (renumberedSeqs.length > 0) stats.renumberedSeqs = renumberedSeqs;
  if (directionFix.total > 0) stats.directionFixed = directionFix;

  const unresolved = ctx.questions.filter((q) => !q.stem || (!q.answerKey && !q.referenceAnswer));
  stats.unresolvedLines = unresolved.length;
  stats.unresolvedSamples = unresolved.slice(0, 5).map((q) => `seq=${q.seq} ${q.stem.slice(0, 40)}`);

  return { year, sections: newFormatSections(), passages: ctx.passages, questions: ctx.questions, stats };
}

/* ------------------------------------------------------------------ */
/* 整卷组装                                                            */
/* ------------------------------------------------------------------ */

/** 区段标题匹配（脚本本地轻量版：只认 Part/短中文标题行，防正文误命中） */
function sectionTypeOf(line: string): SectionType | null {
  const t = line.trim();
  if (/^part\s+[ivx0-9ⅠⅡⅢⅣⅤⅥⅦⅰⅱⅲⅳⅴⅵⅶ]/i.test(t)) {
    if (/Translation/i.test(t)) return 'translation';
    if (/Writing|Composition/i.test(t)) return 'writing';
    if (/Vocabulary/i.test(t)) return 'vocabulary';
    if (/Reading/i.test(t)) return 'reading';
    if (/Cloze/i.test(t)) return 'cloze';
    if (/Text\s*Completion|Blank\s*Filling|Short\s*Answer/i.test(t)) return 'short-completion';
    if (/Dialogue|Oral/i.test(t)) return 'dialogue';
    // 裸 Part 序号兜底
    if (/^part\s*[Ⅰ1]/i.test(t)) return 'dialogue';
    if (/^part\s*[Ⅱ2]/i.test(t)) return 'vocabulary';
    if (/^part\s*[Ⅲ3]/i.test(t)) return 'reading';
    if (/^part\s*[Ⅳ4]/i.test(t)) return 'cloze';
    if (/^part\s*[Ⅴ5]/i.test(t)) return 'short-completion';
    if (/^part\s*[Ⅵ6]/i.test(t)) return 'translation';
    if (/^part\s*[Ⅶ7]/i.test(t)) return 'writing';
    return null;
  }
  // 回忆版（2023）：「二、词汇题」式中文序号标题（注意源卷写作「完型填空」）
  const zhNum = /^([一二三四五六七八])、\s*(\S{0,12})$/.exec(t);
  if (zhNum) {
    const label = zhNum[2] ?? '';
    if (/口语|交际/.test(label)) return 'dialogue';
    if (/词汇/.test(label)) return 'vocabulary';
    if (/阅读/.test(label)) return 'reading';
    if (/完[形型]/.test(label)) return 'cloze';
    if (/短文完成/.test(label)) return 'short-completion';
    if (/翻译|英译汉/.test(label)) return 'translation';
    if (/写作/.test(label)) return 'writing';
  }
  // 纯中文短标题（如「口语交际」「词汇」）
  if (t.length <= 20) {
    if (/口语交际|^口语$/.test(t)) return 'dialogue';
    if (/^词汇$/.test(t)) return 'vocabulary';
    if (/阅读理解/.test(t)) return 'reading';
    if (/完形填空/.test(t)) return 'cloze';
    if (/短文完成/.test(t)) return 'short-completion';
    if (/英译汉|^翻译$/.test(t)) return 'translation';
    if (/^写作$/.test(t)) return 'writing';
  }
  return null;
}

/** 把整卷行流按区段切开（保序） */
function cutSections(lines: string[]): Array<{ type: SectionType; titleLineNo: number; lines: string[] }> {
  const spans: Array<{ type: SectionType; titleLineNo: number; lines: string[] }> = [];
  let current: { type: SectionType; titleLineNo: number; lines: string[] } | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const type = sectionTypeOf(line);
    if (type && line.trim().length <= 90) {
      current = { type, titleLineNo: i + 1, lines: [] };
      spans.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return spans;
}

/** 解析一份试卷 */
function buildYear(year: number): YearPaper {
  const oldFormat = year === 2012;
  const examText = loadYearText(year, 'exam');
  const solText = loadYearText(year, 'sol');
  const solution = parseSolution(solText, oldFormat);

  const stats: YearStats = {
    expectedSections: oldFormat ? 6 : 7,
    expectedQuestions: oldFormat ? 78 : 77,
    expectedAnswers: oldFormat ? 75 : 75,
    identifiedSections: 0,
    questions: 0,
    answersExtracted: 0,
    explanationsExtracted: 0,
    subjectiveRefs: 0,
    ignoredLines: 0,
    unresolvedLines: 0,
    unresolvedSamples: [],
  };

  const ctx: ExtractContext = {
    year,
    oldFormat,
    solution,
    passages: [],
    questions: [],
    stats,
    passageSeq: 0,
  };

  const spans = cutSections(examText.split('\n'));
  stats.identifiedSections = spans.length;

  // 各区段行流里的 Section A/B / Dialogue One 边界已经由各自的提取器处理
  for (const span of spans) {
    const lines = span.lines;
    switch (span.type) {
      case 'dialogue':
        extractDialogue(ctx, lines);
        break;
      case 'vocabulary':
        extractVocabulary(ctx, lines, 11, oldFormat ? 30 : 20, oldFormat ? 0.5 : 1);
        break;
      case 'reading':
        extractReading(ctx, lines, oldFormat ? 31 : 21, oldFormat ? 60 : 45);
        break;
      case 'cloze':
        extractCloze(ctx, lines, oldFormat ? 61 : 46, oldFormat ? 75 : 55);
        break;
      case 'short-completion':
        if (!oldFormat) extractShortCompletion(ctx, lines);
        break;
      case 'translation':
        if (oldFormat) extractTranslationOld(ctx, lines);
        else extractTranslationNew(ctx, lines);
        break;
      case 'writing':
        extractWriting(ctx, lines, oldFormat ? 78 : 77);
        break;
      default:
        break;
    }
  }

  stats.questions = ctx.questions.length;
  const unresolved = ctx.questions.filter((q) => !q.stem || (!q.answerKey && !q.referenceAnswer));
  stats.unresolvedLines = unresolved.length;
  stats.unresolvedSamples = unresolved.slice(0, 5).map((q) => `seq=${q.seq} ${q.stem.slice(0, 40)}`);

  const specs = oldFormat ? oldFormatSections() : newFormatSections();
  // 用实际题量校准 section.questionCount 的展示（保持规格声明的题量，由报告核对实际值）
  return { year, sections: specs, passages: ctx.passages, questions: ctx.questions, stats };
}

/* ------------------------------------------------------------------ */
/* JSON 组装 + 校验                                                    */
/* ------------------------------------------------------------------ */

function toExamJson(paper: YearPaper): ExamJsonFile {
  const questions: ExamJsonFile['questions'] = paper.questions.map((q) => ({
    id: qid(paper.year, q.seq),
    sectionType: q.sectionType,
    passageId: q.passageId,
    seq: q.seq,
    stem: q.stem,
    blankIndex: q.blankIndex,
    options: q.options,
    answerKey: q.answerKey,
    referenceAnswer: q.referenceAnswer,
    explanation: q.explanation,
    score: q.score,
  }));
  return {
    schemaVersion: 1,
    paper: {
      title: `${paper.year} 年同等学力人员申请硕士学位英语水平全国统一考试试题${paper.year >= 2023 ? '（回忆版）' : ''}`,
      timeLimitSec: 9000,
      totalScore: paper.sections.reduce((s, x) => s + x.score, 0),
      sections: paper.sections,
    },
    passages: paper.passages,
    questions,
  };
}

/* ------------------------------------------------------------------ */
/* fixture 渲染（2013，77 题整卷纯文本）                                */
/* ------------------------------------------------------------------ */

function renderFixture(paper: YearPaper): string {
  const out: string[] = [];
  out.push(`${paper.year} 年同等学力人员申请硕士学位英语水平全国统一考试试题`);
  out.push('');
  const specOrder = new Map(paper.sections.map((s) => [s.type, s]));
  let romanIdx = 0;
  const emittedPassages = new Set<string>();

  for (const spec of paper.sections) {
    const qs = paper.questions.filter((q) => q.sectionType === spec.type).sort((a, b) => a.seq - b.seq);
    if (qs.length === 0) continue;
    out.push(`${ROMAN[romanIdx] ?? ''} ${nameOf(spec.type)}（${spec.score} 分）`);
    romanIdx += 1;
    out.push('');
    for (const q of qs) {
      // 文章在题组前输出一次
      if (q.passageId && !emittedPassages.has(q.passageId)) {
        emittedPassages.add(q.passageId);
        const p = paper.passages.find((x) => x.id === q.passageId);
        if (p) {
          out.push(`Passage ${p.order}`);
          out.push(p.content);
          out.push('');
        }
      }
      out.push(`${q.seq}. ${q.stem.replace(/\n+/g, ' ')}`);
      for (const o of q.options) {
        out.push(`${o.key}. ${o.text}`);
      }
      if (q.answerKey) {
        out.push(`【答案】${q.answerKey}`);
      } else if (q.referenceAnswer) {
        out.push(`【答案】${q.referenceAnswer.replace(/\n+/g, ' ')}`);
      }
      if (q.explanation) {
        out.push(`【解析】${q.explanation.replace(/\n+/g, ' ')}`);
      }
      out.push('');
    }
  }
  void specOrder;
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function nameOf(type: SectionType): string {
  const names: Record<SectionType, string> = {
    dialogue: '口语交际',
    vocabulary: '词汇',
    reading: '阅读理解',
    cloze: '完形填空',
    'short-completion': '短文完成',
    translation: '英译汉',
    writing: '写作',
  };
  return names[type];
}

/* ------------------------------------------------------------------ */
/* 报告                                                                */
/* ------------------------------------------------------------------ */

function renderReport(results: Array<{ paper: YearPaper; json: ExamJsonFile; errors: string[]; warnings: string[] }>): string {
  const lines: string[] = [];
  lines.push('# 11 年真题解析管线质量报告');
  lines.push('');
  lines.push('> 由 `npx vite-node --script scripts/build_exams.ts` 生成，可重复执行（幂等，产物字节级一致）。');
  lines.push('> 注意必须带 `--script`：vite-node 默认模式下 `process.argv[1]` 指向自身运行器，主流程守卫不会触发。');
  lines.push('');
  lines.push('## 数据源说明');
  lines.push('');
  lines.push('- 真题/解析源：`C:/Users/12132/Desktop/英语/{真题,解析}/*.pdf`（共 22 份，自带文本层）。');
  lines.push('- `data-raw/ocr/all_pages.json` 是大纲词汇表的 OCR 结果（223 页），与真题无关；');
  lines.push('  管线直接用 `scripts/extract_pdf_text.py` 抽取 PDF 文本层，无需 OCR。');
  lines.push('- 页眉页脚（「有志者事竟成」口号行 + 纯页码行）在规范化阶段剔除。');
  lines.push('');
  lines.push('## 每卷质量指标');
  lines.push('');
  lines.push('| 年份 | 格式 | 区段识别 | 题量 | 客观题答案 | 逐题解析 | 主观参考 | examJson | 错误/警告 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const { paper, json, errors, warnings } of results) {
    const s = paper.stats;
    const ok = errors.length === 0 ? '✅ 通过' : '❌ 失败';
    // 旧格式（2012）主观题为翻译 2 篇 + 写作 1 篇 = 3 项参考
    const refDenom = paper.year === 2012 ? 3 : 2;
    lines.push(
      `| ${paper.year} | ${paper.year === 2012 ? '旧' : '新'} | ${s.identifiedSections}/${s.expectedSections} | ${s.questions}/${s.expectedQuestions} | ${s.answersExtracted}/${s.expectedAnswers} | ${s.explanationsExtracted} | ${s.subjectiveRefs}/${refDenom} | ${ok} | ${errors.length}/${warnings.length} |`,
    );
  }
  lines.push('');
  lines.push('## JSON 校验明细');
  lines.push('');
  for (const { paper, errors, warnings } of results) {
    lines.push(`### ${paper.year}`);
    lines.push('');
    if (errors.length === 0 && warnings.length === 0) {
      lines.push('- 无错误、无警告。');
    }
    for (const e of errors) lines.push(`- ❌ ${e}`);
    for (const w of warnings) lines.push(`- ⚠️ ${w}`);
    lines.push('');
  }
  lines.push('## 抽查清单（每卷 3 题，供人工与页面原图比对）');
  lines.push('');
  for (const { paper } of results) {
    lines.push(`### ${paper.year}`);
    lines.push('');
    const qs = paper.questions.filter((q) => q.answerKey);
    const picks = [qs[0], qs[Math.floor(qs.length / 2)], qs[qs.length - 1]];
    for (const q of picks) {
      if (!q) continue;
      lines.push(`- seq=${q.seq}（${nameOf(q.sectionType)}）答案=${q.answerKey}；题干：${q.stem.slice(0, 80).replace(/\n/g, ' ')}…`);
    }
    lines.push('');
  }
  lines.push('## 已知局限');
  lines.push('');
  lines.push('- 口语交际对话为 PDF 文本层拼接，长对话行内可能混入相邻行文本；题干取含空位的那一行。');
  lines.push('- 短文完成正文空位的题干取空位前后 ±80 字符窗口。');
  lines.push('- 2012 为旧大纲格式（词汇 20×0.5 / 阅读 30 / 完形 15 / 翻译 2 篇），与官方 77 题位结构不同，属真实差异，不硬凑。');
  lines.push('- 2012 解析覆盖 65/78：口语 1-10 仅在源 PDF 中有批量答案行（无逐题解析），翻译/写作 76-78 仅提供参考答案与范文；');
  lines.push('  属源文本缺失，如实保留，不硬凑。');
  lines.push('');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* 回忆版报告（2023-2026）                                              */
/* ------------------------------------------------------------------ */

interface RecalledResult {
  paper: YearPaper;
  json: ExamJsonFile;
  errors: string[];
  warnings: string[];
}

function renderRecalledReport(results: RecalledResult[]): string {
  const lines: string[] = [];
  lines.push('## 2023-2026 回忆版扩展（单文件、答案内嵌）');
  lines.push('');
  lines.push('> **回忆版声明**：2023-2026 四年真题均为网络回忆版（单文件「真题及答案（回忆版）」，');
  lines.push('> 无独立解析 PDF），题目与答案可能存在回忆偏差，OCR 文本层存在噪声（如 2024 卷高频');
  lines.push('> 水印残迹「wst」、2026 卷字符级镜像行）。本节产物按源文本原样解析，缺失题目/答案');
  lines.push('> 不编造补全，逐项列示如下。');
  lines.push('>');
  lines.push('> 校验口径：`validateExamJson(json, { allowRecalledGaps: true })`——客观题答案缺失、');
  lines.push('> 序号断档、题量与官方口径不符、分值合计不符降级为警告；结构性错误仍为错误。');
  lines.push('');
  lines.push('| 年份 | 区段识别 | 题量 | 客观题答案 | 主观参考 | examJson | 错误/警告 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const { paper, errors, warnings } of results) {
    const s = paper.stats;
    const ok = errors.length === 0 ? '✅ 通过（含警告）' : '❌ 失败';
    lines.push(
      `| ${paper.year} | ${s.identifiedSections}/${s.expectedSections} | ${s.questions}/${s.expectedQuestions} | ${s.answersExtracted}/${s.expectedAnswers} | ${s.subjectiveRefs}/2 | ${ok} | ${errors.length}/${warnings.length} |`,
    );
  }
  lines.push('');
  for (const { paper, errors, warnings } of results) {
    lines.push(`### ${paper.year}（回忆版）`);
    lines.push('');
    // 客观题答案缺失清单
    const objectiveTypes: readonly SectionType[] = ['dialogue', 'vocabulary', 'reading', 'cloze', 'short-completion'];
    const missingAnswers = paper.questions
      .filter((q) => objectiveTypes.includes(q.sectionType) && !q.answerKey)
      .map((q) => q.seq);
    if (missingAnswers.length > 0) {
      lines.push(`- 缺失客观题答案（源文本未提供，置 null）：seq ${missingAnswers.join('、')}，共 ${missingAnswers.length} 题。`);
    }
    const sectionsBrief = paper.sections
      .map((sec) => {
        const count = paper.questions.filter((q) => q.sectionType === sec.type).length;
        return `${nameOf(sec.type)} ${count}/${sec.questionCount}（${sec.score} 分）`;
      })
      .join('，');
    lines.push(`- 区段实况：${sectionsBrief}。`);
    lines.push(`- 完整性评估：${paper.questions.length}/${paper.stats.expectedQuestions} 题，答案 ${paper.stats.answersExtracted}/${paper.stats.expectedAnswers}。`);
    if (paper.stats.renumberedSeqs && paper.stats.renumberedSeqs.length > 0) {
      const detail = paper.stats.renumberedSeqs.map((r) => `${r.from}→${r.to}`).join('、');
      lines.push(`- 题号笔误机械重编号（源卷 OCR 误写，仅修倒退/重复，不碰真实断档）：${detail}。`);
    }
    if (paper.stats.directionFixed) {
      const d = paper.stats.directionFixed;
      lines.push(`- 行方向修复（2026 文本层字符级镜像）：${d.total} 个非空行中反转 ${d.reversed} 行；混排行（半镜像半正常）无法整行还原，残余乱码保留原样。`);
    }
    if (paper.stats.droppedEmptyStems) {
      lines.push(`- 丢弃空题干废题 ${paper.stats.droppedEmptyStems} 道（2026 混排残片，无题干内容，不编造补全）。`);
    }
    if (errors.length === 0 && warnings.length === 0) {
      lines.push('- 无错误、无警告。');
    }
    for (const e of errors) lines.push(`- ❌ ${e}`);
    for (const w of warnings) lines.push(`- ⚠️ ${w}`);
    lines.push('');
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* 导出（供调试探针 scripts/debug_probe.ts 复用）                        */
/* ------------------------------------------------------------------ */

export { buildYear, buildRecalledYear, loadYearText, loadRecalledYearText, parseSolution, toExamJson, cutSections, splitInlineNumbers, splitOptionsFrom, parseStemAndOptions, splitQuestionBlocks };

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

function writeFixture(paper: YearPaper): void {
  const text = renderFixture(paper);
  const meta = {
    year: paper.year,
    totalQuestions: paper.questions.length,
    totalScore: paper.sections.reduce((s, x) => s + x.score, 0),
    sectionCounts: Object.fromEntries(paper.sections.map((s) => [s.type, paper.questions.filter((q) => q.sectionType === s.type).length])),
  };
  const ts = [
    '/**',
    ' * 77 题整卷纯文本 fixture（T12 回归基准）。',
    ' * 由 scripts/build_exams.ts 从 2013 年真题 + 解析自动渲染，请勿手改；',
    ' * 重新生成：npx vite-node scripts/build_exams.ts',
    ' */',
    `export const PAPER_2013_TEXT = ${JSON.stringify(text)};`,
    '',
    '/** fixture 元数据（供测试断言，防 fixture 漂移） */',
    `export const PAPER_2013_META = ${JSON.stringify(meta, null, 2)} as const;`,
    '',
  ];
  fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
  fs.writeFileSync(FIXTURE_PATH, ts.join('\n'), 'utf-8');
}

function main(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results: Array<{ paper: YearPaper; json: ExamJsonFile; errors: string[]; warnings: string[] }> = [];
  let failed = 0;

  for (const year of YEARS) {
    const paper = buildYear(year);
    const json = toExamJson(paper);
    const check = validateExamJson(JSON.parse(JSON.stringify(json)));
    const errors = check.ok ? [] : check.errors;
    const warnings = check.ok ? check.warnings : check.warnings ?? [];
    if (errors.length > 0) failed += 1;
    const outPath = path.join(OUT_DIR, `${year}.json`);
    fs.writeFileSync(outPath, JSON.stringify(json, null, 2), 'utf-8');
    results.push({ paper, json, errors, warnings });
    const s = paper.stats;
    console.log(
      `${year}: 区段 ${s.identifiedSections}/${s.expectedSections}，题量 ${s.questions}/${s.expectedQuestions}，答案 ${s.answersExtracted}/${s.expectedAnswers}，解析 ${s.explanationsExtracted}，examJson ${errors.length === 0 ? 'OK' : `FAIL(${errors.length})`} -> ${outPath}`,
    );
    for (const e of errors) console.error(`  [${year}] ❌ ${e}`);
    for (const w of warnings.slice(0, 3)) console.warn(`  [${year}] ⚠️ ${w}`);
  }

  // fixture：2013（新格式标准卷）
  const fixturePaper = results.find((r) => r.paper.year === 2013)?.paper;
  if (fixturePaper) writeFixture(fixturePaper);
  console.log(`fixture -> ${FIXTURE_PATH}`);

  // 回忆版 2023-2026：单文件、答案内嵌，宽容校验（缺失降级为警告）
  const recalledResults: RecalledResult[] = [];
  for (const year of RECALLED_YEARS) {
    const paper = buildRecalledYear(year);
    const json = toExamJson(paper);
    const check = validateExamJson(JSON.parse(JSON.stringify(json)), { allowRecalledGaps: true });
    const errors = check.ok ? [] : check.errors;
    const warnings = check.ok ? check.warnings : check.warnings ?? [];
    if (errors.length > 0) failed += 1;
    const outPath = path.join(OUT_DIR, `${year}.json`);
    fs.writeFileSync(outPath, JSON.stringify(json, null, 2), 'utf-8');
    recalledResults.push({ paper, json, errors, warnings });
    const s = paper.stats;
    console.log(
      `[回忆版] ${year}: 区段 ${s.identifiedSections}/${s.expectedSections}，题量 ${s.questions}/${s.expectedQuestions}，答案 ${s.answersExtracted}/${s.expectedAnswers}，examJson ${errors.length === 0 ? 'OK(含警告)' : `FAIL(${errors.length})`} -> ${outPath}`,
    );
    for (const e of errors) console.error(`  [${year}] ❌ ${e}`);
  }

  fs.writeFileSync(REPORT_PATH, renderReport(results) + renderRecalledReport(recalledResults), 'utf-8');
  console.log(`report -> ${REPORT_PATH}`);

  if (failed > 0) {
    console.error(`${failed} 份试卷未通过 examJson 校验`);
    process.exitCode = 1;
  } else {
    console.log(`全部 ${YEARS.length} 份标准卷 + ${recalledResults.length} 份回忆卷解析完成（回忆卷含警告属预期）✅`);
  }
}

/** 仅在直接执行时运行主流程（被 import 时不跑） */
const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (invokedDirectly) {
  main();
}
