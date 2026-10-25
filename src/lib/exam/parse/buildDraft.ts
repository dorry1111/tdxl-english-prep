/**
 * 草稿组装与校验（T12 管线第 4 步，ARCHITECTURE 4.3）。
 *
 * buildDraft：normalize → splitSections → 逐区段 classifyLine → 组装 ParsedPaperDraft。
 * validateDraft：题型/答案/序号/分值五类硬校验（errors）+ 结构性软校验（warnings）。
 *
 * 硬性要求（PRD 8.2 容错）：任何未识别的行不得静默丢弃，
 * 必须进入 draft.unresolved 供校对页展示。
 */
import type { Passage, ParsedPaperDraft, Question, QuestionOption, Section, SectionType } from '@/types';
import {
  classifyLine,
  extractAnswerKey,
  splitOptionGroup,
  type ParsedOption,
} from './lineClassifier';
import { normalizeText, type NormalizeReport } from './normalize';
import {
  OFFICIAL_PAPER_STRUCTURE,
  OFFICIAL_TOTAL_QUESTIONS,
  OFFICIAL_TOTAL_SCORE,
  officialOrder,
  sectionName,
} from './sectionRules';
import { splitSections, type NumberedLine, type SectionSpan } from './splitSections';

/** 允许挂文章的题型（Question.passageId 必填题型） */
const PASSAGE_BEARING: readonly SectionType[] = ['reading', 'cloze', 'short-completion'];

/** 是否客观题（本目录自带推导，保持零外部运行时依赖） */
function isObjectiveType(type: SectionType): boolean {
  return type !== 'translation' && type !== 'writing';
}

/** 组装过程中的题目中间态 */
interface DraftQuestion {
  seq: number;
  sectionType: SectionType;
  firstLineNo: number;
  stemLines: string[];
  options: QuestionOption[];
  answerKey: string | null;
  referenceLines: string[];
  explanationLines: string[];
  /** 主观题答案行的续行跟随（后续 text 行追加进 referenceAnswer） */
  referenceOpen: boolean;
  /** 解析行的续行跟随（后续 text 行追加进 explanation） */
  explanationOpen: boolean;
  score: number | null;
  passageId: string | null;
}

/** 组装过程中的文章中间态 */
interface DraftPassage {
  id: string;
  order: number;
  contentLines: string[];
}
/** 单区段组装结果 */
interface SectionBuild {
  questions: DraftQuestion[];
  passages: Array<{ id: string; sectionType: SectionType; order: number; content: string }>;
  unresolved: ParsedPaperDraft['unresolved'];
}

/** 生成草稿用的题目临时 ID（确定性，保证幂等） */
function draftQuestionId(seq: number): string {
  return `draft-q${seq}`;
}

/** 生成草稿用的文章临时 ID（确定性，保证幂等） */
function draftPassageId(sectionType: SectionType, order: number): string {
  return `draft-p-${sectionType}-${order}`;
}

/** 区段内逐行扫描并组装题目/文章 */
function buildSection(span: SectionSpan): SectionBuild {
  const questions: DraftQuestion[] = [];
  const passages: SectionBuild['passages'] = [];
  const unresolved: ParsedPaperDraft['unresolved'] = [];

  let cur: DraftQuestion | null = null;
  // 「归属其后第一个题组」的当前文章
  let activePassage: DraftPassage | null = null;
  // 文章标题（Passage One 等）刚出现、正文仍在收集：正文行直接写入该文章
  let headingOpen = false;
  let passageOrder = 0;
  // 长文本块累积缓冲（PRD 8.2：连续 ≥2 行且 ≥100 字符 → Passage）
  let textBuffer: NumberedLine[] = [];

  const isPassageBearing = PASSAGE_BEARING.includes(span.type);

  const newQuestion = (seq: number, lineNo: number): DraftQuestion => ({
    seq,
    sectionType: span.type,
    firstLineNo: lineNo,
    stemLines: [],
    options: [],
    answerKey: null,
    referenceLines: [],
    explanationLines: [],
    referenceOpen: false,
    explanationOpen: false,
    score: null,
    passageId: isPassageBearing && activePassage ? activePassage.id : null,
  });

  /** 把标题文章收集到的正文同步回 passages 表 */
  const syncActivePassage = (): void => {
    if (!activePassage) return;
    const entry = passages.find((p) => p.id === activePassage?.id);
    if (entry) entry.content = passageContent(activePassage.contentLines);
  };

  /** 把缓冲的长文本块落成文章或转入 unresolved */
  const flushTextBuffer = (): void => {
    if (textBuffer.length === 0) return;
    const chars = textBuffer.reduce((sum, l) => sum + l.text.trim().length, 0);
    if (textBuffer.length >= 2 && chars >= 100) {
      syncActivePassage();
      passageOrder += 1;
      const id = draftPassageId(span.type, passageOrder);
      passages.push({
        id,
        sectionType: span.type,
        order: passageOrder,
        content: textBuffer.map((l) => l.text.replace(/\s+$/g, '')).join('\n').trim(),
      });
      activePassage = { id, order: passageOrder, contentLines: [] };
    } else {
      for (const l of textBuffer) {
        unresolved.push({
          lineNo: l.lineNo,
          text: l.text,
          reason: '过短的散行文本，无法归类为文章或题干',
        });
      }
    }
    textBuffer = [];
  };

  for (const numbered of span.lines) {
    const line = classifyLine(numbered.text, numbered.lineNo, {
      hasCurrentQuestion: cur !== null,
    });
    switch (line.type) {
      case 'blank': {
        if (headingOpen && activePassage) {
          // 文章正文内的空行 = 段落分隔，保留在正文里
          if (activePassage.contentLines.length > 0) activePassage.contentLines.push('');
        } else {
          // 空行冲断长文本块累积，不产生数据
          flushTextBuffer();
        }
        break;
      }
      case 'passageHeading': {
        flushTextBuffer();
        syncActivePassage();
        headingOpen = false;
        passageOrder += 1;
        const id = draftPassageId(span.type, passageOrder);
        passages.push({ id, sectionType: span.type, order: passageOrder, content: '' });
        activePassage = { id, order: passageOrder, contentLines: [] };
        headingOpen = true;
        break;
      }
      case 'questionNo': {
        flushTextBuffer();
        headingOpen = false;
        cur = newQuestion(line.seq, numbered.lineNo);
        questions.push(cur);
        // 题号行 remainder：可能是题干首行，也可能直接带内联选项
        if (line.rest) {
          const inlineOptions = splitOptionGroup(line.rest);
          if (inlineOptions) {
            cur.options.push(...inlineOptions.map((o) => ({ key: o.key, text: o.text })));
          } else {
            cur.stemLines.push(line.rest);
          }
        }
        break;
      }
      case 'option':
      case 'optionGroup': {
        const options: ParsedOption[] =
          line.type === 'option' ? [{ key: line.key, text: line.text }] : line.options;
        if (cur) {
          cur.options.push(...options.map((o) => ({ key: o.key, text: o.text })));
        } else if (headingOpen && activePassage) {
          // 文章标题后、题目出现前的「A. xx B. yy」式行（如短文完成选词框）→ 归入文章正文
          activePassage.contentLines.push(numbered.text);
        } else {
          unresolved.push({
            lineNo: numbered.lineNo,
            text: numbered.text,
            reason: '选项行未找到所属题目',
          });
        }
        break;
      }
      case 'answer': {
        if (cur) {
          if (isObjectiveType(span.type)) {
            cur.answerKey = extractAnswerKey(line.value) ?? line.value.trim();
          } else {
            cur.referenceLines.push(line.value);
            cur.referenceOpen = true;
            cur.explanationOpen = false;
          }
        } else {
          unresolved.push({
            lineNo: numbered.lineNo,
            text: numbered.text,
            reason: '答案行未找到所属题目',
          });
        }
        break;
      }
      case 'explanation': {
        if (cur) {
          if (line.text) cur.explanationLines.push(line.text);
          cur.explanationOpen = true;
          cur.referenceOpen = false;
        } else {
          unresolved.push({
            lineNo: numbered.lineNo,
            text: numbered.text,
            reason: '解析行未找到所属题目',
          });
        }
        break;
      }
      case 'score': {
        if (cur) {
          cur.score = line.score;
        } else {
          unresolved.push({
            lineNo: numbered.lineNo,
            text: numbered.text,
            reason: '分值行未找到所属题目',
          });
        }
        break;
      }
      case 'text':
      default: {
        if (cur && cur.referenceOpen) {
          // 主观题参考答案的续行
          cur.referenceLines.push(numbered.text);
        } else if (cur && cur.explanationOpen) {
          // 解析的续行
          cur.explanationLines.push(numbered.text);
        } else if (cur && cur.answerKey) {
          // 答案已出现、又不是解析/参考续行的散行 → 未识别内容，不得静默吞进题干
          unresolved.push({
            lineNo: numbered.lineNo,
            text: numbered.text,
            reason: '答案行之后的未识别内容',
          });
        } else if (cur) {
          // 其他行 → 追加到当前题目题干（PRD 8.2）
          cur.stemLines.push(numbered.text);
        } else if (headingOpen && activePassage) {
          // 文章标题后的正文行 → 直接写入该文章
          activePassage.contentLines.push(numbered.text);
        } else {
          // 无当前题：可能属于文章正文，进缓冲等判定
          textBuffer.push({ lineNo: numbered.lineNo, text: numbered.text });
        }
        break;
      }
    }
  }
  flushTextBuffer();
  syncActivePassage();

  return { questions, passages, unresolved };
}

/** 由文章中间态生成正文（续行收集在此简化：正文 = 缓冲内容） */
function passageContent(lines: string[]): string {
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 整卷组装：normalize → splitSections → buildSection → ParsedPaperDraft。
 * 幂等：无随机、无时间戳参与，同一文本重复解析输出深度相等。
 */
export function buildDraft(rawText: string): ParsedPaperDraft {
  const normalized = normalizeText(rawText);
  const lines = normalized.split('\n');
  const { prelude, sections } = splitSections(lines);

  const unresolved: ParsedPaperDraft['unresolved'] = [];
  const warnings: string[] = [];

  // prelude：整卷标题行可作试卷名，其余进 unresolved（无一行静默丢弃）
  let title = '';
  for (const l of prelude) {
    const trimmed = l.text.trim();
    if (!title && /^\d{4}\s*年/.test(trimmed) && /(试题|试卷|真题)/.test(trimmed)) {
      title = trimmed;
      continue;
    }
    if (trimmed) {
      unresolved.push({ lineNo: l.lineNo, text: l.text, reason: '区段标题之前的内容，未识别归属' });
    }
  }
  if (prelude.some((l) => l.text.trim()) && !title) {
    warnings.push('未在卷首识别到试卷标题行，请在校对页补充');
  }

  const builds = sections.map((span) => buildSection(span));

  // ---- 汇总未识别行（各区段的 unresolved 必须上浮到整卷，禁止静默丢弃）----
  for (const b of builds) unresolved.push(...b.unresolved);

  // ---- 汇总文章 ----
  const passages: Passage[] = [];
  for (let i = 0; i < builds.length; i += 1) {
    const build = builds[i];
    const span = sections[i];
    if (!build || !span) continue;
    for (const p of build.passages) {
      passages.push({
        id: p.id,
        paperId: '',
        sectionType: span.type,
        order: p.order,
        content: p.content,
        updatedAt: 0,
        deletedAt: null,
      });
    }
  }

  // ---- 汇总题目 ----
  const questions: Question[] = [];
  for (let i = 0; i < builds.length; i += 1) {
    const build = builds[i];
    const span = sections[i];
    if (!build || !span) continue;
    const objective = isObjectiveType(span.type);
    for (const q of build.questions) {
      questions.push({
        id: draftQuestionId(q.seq),
        paperId: '',
        sectionType: span.type,
        passageId: q.passageId,
        seq: q.seq,
        stem: q.stemLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
        blankIndex: null,
        options: q.options,
        answerKey: objective ? q.answerKey : null,
        referenceAnswer: objective ? null : q.referenceLines.join('\n').trim() || null,
        explanation: q.explanationLines.join('\n').trim(),
        // 无显式分值行时：客观题按官方每题 1 分；主观题（单题区段）取官方区段分值
        score: q.score ?? (objective ? 1 : (OFFICIAL_PAPER_STRUCTURE.find((x) => x.type === span.type)?.score ?? 0)),
        isObjective: objective,
        updatedAt: 0,
        deletedAt: null,
      });
    }
  }

  // ---- 区段结构 ----
  const sectionList: Section[] = sections.map((span, i) => {
    const build = builds[i];
    const qs = questions.filter((q) => q.sectionType === span.type);
    return {
      type: span.type,
      order: officialOrder(span.type),
      score: qs.reduce((sum, q) => sum + q.score, 0),
      questionCount: qs.length,
      passageIds: build ? build.passages.map((p) => p.id) : [],
    };
  });

  return {
    title: title || '未命名试卷',
    timeLimitSec: 9000,
    sections: sectionList,
    passages,
    questions,
    unresolved,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* 校验                                                                */
/* ------------------------------------------------------------------ */

/** 校验结果 */
export interface DraftValidation {
  errors: string[];
  warnings: string[];
}

/**
 * 草稿校验（ARCHITECTURE 4.3 validateDraft）：
 * 1 题型合法 2 answerKey ∈ options 3 seq 唯一连续
 * 4 分值合计 = 区段分值 5 客观题必须有答案；
 * 另有 77 题 / 100 分 / 七题型齐全等结构性软校验（warnings，不阻塞——真实真题可能微调）。
 */
export function validateDraft(draft: ParsedPaperDraft): DraftValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ---- 硬校验 1：题型合法 ----
  const legalTypes = new Set<string>([
    'dialogue',
    'vocabulary',
    'reading',
    'cloze',
    'short-completion',
    'translation',
    'writing',
  ]);
  draft.questions.forEach((q, i) => {
    if (!legalTypes.has(q.sectionType)) {
      errors.push(`questions[${i}].sectionType 非法题型：${q.sectionType}`);
    }
  });

  // ---- 硬校验 2/5：answerKey ∈ options；客观题必须有答案与选项 ----
  draft.questions.forEach((q, i) => {
    if (q.isObjective) {
      if (!q.answerKey) {
        errors.push(`questions[${i}].answerKey 客观题缺少答案（seq=${q.seq}）`);
      } else if (!q.options.some((o) => o.key === q.answerKey)) {
        errors.push(
          `questions[${i}].answerKey 答案「${q.answerKey}」不在选项集合内（seq=${q.seq}，可选：${q.options.map((o) => o.key).join('/') || '无'}）`,
        );
      }
      if (q.options.length === 0) {
        errors.push(`questions[${i}].options 客观题缺少选项（seq=${q.seq}）`);
      }
    } else if (!q.referenceAnswer) {
      warnings.push(`questions[${i}].referenceAnswer 主观题缺少参考答案（seq=${q.seq}）`);
    }
  });

  // ---- 硬校验 3：seq 唯一且连续 ----
  const seqs = draft.questions.map((q) => q.seq).sort((a, b) => a - b);
  seqs.forEach((seq, i) => {
    const prev = seqs[i - 1];
    if (prev === seq) {
      errors.push(`questions[${i}].seq 序号重复：${seq}`);
    } else if (prev !== undefined && seq !== prev + 1) {
      errors.push(`questions[${i}].seq 序号不连续：${prev} 之后出现 ${seq}`);
    }
  });
  const firstSeq = seqs[0];
  if (firstSeq !== undefined && firstSeq !== 1) {
    errors.push(`questions[0].seq 序号应从 1 开始，实际为 ${firstSeq}`);
  }

  // ---- 硬校验 4：题目分值合计 = 区段分值 ----
  for (const section of draft.sections) {
    const sum = draft.questions
      .filter((q) => q.sectionType === section.type)
      .reduce((s, q) => s + q.score, 0);
    if (Math.abs(sum - section.score) > 1e-9) {
      errors.push(
        `paper.sections[${section.order - 1}].score 区段「${sectionName(section.type)}」题目分值合计 ${sum} 与区段分值 ${section.score} 不一致`,
      );
    }
  }

  // ---- 硬校验：至少要有题目 ----
  if (draft.questions.length === 0) {
    errors.push('questions 整卷未识别到任何题目');
  }

  // ---- 软校验：官方结构基准（不符只警告，真实真题可能微调）----
  if (draft.questions.length !== OFFICIAL_TOTAL_QUESTIONS) {
    warnings.push(
      `总题数 ${draft.questions.length} 与官方结构 ${OFFICIAL_TOTAL_QUESTIONS}（75 客观 + 2 主观）不一致`,
    );
  }
  const totalScore = draft.sections.reduce((s, sec) => s + sec.score, 0);
  if (Math.abs(totalScore - OFFICIAL_TOTAL_SCORE) > 1e-9) {
    warnings.push(`区段分值合计 ${totalScore} 与官方总分 ${OFFICIAL_TOTAL_SCORE} 不一致`);
  }
  for (const spec of OFFICIAL_PAPER_STRUCTURE) {
    const found = draft.sections.find((s) => s.type === spec.type);
    if (!found) {
      warnings.push(`缺少区段「${sectionName(spec.type)}」`);
      continue;
    }
    if (found.questionCount !== spec.questionCount) {
      warnings.push(
        `区段「${sectionName(spec.type)}」题量 ${found.questionCount} 与官方 ${spec.questionCount} 不一致`,
      );
    }
  }

  // ---- 软校验：未识别行 ----
  if (draft.unresolved.length > 0) {
    warnings.push(`存在 ${draft.unresolved.length} 行未识别内容，需在校对页人工归类`);
  }

  return { errors, warnings };
}

/** 完整管线结果 */
export interface BuildDraftResult {
  draft: ParsedPaperDraft;
  /** validateDraft 输出（与 draft 分离返回，便于单测） */
  validation: DraftValidation;
  /** 规范化统计（质量报告用） */
  normalizeReport: NormalizeReport;
}

/**
 * 完整管线入口：粘贴原文 → { 草稿, 校验结果 }。
 * 幂等：同一文本连续解析 3 次输出深度相等（无随机、无时间戳参与）。
 */
export function parsePastedPaper(rawText: string): BuildDraftResult {
  const normalizeReport: NormalizeReport = {
    fullWidthConverted: 0,
    zeroWidthRemoved: 0,
    headerFooterLines: 0,
    blankLinesCollapsed: 0,
  };
  const normalized = normalizeText(rawText, { report: normalizeReport });
  const draft = buildDraft(normalized);
  const validation = validateDraft(draft);
  return { draft, validation, normalizeReport };
}
