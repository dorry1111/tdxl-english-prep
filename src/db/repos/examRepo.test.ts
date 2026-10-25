/**
 * examRepo.savePaper / getPaperDetail 单测（T11 验收标准 6 + 事务无残留）。
 *
 * 跑在 fake-indexeddb 上，验证：
 * - 分值合计不符 → AppError('EXAM_SCORE_MISMATCH') 且数据库无任何残留；
 * - 结构与标准卷的偏差只进 warnings 不阻塞；
 * - 覆盖保存时旧行写墓碑。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { REMOTE_FILES } from '@/constants';
import { db } from '@/db';
import { getPaperDetail, savePaper, validatePaper } from '@/db/repos/examRepo';
import { AppError } from '@/lib/errors';
import type { Exam, Passage, Question, Section, SectionType } from '@/types';

const STAMP = 1_700_000_000_000;
const PAPER_ID = 'paper-t11';

/** 区段计划：题型 / 题量 / 每题分值（PRD 4.3.1） */
const PLAN: ReadonlyArray<readonly [SectionType, number, number]> = [
  ['dialogue', 10, 1],
  ['vocabulary', 10, 1],
  ['reading', 25, 1],
  ['cloze', 10, 1],
  ['short-completion', 20, 1],
  ['translation', 1, 10],
  ['writing', 1, 15],
];

function isSubjective(type: SectionType): boolean {
  return type === 'translation' || type === 'writing';
}

function buildQuestions(paperId: string): Question[] {
  const questions: Question[] = [];
  let seq = 0;
  for (const [sectionType, count, score] of PLAN) {
    for (let i = 0; i < count; i += 1) {
      seq += 1;
      const subjective = isSubjective(sectionType);
      questions.push({
        id: `${paperId}:q${seq}`,
        paperId,
        sectionType,
        passageId: null,
        seq,
        stem: `第 ${seq} 题`,
        blankIndex: null,
        options: subjective ? [] : [
          { key: 'A', text: 'A' },
          { key: 'B', text: 'B' },
          { key: 'C', text: 'C' },
          { key: 'D', text: 'D' },
        ],
        answerKey: subjective ? null : 'A',
        referenceAnswer: subjective ? `参考 ${seq}` : null,
        explanation: '',
        score,
        isObjective: !subjective,
        updatedAt: STAMP,
        deletedAt: null,
      });
    }
  }
  return questions;
}

function buildExam(sections: Section[], totalScore: number, totalQuestions: number): Exam {
  return {
    id: PAPER_ID,
    title: 'T11 测试卷',
    source: 'manual',
    sections,
    totalQuestions,
    totalScore,
    timeLimitSec: 9000,
    parseStatus: 'verified',
    createdAt: STAMP,
    updatedAt: STAMP,
    deletedAt: null,
  };
}

/** 标准卷：77 题、总分 100 */
function buildStandardPaper(): { exam: Exam; passages: Passage[]; questions: Question[] } {
  const questions = buildQuestions(PAPER_ID);
  const sections: Section[] = PLAN.map(([type, questionCount, perScore], index) => ({
    type,
    order: index + 1,
    score: questionCount * perScore,
    questionCount,
    passageIds: [],
  }));
  return { exam: buildExam(sections, 100, questions.length), passages: [], questions };
}

describe('savePaper', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it('标准卷整卷写入成功，warnings 为空，脏标记正确', async () => {
    const { exam, passages, questions } = buildStandardPaper();
    const { warnings } = await savePaper(exam, passages, questions);
    expect(warnings).toEqual([]);
    expect(await db.exams.count()).toBe(1);
    expect(await db.questions.where('paperId').equals(PAPER_ID).count()).toBe(77);
    const indexMeta = await db.syncMeta.get(REMOTE_FILES.examIndex);
    const paperMeta = await db.syncMeta.get(REMOTE_FILES.exam(PAPER_ID));
    expect(indexMeta?.pendingCount).toBe(1);
    expect(paperMeta?.pendingCount).toBe(1 + passages.length + questions.length);
  });

  it('区段分值合计 ≠ 试卷总分 → 抛 EXAM_SCORE_MISMATCH 且数据库无残留', async () => {
    const { exam, passages, questions } = buildStandardPaper();
    const broken: Exam = { ...exam, totalScore: 99 };
    await expect(savePaper(broken, passages, questions)).rejects.toMatchObject({
      name: 'AppError',
      code: 'EXAM_SCORE_MISMATCH',
    });
    // 无残留：试卷、文章、题目、同步脏标记全部为空
    expect(await db.exams.count()).toBe(0);
    expect(await db.passages.count()).toBe(0);
    expect(await db.questions.count()).toBe(0);
    expect(await db.syncMeta.count()).toBe(0);
  });

  it('AppError 不被 toDbError 二次包装，code 原样保留', async () => {
    const { exam, passages, questions } = buildStandardPaper();
    const broken: Exam = { ...exam, totalScore: 50 };
    try {
      await savePaper(broken, passages, questions);
      expect.unreachable('应当抛出异常');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('EXAM_SCORE_MISMATCH');
      expect((error as AppError).detail).toMatchObject({ sectionSum: 100, totalScore: 50 });
    }
  });

  it('真实真题微调（阅读 26 题/101 分）→ 只给 warning 不阻塞，正常落库', async () => {
    const { exam, passages, questions } = buildStandardPaper();
    // 追加一道阅读题（seq 78，保持序号连续），分值结构整体 +1
    questions.push({
      id: `${PAPER_ID}:q78`,
      paperId: PAPER_ID,
      sectionType: 'reading',
      passageId: null,
      seq: 78,
      stem: '附加题',
      blankIndex: null,
      options: [
        { key: 'A', text: 'A' },
        { key: 'B', text: 'B' },
      ],
      answerKey: 'B',
      referenceAnswer: null,
      explanation: '',
      score: 1,
      isObjective: true,
      updatedAt: STAMP,
      deletedAt: null,
    });
    const sections = exam.sections.map((section) =>
      section.type === 'reading' ? { ...section, questionCount: 26, score: 26 } : section,
    );
    const adjusted: Exam = { ...exam, sections, totalScore: 101, totalQuestions: 78 };
    const { warnings } = await savePaper(adjusted, passages, questions);
    expect(warnings.some((message) => message.includes('阅读理解') && message.includes('标准结构'))).toBe(true);
    expect(await db.exams.count()).toBe(1);
    expect(await db.questions.where('paperId').equals(PAPER_ID).count()).toBe(78);
    const saved = await db.exams.get(PAPER_ID);
    expect(saved?.totalQuestions).toBe(78);
  });

  it('覆盖保存时，本次未携带的旧题目写墓碑而非物理删除', async () => {
    const { exam, passages, questions } = buildStandardPaper();
    await savePaper(exam, passages, questions);
    // 第二次只保留前 70 题（序号 1..70）
    const trimmed = questions.filter((question) => question.seq <= 70);
    await savePaper(exam, passages, trimmed);
    const all = await db.questions.where('paperId').equals(PAPER_ID).toArray();
    expect(all).toHaveLength(77);
    const tombstones = all.filter((question) => question.deletedAt !== null);
    expect(tombstones).toHaveLength(7);
    expect(tombstones.every((question) => question.seq > 70)).toBe(true);
    const detail = await getPaperDetail(PAPER_ID);
    expect(detail.questions).toHaveLength(70);
    expect(detail.exam?.totalQuestions).toBe(70);
  });

  it('getPaperDetail 一次取回 exam + passages + questions（题目按 seq 升序）', async () => {
    const { exam, passages, questions } = buildStandardPaper();
    await savePaper(exam, passages, questions);
    const detail = await getPaperDetail(PAPER_ID);
    expect(detail.exam?.id).toBe(PAPER_ID);
    expect(detail.questions).toHaveLength(77);
    expect(detail.questions[0]?.seq).toBe(1);
    expect(detail.questions[76]?.seq).toBe(77);
    const seqs = detail.questions.map((question) => question.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });
});

describe('validatePaper（纯校验）', () => {
  it('序号不连续 → warning；区段题量与实际不符 → warning', () => {
    const { exam, passages, questions } = buildStandardPaper();
    // 删掉一道口语题（题量 9 ≠ 声明 10），并把第 5 题序号改成 999（序号不连续）
    const mutated = questions
      .filter((question) => !(question.sectionType === 'dialogue' && question.seq === 1))
      .map((question) => (question.seq === 5 ? { ...question, seq: 999 } : question));
    const warnings = validatePaper(exam, passages, mutated);
    expect(warnings.some((message) => message.includes('连续'))).toBe(true);
    expect(warnings.some((message) => message.includes('口语交际') && message.includes('题量'))).toBe(true);
  });
});
