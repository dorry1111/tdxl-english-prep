/**
 * 试卷 JSON 导入校验（PRD 8.3）。
 *
 * 校验规则（PRD 8.3 导入校验 ①-⑤）：
 * ① sections 的 type 必须属七题型，且不得重复出现（标准卷七题型各一次）；
 * ② 各 section.questionCount 必须等于 questions 中对应 type 的条数；
 * ③ 各 section.score 之和须等于 totalScore（标准卷 100）；
 * ④ 客观题 answerKey 必须在 options 的 key 集合内；主观题 answerKey 为 null 并提供 referenceAnswer；
 * ⑤ seq 全卷唯一且连续（1..N）。
 *
 * 任何校验失败都给出字段路径（如 `paper.sections[2].questionCount`），不写入任何数据。
 */
import { AppError } from '@/lib/errors';
import { now } from '@/lib/time';
import type { Exam, Passage, Question, SectionType } from '@/types';

/** PRD 8.3 区段结构 */
export interface ExamJsonSection {
  type: SectionType;
  order: number;
  questionCount: number;
  score: number;
  /** 参考用时（分钟），可选 */
  minutes?: number;
}

/** PRD 8.3 选项 */
export interface ExamJsonOption {
  key: string;
  text: string;
}

/** PRD 8.3 题目（主观题可无 options / answerKey） */
export interface ExamJsonQuestion {
  id: string;
  sectionType: SectionType;
  passageId?: string | null;
  seq: number;
  stem: string;
  blankIndex?: number | null;
  /** 客观题选项；主观题可缺省（等价空数组） */
  options?: ExamJsonOption[];
  /** 客观题答案字母；主观题须为 null/缺省 */
  answerKey?: string | null;
  referenceAnswer?: string | null;
  explanation?: string;
  score: number;
}

/** PRD 8.3 文章 */
export interface ExamJsonPassage {
  id: string;
  sectionType: SectionType;
  order: number;
  content: string;
  translation?: string;
}

/** PRD 8.3 整份试卷 JSON */
export interface ExamJsonFile {
  schemaVersion: number;
  paper: {
    title: string;
    timeLimitSec: number;
    totalScore: number;
    sections: ExamJsonSection[];
  };
  passages: ExamJsonPassage[];
  questions: ExamJsonQuestion[];
}

/** 合法题型集合 */
const SECTION_TYPES: readonly string[] = [
  'dialogue',
  'vocabulary',
  'reading',
  'cloze',
  'short-completion',
  'translation',
  'writing',
];

/** 主观题型 */
const SUBJECTIVE_TYPES: readonly string[] = ['translation', 'writing'];

function isSectionType(v: unknown): v is SectionType {
  return typeof v === 'string' && SECTION_TYPES.includes(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 校验结果：ok 时给出规范化数据，失败时给全部错误（字段路径齐全） */
export type ExamJsonValidateResult =
  | { ok: true; value: ExamJsonFile; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

/** 校验选项 */
export interface ExamJsonValidateOptions {
  /**
   * 回忆版宽容模式（2023-2026 单文件回忆卷）：
   * 客观题答案缺失、主观题参考缺失、序号断档、题量与官方口径不符、分值合计与总分不符
   * 均降级为警告（源文本缺失属回忆版固有缺陷，如实记录，不阻塞导入）；
   * 结构性错误（schema、题型、选项结构、ID 冲突等）仍为错误。默认 false（严格模式）。
   */
  allowRecalledGaps?: boolean;
}

/**
 * 校验 PRD 8.3 试卷 JSON。返回全部错误（不抛异常、不截断），
 * 每条错误都带字段路径，供导入页错误清单直接展示。
 */
export function validateExamJson(
  input: unknown,
  options: ExamJsonValidateOptions = {},
): ExamJsonValidateResult {
  const recalled = options.allowRecalledGaps === true;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: ['根节点必须是对象'], warnings };
  }

  // ---- schemaVersion ----
  if (input['schemaVersion'] !== 1) {
    errors.push(`schemaVersion 必须为 1，实际为 ${JSON.stringify(input['schemaVersion'])}`);
  }

  // ---- paper ----
  const paper = input['paper'];
  if (!isRecord(paper)) {
    return { ok: false, errors: ['paper 必须是对象'], warnings };
  }
  if (typeof paper['title'] !== 'string' || paper['title'].length === 0) {
    errors.push('paper.title 必须是非空字符串');
  }
  if (typeof paper['timeLimitSec'] !== 'number' || paper['timeLimitSec'] <= 0) {
    errors.push('paper.timeLimitSec 必须是正数');
  }
  if (typeof paper['totalScore'] !== 'number' || paper['totalScore'] <= 0) {
    errors.push('paper.totalScore 必须是正数');
  }

  // ---- paper.sections ----
  const rawSections = paper['sections'];
  if (!Array.isArray(rawSections)) {
    return { ok: false, errors: ['paper.sections 必须是数组'], warnings };
  }
  const sections: ExamJsonSection[] = [];
  rawSections.forEach((s, i) => {
    const path = `paper.sections[${i}]`;
    if (!isRecord(s)) {
      errors.push(`${path} 必须是对象`);
      return;
    }
    if (!isSectionType(s['type'])) {
      errors.push(`${path}.type 非法题型：${JSON.stringify(s['type'])}`);
      return;
    }
    if (typeof s['order'] !== 'number' || !Number.isInteger(s['order']) || s['order'] <= 0) {
      errors.push(`${path}.order 必须是正整数`);
    }
    if (typeof s['questionCount'] !== 'number' || !Number.isInteger(s['questionCount']) || s['questionCount'] < 0) {
      errors.push(`${path}.questionCount 必须是非负整数`);
    }
    if (typeof s['score'] !== 'number' || s['score'] <= 0) {
      errors.push(`${path}.score 必须是正数`);
    }
    sections.push({
      type: s['type'],
      order: typeof s['order'] === 'number' ? s['order'] : 0,
      questionCount: typeof s['questionCount'] === 'number' ? s['questionCount'] : -1,
      score: typeof s['score'] === 'number' ? s['score'] : -1,
      ...(typeof s['minutes'] === 'number' ? { minutes: s['minutes'] } : {}),
    });
  });

  // 规则①：题型不得重复；标准卷七题型各出现一次（缺题型降级为警告——真实真题可能缺区段）
  const seen = new Map<string, number>();
  sections.forEach((s, i) => {
    const prev = seen.get(s.type);
    if (prev !== undefined) {
      errors.push(`paper.sections[${i}].type 题型「${s.type}」重复出现（首次在 paper.sections[${prev}]）`);
    } else {
      seen.set(s.type, i);
    }
  });
  for (const t of SECTION_TYPES) {
    if (!seen.has(t)) {
      warnings.push(`paper.sections 缺少题型「${t}」（非标准卷结构，请确认）`);
    }
  }
  // order 唯一
  const orders = sections.map((s) => s.order);
  sections.forEach((s, i) => {
    const first = orders.indexOf(s.order);
    if (first !== i && first !== -1) {
      errors.push(`paper.sections[${i}].order 区段顺序 ${s.order} 与 paper.sections[${first}] 重复`);
    }
  });

  // ---- passages ----
  const rawPassages = input['passages'];
  if (!Array.isArray(rawPassages)) {
    errors.push('passages 必须是数组（无文章的卷可为空数组）');
  } else {
    rawPassages.forEach((p, i) => {
      const path = `passages[${i}]`;
      if (!isRecord(p)) {
        errors.push(`${path} 必须是对象`);
        return;
      }
      if (typeof p['id'] !== 'string' || p['id'].length === 0) {
        errors.push(`${path}.id 必须是非空字符串`);
      }
      if (!isSectionType(p['sectionType'])) {
        errors.push(`${path}.sectionType 非法题型：${JSON.stringify(p['sectionType'])}`);
      }
      if (typeof p['content'] !== 'string' || p['content'].length === 0) {
        errors.push(`${path}.content 必须是非空字符串`);
      }
    });
  }

  // ---- questions ----
  const rawQuestions = input['questions'];
  if (!Array.isArray(rawQuestions)) {
    return { ok: false, errors: [...errors, 'questions 必须是数组'], warnings };
  }
  const questions: ExamJsonQuestion[] = [];
  rawQuestions.forEach((q, i) => {
    const path = `questions[${i}]`;
    if (!isRecord(q)) {
      errors.push(`${path} 必须是对象`);
      return;
    }
    if (typeof q['id'] !== 'string' || q['id'].length === 0) {
      errors.push(`${path}.id 必须是非空字符串`);
    }
    if (!isSectionType(q['sectionType'])) {
      errors.push(`${path}.sectionType 非法题型：${JSON.stringify(q['sectionType'])}`);
    }
    if (typeof q['seq'] !== 'number' || !Number.isInteger(q['seq']) || q['seq'] <= 0) {
      errors.push(`${path}.seq 必须是正整数`);
    }
    if (typeof q['stem'] !== 'string' || q['stem'].length === 0) {
      errors.push(`${path}.stem 必须是非空字符串`);
    }
    if (q['options'] !== undefined && !Array.isArray(q['options'])) {
      errors.push(`${path}.options 必须是数组`);
    } else if (Array.isArray(q['options'])) {
      q['options'].forEach((o, j) => {
        if (!isRecord(o) || typeof o['key'] !== 'string' || typeof o['text'] !== 'string') {
          errors.push(`${path}.options[${j}] 必须是 { key, text } 结构`);
        }
      });
    }
    if (typeof q['score'] !== 'number' || q['score'] <= 0) {
      errors.push(`${path}.score 必须是正数`);
    }
    const subjective = SUBJECTIVE_TYPES.includes(String(q['sectionType']));
    if (subjective) {
      if (q['answerKey'] != null) {
        errors.push(`${path}.answerKey 主观题的 answerKey 必须为 null，参考答案应放在 referenceAnswer`);
      }
      if (typeof q['referenceAnswer'] !== 'string' || q['referenceAnswer'].length === 0) {
        const msg = `${path}.referenceAnswer 主观题必须提供参考答案`;
        if (recalled) warnings.push(`${msg}（回忆版源文本未提供，请人工核对）`);
        else errors.push(msg);
      }
    } else {
      if (typeof q['answerKey'] !== 'string' || q['answerKey'].length === 0) {
        const msg = `${path}.answerKey 客观题必须提供答案字母`;
        if (recalled) warnings.push(`${msg}（回忆版源文本未提供，请人工核对）`);
        else errors.push(msg);
      }
    }
    questions.push({
      id: typeof q['id'] === 'string' ? q['id'] : '',
      sectionType: isSectionType(q['sectionType']) ? q['sectionType'] : 'dialogue',
      passageId: typeof q['passageId'] === 'string' ? q['passageId'] : null,
      seq: typeof q['seq'] === 'number' ? q['seq'] : -1,
      stem: typeof q['stem'] === 'string' ? q['stem'] : '',
      blankIndex: typeof q['blankIndex'] === 'number' ? q['blankIndex'] : null,
      options: Array.isArray(q['options'])
        ? (q['options'] as unknown[]).filter(isRecord).map((o) => ({
            key: String(o['key'] ?? ''),
            text: String(o['text'] ?? ''),
          }))
        : [],
      answerKey: typeof q['answerKey'] === 'string' ? q['answerKey'] : null,
      referenceAnswer: typeof q['referenceAnswer'] === 'string' ? q['referenceAnswer'] : null,
      explanation: typeof q['explanation'] === 'string' ? q['explanation'] : '',
      score: typeof q['score'] === 'number' ? q['score'] : -1,
    });
  });

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  // ---- 规则④：answerKey ∈ options 的 key 集合 ----
  questions.forEach((q, i) => {
    const path = `questions[${i}]`;
    if (q.answerKey !== null && !(q.options ?? []).some((o) => o.key === q.answerKey)) {
      errors.push(
        `${path}.answerKey 答案「${q.answerKey}」不在选项集合内（可选：${(q.options ?? []).map((o) => o.key).join('/') || '无'}）`,
      );
    }
    // passageId 必须指向存在的文章
    if (q.passageId !== null && q.passageId !== undefined) {
      const exists = Array.isArray(rawPassages)
        ? rawPassages.some((p) => isRecord(p) && p['id'] === q.passageId)
        : false;
      if (!exists) {
        errors.push(`${path}.passageId 引用的文章「${q.passageId}」不存在于 passages`);
      }
    }
  });

  // ---- 规则⑤：seq 唯一且连续（重复始终为错误；断档在回忆版模式下降级为警告） ----
  const seqs = questions.map((q) => q.seq).sort((a, b) => a - b);
  seqs.forEach((seq, i) => {
    const prev = seqs[i - 1];
    if (prev === seq) {
      errors.push(`questions[${i}].seq 序号重复：${seq}`);
    } else if (prev !== undefined && seq !== prev + 1) {
      const msg = `questions[${i}].seq 序号不连续：${prev} 之后出现 ${seq}`;
      if (recalled) warnings.push(`${msg}（回忆版缺题，请核对）`);
      else errors.push(msg);
    }
  });
  const firstSeq = seqs[0];
  if (firstSeq !== undefined && firstSeq !== 1) {
    const msg = `questions[0].seq 序号应从 1 开始，实际为 ${firstSeq}`;
    if (recalled) warnings.push(`${msg}（回忆版缺题，请核对）`);
    else errors.push(msg);
  }

  // ---- 规则②：各 section.questionCount = 该题型题目条数 ----
  sections.forEach((s, i) => {
    const count = questions.filter((q) => q.sectionType === s.type).length;
    if (count !== s.questionCount) {
      const msg = `paper.sections[${i}].questionCount 题型「${s.type}」声明 ${s.questionCount} 题，实际 questions 中有 ${count} 题`;
      if (recalled) warnings.push(`${msg}（回忆版缺题，请核对）`);
      else errors.push(msg);
    }
  });
  // 无区段归属的题目
  questions.forEach((q, i) => {
    if (!sections.some((s) => s.type === q.sectionType)) {
      errors.push(`questions[${i}].sectionType 题型「${q.sectionType}」不在 paper.sections 中`);
    }
  });

  // ---- 规则③：Σ section.score = totalScore ----
  const scoreSum = sections.reduce((s, sec) => s + sec.score, 0);
  const totalScore = typeof paper['totalScore'] === 'number' ? paper['totalScore'] : -1;
  if (Math.abs(scoreSum - totalScore) > 1e-9) {
    const msg = `paper.sections 各区段分值合计 ${scoreSum} ≠ paper.totalScore ${totalScore}`;
    if (recalled) warnings.push(`${msg}（回忆版缺题，请核对）`);
    else errors.push(msg);
  }

  // ---- id 唯一 ----
  const ids = new Set<string>();
  questions.forEach((q, i) => {
    if (ids.has(q.id)) {
      errors.push(`questions[${i}].id 题目 ID 重复：${q.id}`);
    }
    ids.add(q.id);
  });

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  // ---- 结构性告警（不阻塞导入）：四选项题型选项数 ≠ 4 ----
  // vocabulary / reading / cloze 标准为 A-D 四选项；口语/短文完成的盒选项数量合法浮动，豁免。
  // 用于拦截「选项标记黏连导致选项丢失」类缺陷（如 2020 卷 seq15 "recommendD. debate"）静默通过。
  const FOUR_OPTION_TYPES: readonly SectionType[] = ['vocabulary', 'reading', 'cloze'];
  questions.forEach((q, i) => {
    if (FOUR_OPTION_TYPES.includes(q.sectionType)) {
      const count = (q.options ?? []).length;
      if (count !== 4) {
        warnings.push(
          `questions[${i}].options 题型「${q.sectionType}」的选项数为 ${count}（标准为 4），疑似选项缺失，请核对`,
        );
      }
    }
  });

  return {
    ok: true,
    value: { schemaVersion: 1, paper: { title: String(paper['title']), timeLimitSec: paper['timeLimitSec'] as number, totalScore: totalScore, sections }, passages: Array.isArray(rawPassages) ? (rawPassages as ExamJsonPassage[]) : [], questions },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* 校验 + 构建可落库整卷（T15 seed / JSON 导入共用）                     */
/* ------------------------------------------------------------------ */

/** buildExamFromJson 的产物：可直接交给 examRepo.savePaper() 落库 */
export interface BuiltExam {
  exam: Exam;
  passages: Passage[];
  questions: Question[];
}

/**
 * 校验 PRD 8.3 试卷 JSON 并构建 Exam/Passage[]/Question[]（不落库）。
 *
 * - 校验失败抛 `AppError('INVALID_INPUT')`，detail 为全部字段路径错误清单；
 * - `paperId` 缺省时依次取 `paper.id`（若 JSON 提供）、按标题派生的稳定 ID；
 * - `recalled: true` 时校验走回忆版宽容模式（2023-2025 单文件回忆卷：
 *   客观题 answerKey=null 合法，缺题/题量偏差降级为警告）；
 * - 构建的 exam.parseStatus 为 'parsed'，调用方可按需提升为 'verified'。
 */
export function buildExamFromJson(
  input: unknown,
  options: { paperId?: string; recalled?: boolean } = {},
): BuiltExam {
  const result = validateExamJson(input, { allowRecalledGaps: options.recalled === true });
  if (!result.ok) {
    throw new AppError('INVALID_INPUT', result.errors);
  }
  const json = result.value;
  const stamp = now();

  // paperId：显式指定 > JSON 内 paper.id > 标题派生（同一标题得到稳定 ID，幂等）
  const rawPaper = isRecord(input) && isRecord(input['paper']) ? input['paper'] : {};
  const rawId = rawPaper['id'];
  const paperId =
    options.paperId ??
    (typeof rawId === 'string' && rawId.length > 0 ? rawId : `paper-${json.paper.title.slice(0, 60)}`);

  const passages: Passage[] = json.passages.map((p, i) => ({
    id: p.id,
    paperId,
    sectionType: p.sectionType,
    order: i + 1,
    content: p.content,
    ...(p.translation !== undefined ? { translation: p.translation } : {}),
    updatedAt: stamp,
    deletedAt: null,
  }));

  const questions: Question[] = json.questions.map((q) => ({
    id: q.id,
    paperId,
    sectionType: q.sectionType,
    passageId: q.passageId ?? null,
    seq: q.seq,
    stem: q.stem,
    blankIndex: q.blankIndex ?? null,
    options: q.options ?? [],
    answerKey: q.answerKey ?? null,
    referenceAnswer: q.referenceAnswer ?? null,
    explanation: q.explanation ?? '',
    score: q.score,
    isObjective: !SUBJECTIVE_TYPES.includes(q.sectionType),
    updatedAt: stamp,
    deletedAt: null,
  }));

  const exam: Exam = {
    id: paperId,
    title: json.paper.title,
    source: 'json',
    sections: json.paper.sections.map((s) => ({
      type: s.type,
      order: s.order,
      score: s.score,
      questionCount: s.questionCount,
      passageIds: passages.filter((p) => p.sectionType === s.type).map((p) => p.id),
    })),
    totalQuestions: questions.length,
    totalScore: json.paper.totalScore,
    timeLimitSec: json.paper.timeLimitSec,
    parseStatus: 'parsed',
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  };

  return { exam, passages, questions };
}
