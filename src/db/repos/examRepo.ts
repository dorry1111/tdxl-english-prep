/**
 * 试卷仓库：Exam / Passage / Question 的读写。
 *
 * 远端实体：
 * - Exam → `exam-index.json`
 * - Passage / Question → `exams/<paperId>.json`（按试卷分文件）
 *
 * 整卷事务写入 `savePaper()`（T11）带分值校验：
 * 区段分值合计 ≠ 试卷总分时抛 `AppError('EXAM_SCORE_MISMATCH')` 且无任何残留；
 * 结构与标准卷的偏差只进 warnings 不阻塞（真实真题可能微调）。
 */
import { REMOTE_FILES, SECTION_META } from '@/constants';
import { db, markDirty, toDbError } from '@/db';
import { AppError } from '@/lib/errors';
import { invalidateCorpusIndex } from '@/lib/search/corpusIndex';
import { now } from '@/lib/time';
import type { Exam, Passage, Question, SectionType } from '@/types';

const EXAM_INDEX_ENTITY = REMOTE_FILES.examIndex;

/** 标准卷结构（PRD 4.3.1，唯一事实源）：口语 10×1 / 词汇 10×1 / 阅读 25×1 / 完形 10×1 / 短文完成 20×1 / 英译汉 1×10 / 写作 1×15 */
export interface StandardSectionSpec {
  readonly type: SectionType;
  readonly questionCount: number;
  readonly perQuestionScore: number;
}

export const STANDARD_PAPER_STRUCTURE: readonly StandardSectionSpec[] = [
  { type: 'dialogue', questionCount: 10, perQuestionScore: 1 },
  { type: 'vocabulary', questionCount: 10, perQuestionScore: 1 },
  { type: 'reading', questionCount: 25, perQuestionScore: 1 },
  { type: 'cloze', questionCount: 10, perQuestionScore: 1 },
  { type: 'short-completion', questionCount: 20, perQuestionScore: 1 },
  { type: 'translation', questionCount: 1, perQuestionScore: 10 },
  { type: 'writing', questionCount: 1, perQuestionScore: 15 },
];

/** 分值合计浮点比较容差 */
const EPSILON = 1e-9;

/** savePaper 的返回：warnings 为「不阻塞保存的结构告警」（真实真题可能微调） */
export interface SavePaperResult {
  readonly warnings: readonly string[];
}

/** 新建或整体覆盖一份试卷 */
export async function upsertExam(exam: Exam): Promise<void> {
  try {
    await db.transaction('rw', db.exams, db.syncMeta, async () => {
      await db.exams.put(exam);
      await markDirty(EXAM_INDEX_ENTITY, 1);
    });
    invalidateCorpusIndex();
  } catch (error) {
    throw toDbError(error);
  }
}

/** 取试卷 */
export async function getExam(id: string): Promise<Exam | undefined> {
  return db.exams.get(id);
}

/** 列出全部试卷（未删除，按创建时间倒序） */
export async function listExams(): Promise<Exam[]> {
  const exams = await db.exams.toArray();
  return exams
    .filter((exam) => exam.deletedAt === null)
    .sort((left, right) => right.createdAt - left.createdAt);
}

/** 软删除试卷（同时软删其文章与题目） */
export async function softDeleteExam(id: string): Promise<void> {
  try {
    await db.transaction('rw', db.exams, db.passages, db.questions, db.syncMeta, async () => {
      const stamp = now();
      const exam = await db.exams.get(id);
      if (exam) {
        await db.exams.put({ ...exam, deletedAt: stamp, updatedAt: stamp });
      }
      const passages = await db.passages.where('paperId').equals(id).toArray();
      if (passages.length > 0) {
        await db.passages.bulkPut(
          passages.map((passage) => ({ ...passage, deletedAt: stamp, updatedAt: stamp })),
        );
      }
      const questions = await db.questions.where('paperId').equals(id).toArray();
      if (questions.length > 0) {
        await db.questions.bulkPut(
          questions.map((question) => ({ ...question, deletedAt: stamp, updatedAt: stamp })),
        );
      }
      await markDirty(EXAM_INDEX_ENTITY, 1);
      await markDirty(REMOTE_FILES.exam(id), 1 + passages.length + questions.length);
    });
    invalidateCorpusIndex();
  } catch (error) {
    throw toDbError(error);
  }
}

/** 批量写入/更新文章 */
export async function putPassages(paperId: string, passages: Passage[]): Promise<void> {
  if (passages.length === 0) {
    return;
  }
  try {
    await db.transaction('rw', db.passages, db.syncMeta, async () => {
      await db.passages.bulkPut(passages);
      await markDirty(REMOTE_FILES.exam(paperId), passages.length);
    });
    invalidateCorpusIndex();
  } catch (error) {
    throw toDbError(error);
  }
}

/** 批量写入/更新题目 */
export async function putQuestions(paperId: string, questions: Question[]): Promise<void> {
  if (questions.length === 0) {
    return;
  }
  try {
    await db.transaction('rw', db.questions, db.syncMeta, async () => {
      await db.questions.bulkPut(questions);
      await markDirty(REMOTE_FILES.exam(paperId), questions.length);
    });
    invalidateCorpusIndex();
  } catch (error) {
    throw toDbError(error);
  }
}

/** 取某份试卷的文章（按区段内顺序升序） */
export async function getPassages(paperId: string): Promise<Passage[]> {
  const passages = await db.passages.where('paperId').equals(paperId).toArray();
  return passages
    .filter((passage) => passage.deletedAt === null)
    .sort((left, right) => left.order - right.order);
}

/** 取某份试卷的题目（按全卷序号升序） */
export async function getQuestions(paperId: string): Promise<Question[]> {
  const questions = await db.questions.where('paperId').equals(paperId).toArray();
  return questions
    .filter((question) => question.deletedAt === null)
    .sort((left, right) => left.seq - right.seq);
}

/** 一次性取回试卷 + 文章 + 题目（渲染用） */
export async function getPaperDetail(paperId: string): Promise<{
  exam: Exam | undefined;
  passages: Passage[];
  questions: Question[];
}> {
  const [exam, passages, questions] = await Promise.all([
    getExam(paperId),
    getPassages(paperId),
    getQuestions(paperId),
  ]);
  return { exam, passages, questions };
}

/** 试卷总数（未删除） */
export async function countExams(): Promise<number> {
  const exams = await db.exams.toArray();
  return exams.filter((exam) => exam.deletedAt === null).length;
}

/**
 * 整卷结构校验（T11）。
 *
 * - **阻塞**：各区段分值合计 ≠ 试卷总分 → 抛 `AppError('EXAM_SCORE_MISMATCH')`
 *   （这是数据自洽性问题，绝不允许落库）；
 * - **仅告警**：区段题量/分值与 PRD 4.3.1 标准结构不一致、区段题量与实际题目数不符、
 *   序号不连续等——真实真题可能微调结构，只提示不阻塞。
 *
 * 纯函数，在事务开启前调用：校验失败时一行都未写入，天然「无残留」。
 */
export function validatePaper(exam: Exam, passages: Passage[], questions: Question[]): string[] {
  const warnings: string[] = [];

  // 1. 阻塞项：区段分值合计 = 试卷总分
  let sectionSum = 0;
  for (const section of exam.sections) {
    if (typeof section.score !== 'number' || !Number.isFinite(section.score) || section.score < 0) {
      throw new AppError('EXAM_SCORE_MISMATCH', {
        paperId: exam.id,
        totalScore: exam.totalScore,
        sectionSum,
        detail: `区段「${SECTION_META[section.type]?.name ?? section.type}」分值非法：${String(section.score)}`,
      });
    }
    sectionSum += section.score;
  }
  if (Math.abs(sectionSum - exam.totalScore) > EPSILON) {
    throw new AppError('EXAM_SCORE_MISMATCH', {
      paperId: exam.id,
      totalScore: exam.totalScore,
      sectionSum,
    });
  }

  const activeQuestions = questions.filter((question) => question.deletedAt === null);

  // 2. 逐区段：题量、题目分值合计、与标准结构的偏差
  for (const section of exam.sections) {
    const name = SECTION_META[section.type]?.name ?? section.type;
    const inSection = activeQuestions.filter((question) => question.sectionType === section.type);
    if (inSection.length !== section.questionCount) {
      warnings.push(
        `区段「${name}」实际题量 ${inSection.length} 与声明的 ${section.questionCount} 不一致。`,
      );
    }
    const questionScoreSum = inSection.reduce((sum, question) => sum + question.score, 0);
    if (Math.abs(questionScoreSum - section.score) > EPSILON) {
      warnings.push(
        `区段「${name}」题目分值合计 ${questionScoreSum} 与区段总分 ${section.score} 不一致。`,
      );
    }
    const standard = STANDARD_PAPER_STRUCTURE.find((spec) => spec.type === section.type);
    if (standard) {
      const standardScore = standard.questionCount * standard.perQuestionScore;
      if (section.questionCount !== standard.questionCount || Math.abs(section.score - standardScore) > EPSILON) {
        warnings.push(
          `区段「${name}」为 ${section.questionCount} 题 ${section.score} 分，与标准结构 ${standard.questionCount} 题 ${standardScore} 分不一致（真实真题可能微调，仅提示）。`,
        );
      }
    }
    const sectionPassages = passages.filter(
      (passage) => passage.sectionType === section.type && passage.deletedAt === null,
    );
    if (section.passageIds.length !== sectionPassages.length) {
      warnings.push(
        `区段「${name}」声明的文章数 ${section.passageIds.length} 与实际 ${sectionPassages.length} 篇不一致。`,
      );
    }
  }

  // 3. 序号唯一且连续（1..N）
  const seqs = activeQuestions.map((question) => question.seq).sort((left, right) => left - right);
  seqs.forEach((seq, index) => {
    if (seq !== index + 1) {
      warnings.push(`题目序号应为连续 1..${seqs.length}，第 ${index + 1} 位实际是 ${seq}。`);
    }
  });

  return warnings;
}

/**
 * 整卷事务写入（T11）：Exam + Passage[] + Question[] 在同一事务内落库。
 *
 * - 写入前先 `validatePaper()`：分值合计不符直接抛 `EXAM_SCORE_MISMATCH`，
 *   此时事务尚未开启，数据库不会有任何残留；
 * - 覆盖保存：本次未携带的既有文章/题目写墓碑（deletedAt），
 *   避免远端同步把旧行「复活」（C4）；
 * - 返回 warnings（不阻塞的结构告警），UI 可酌情展示。
 */
export async function savePaper(
  exam: Exam,
  passages: Passage[],
  questions: Question[],
): Promise<SavePaperResult> {
  const warnings = validatePaper(exam, passages, questions);
  const stamp = now();
  const examNext: Exam = {
    ...exam,
    totalQuestions: questions.filter((question) => question.deletedAt === null).length,
    updatedAt: stamp,
  };
  try {
    await db.transaction('rw', db.exams, db.passages, db.questions, db.syncMeta, async () => {
      const keptPassageIds = new Set(passages.map((passage) => passage.id));
      const oldPassages = await db.passages.where('paperId').equals(exam.id).toArray();
      const stalePassages = oldPassages.filter(
        (passage) => passage.deletedAt === null && !keptPassageIds.has(passage.id),
      );
      if (stalePassages.length > 0) {
        await db.passages.bulkPut(
          stalePassages.map((passage) => ({ ...passage, deletedAt: stamp, updatedAt: stamp })),
        );
      }
      const keptQuestionIds = new Set(questions.map((question) => question.id));
      const oldQuestions = await db.questions.where('paperId').equals(exam.id).toArray();
      const staleQuestions = oldQuestions.filter(
        (question) => question.deletedAt === null && !keptQuestionIds.has(question.id),
      );
      if (staleQuestions.length > 0) {
        await db.questions.bulkPut(
          staleQuestions.map((question) => ({ ...question, deletedAt: stamp, updatedAt: stamp })),
        );
      }
      await db.exams.put(examNext);
      if (passages.length > 0) {
        await db.passages.bulkPut(passages);
      }
      if (questions.length > 0) {
        await db.questions.bulkPut(questions);
      }
      await markDirty(EXAM_INDEX_ENTITY, 1);
      await markDirty(REMOTE_FILES.exam(exam.id), 1 + passages.length + questions.length);
    });
    invalidateCorpusIndex();
  } catch (error) {
    throw toDbError(error);
  }
  return { warnings };
}
