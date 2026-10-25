/**
 * gradeAttempt 单测（T11 验收标准 1~4）。
 *
 * 用一张标准卷（75 客观 + 2 主观、满分 100）覆盖：
 * 全对 / 错 5 题 / 客观题与主观题的分界 / 未作答按答错处理。
 */
import { describe, expect, it } from 'vitest';

import { gradeAttempt, objectiveFullScore, pendingAnswerQuestions } from '@/lib/exam/grade';
import type { AttemptAnswer, Question, SectionType } from '@/types';

const STAMP = 1_700_000_000_000;
const OPTION_KEYS = ['A', 'B', 'C', 'D'] as const;

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

/** 构造标准 77 题（序号 1..77 连续） */
function buildStandardQuestions(): Question[] {
  const questions: Question[] = [];
  let seq = 0;
  for (const [sectionType, count, score] of PLAN) {
    for (let i = 0; i < count; i += 1) {
      seq += 1;
      const subjective = isSubjective(sectionType);
      questions.push({
        id: `q${seq}`,
        paperId: 'paper-grade',
        sectionType,
        passageId: null,
        seq,
        stem: `第 ${seq} 题`,
        blankIndex: null,
        options: subjective ? [] : OPTION_KEYS.map((key) => ({ key, text: `选项 ${key}` })),
        answerKey: subjective ? null : 'A',
        referenceAnswer: subjective ? `参考答案 ${seq}` : null,
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

function makeAnswer(question: Question, choice: string | null, text: string | null = null): AttemptAnswer {
  return {
    id: `a-${question.id}`,
    attemptId: 'attempt-1',
    questionId: question.id,
    choice,
    text,
    isCorrect: null,
    flagged: false,
    selfScore: null,
    answeredAt: STAMP,
  };
}

describe('gradeAttempt', () => {
  it('标准卷 75 道客观题全部答对 → objectiveScore === 75、wrongQuestionIds 为空', () => {
    const questions = buildStandardQuestions();
    const answers = questions.map((question) =>
      makeAnswer(question, question.isObjective ? 'A' : null, question.isObjective ? null : '作答'),
    );
    const result = gradeAttempt(questions, answers);
    expect(result.objectiveScore).toBe(75);
    expect(result.correctCount).toBe(75);
    expect(result.wrongQuestionIds).toEqual([]);
    expect(result.totalScore).toBe(100);
  });

  it('同一张卷故意错 5 题 → objectiveScore === 70、wrongQuestionIds.length === 5', () => {
    const questions = buildStandardQuestions();
    const answers = questions.map((question) => makeAnswer(question, 'A', question.isObjective ? null : '作答'));
    // 把第 1、11、21、46、56 题（均为客观题）答错
    const wrongSeqs = new Set([1, 11, 21, 46, 56]);
    for (const answer of answers) {
      const seq = Number(answer.questionId.slice(1));
      if (wrongSeqs.has(seq)) {
        answer.choice = 'D';
      }
    }
    const result = gradeAttempt(questions, answers);
    expect(result.objectiveScore).toBe(70);
    expect(result.correctCount).toBe(70);
    expect(result.wrongQuestionIds).toHaveLength(5);
    expect(result.wrongQuestionIds.sort()).toEqual(
      [...wrongSeqs].map((seq) => `q${seq}`).sort(),
    );
  });

  it('整卷 77 题（含 2 道主观题）→ objectiveScore 只算 75 道客观题，totalScore 为满分 100', () => {
    const questions = buildStandardQuestions();
    const answers = questions.map((question) =>
      makeAnswer(question, question.isObjective ? 'A' : null, question.isObjective ? null : '译文/作文'),
    );
    const result = gradeAttempt(questions, answers);
    expect(result.objectiveScore).toBe(75);
    expect(result.totalScore).toBe(100);
    expect(result.perQuestion).toHaveLength(77);
  });

  it('主观题 isCorrect === null、earned 为 0，不计入 objectiveScore 也不进错题本', () => {
    const questions = buildStandardQuestions();
    const answers = questions.map((question) =>
      makeAnswer(question, question.isObjective ? 'A' : null, question.isObjective ? null : '作答内容'),
    );
    const result = gradeAttempt(questions, answers);
    const subjectiveIds = questions
      .filter((question) => !question.isObjective)
      .map((question) => question.id);
    for (const entry of result.perQuestion) {
      if (subjectiveIds.includes(entry.questionId)) {
        expect(entry.isCorrect).toBeNull();
        expect(entry.earned).toBe(0);
      }
    }
    expect(result.wrongQuestionIds).toEqual([]);
  });

  it('未作答的客观题按答错处理（earned 0、进错题本），answeredCount 只数有内容的题', () => {
    const questions = buildStandardQuestions();
    const answers = questions
      .filter((question) => question.seq > 3) // 前 3 道客观题不交答案
      .map((question) =>
        makeAnswer(question, question.isObjective ? 'A' : null, question.isObjective ? null : '作答'),
      );
    const result = gradeAttempt(questions, answers);
    expect(result.objectiveScore).toBe(72);
    expect(result.answeredCount).toBe(74);
    expect(result.correctCount).toBe(72);
    expect(result.wrongQuestionIds).toEqual(['q1', 'q2', 'q3']);
  });

  it('空白作答（choice/text 为空串）视同未作答', () => {
    const questions = buildStandardQuestions().slice(0, 2);
    const answers = [
      makeAnswer(questions[0] as Question, ''),
      makeAnswer(questions[1] as Question, null, '   '),
    ];
    const result = gradeAttempt(questions, answers);
    expect(result.answeredCount).toBe(0);
    expect(result.objectiveScore).toBe(0);
    expect(result.wrongQuestionIds).toEqual(['q1', 'q2']);
  });

  it('answers 中包含未知 questionId 时不影响判分', () => {
    const questions = buildStandardQuestions().slice(0, 1);
    const answers = [
      makeAnswer(questions[0] as Question, 'A'),
      {
        ...makeAnswer(questions[0] as Question, 'B'),
        id: 'a-ghost',
        questionId: 'q-ghost',
      },
    ];
    const result = gradeAttempt(questions, answers);
    expect(result.objectiveScore).toBe(1);
    expect(result.wrongQuestionIds).toEqual([]);
  });
});

describe('回忆版无答案客观题口径（objectiveFullScore / pendingAnswerQuestions）', () => {
  /** 构造一份回忆版卷：客观题 11-55 无答案（模拟 2023-2025 内置卷） */
  function buildRecalledQuestions(): Question[] {
    const questions = buildStandardQuestions();
    for (const question of questions) {
      // 口语 1-10 与短文完成 56-75 保留答案，词汇/阅读/完形 11-55 缺答案
      if (question.seq >= 11 && question.seq <= 55) {
        question.answerKey = null;
      }
    }
    return questions;
  }

  it('objectiveFullScore 剔除无答案客观题：客观满分 75 → 30', () => {
    const questions = buildRecalledQuestions();
    expect(objectiveFullScore(questions)).toBe(30);
    // 标准卷不受影响
    expect(objectiveFullScore(buildStandardQuestions())).toBe(75);
  });

  it('pendingAnswerQuestions 数出全部无答案客观题（45 题）', () => {
    const pending = pendingAnswerQuestions(buildRecalledQuestions());
    expect(pending).toHaveLength(45);
    expect(pending.every((question) => question.isObjective && question.answerKey === null)).toBe(
      true,
    );
    expect(pendingAnswerQuestions(buildStandardQuestions())).toHaveLength(0);
  });

  it('无答案客观题作答也永不判分：isCorrect=null、earned=0、不进错题本、不计正确数', () => {
    const questions = buildRecalledQuestions();
    const answers = questions.map((question) =>
      makeAnswer(question, question.isObjective ? 'A' : null, question.isObjective ? null : '作答'),
    );
    const result = gradeAttempt(questions, answers);
    // 客观分只来自有答案的 30 题
    expect(result.objectiveScore).toBe(30);
    expect(result.correctCount).toBe(30);
    // 无答案题作答不进错题本
    const pendingIds = new Set(pendingAnswerQuestions(questions).map((question) => question.id));
    for (const item of result.perQuestion) {
      if (pendingIds.has(item.questionId)) {
        expect(item.isCorrect).toBeNull();
        expect(item.earned).toBe(0);
        expect(result.wrongQuestionIds).not.toContain(item.questionId);
      }
    }
  });
});
