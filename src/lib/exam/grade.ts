/**
 * 判分引擎（ARCHITECTURE T11 / PRD 4.3.1 S3）。
 *
 * 纯函数，不碰数据库、不取当前时间：
 * - `objectiveScore` 只统计客观题（`isObjective && answerKey !== null`）；
 * - 主观题 `isCorrect = null`、`earned = 0`，既不进客观分也不进错题本，
 *   分数由用户自评（`selfScore`）在仓库层补入；
 * - 未作答的客观题按答错处理（进错题本），保证「跳过的题」也能复习；
 * - `totalScore` 是整卷满分（Σ question.score），不是本次得分；
 *   本次得分 = `objectiveScore` + 自评主观分（成绩单页再合并）；
 * - 回忆版（2023-2025）存在 answerKey=null 的客观题（源文本未提供答案）：
 *   它们永不判分（isCorrect=null、不进错题本），成绩单的客观满分分母
 *   用 `objectiveFullScore` 剔除这类题，`pendingAnswerQuestions` 供「待补答案 N 题」提示。
 */
import type { AttemptAnswer, EntityId, GradingResult, Question } from '@/types';

/**
 * 客观题满分（成绩单客观得分分母）：
 * 只累计 `isObjective && answerKey !== null` 的题目——
 * answerKey=null 的客观题永不判分，计入分母会永远压低得分率。
 */
export function objectiveFullScore(questions: Question[]): number {
  return questions
    .filter((question) => question.isObjective && question.answerKey !== null)
    .reduce((sum, question) => sum + question.score, 0);
}

/** 无答案客观题列表（回忆版源文本未提供答案；用于「待补答案 N 题」提示与徽标） */
export function pendingAnswerQuestions(questions: Question[]): Question[] {
  return questions.filter((question) => question.isObjective && question.answerKey === null);
}

/** 判断一条作答是否含有实际内容（choice 非空串或 text 非空白） */
function hasContent(answer: AttemptAnswer | undefined): boolean {
  if (answer === undefined) {
    return false;
  }
  const choiceFilled = answer.choice !== null && answer.choice.trim() !== '';
  const textFilled = answer.text !== null && answer.text.trim() !== '';
  return choiceFilled || textFilled;
}

/**
 * 给一份题目集合判分。
 *
 * @param questions 参与判分的题目（整卷或专项抽取结果）
 * @param answers   本次答卷的作答明细（可只包含已作答的题）
 */
export function gradeAttempt(questions: Question[], answers: AttemptAnswer[]): GradingResult {
  const answerByQuestionId = new Map<EntityId, AttemptAnswer>();
  for (const answer of answers) {
    answerByQuestionId.set(answer.questionId, answer);
  }

  let objectiveScore = 0;
  let correctCount = 0;
  let answeredCount = 0;
  let totalScore = 0;
  const wrongQuestionIds: EntityId[] = [];
  const perQuestion: GradingResult['perQuestion'] = [];

  for (const question of questions) {
    totalScore += question.score;
    const answer = answerByQuestionId.get(question.id);
    const answered = hasContent(answer);
    if (answered) {
      answeredCount += 1;
    }

    if (question.isObjective && question.answerKey !== null) {
      // 客观题：按 answerKey 精确比对选项字母
      const isCorrect = answered && answer !== undefined && answer.choice === question.answerKey;
      const earned = isCorrect ? question.score : 0;
      if (isCorrect) {
        correctCount += 1;
        objectiveScore += earned;
      } else {
        wrongQuestionIds.push(question.id);
      }
      perQuestion.push({ questionId: question.id, isCorrect, earned });
    } else {
      // 主观题：机器不判分（isCorrect = null），得分由自评补入
      perQuestion.push({ questionId: question.id, isCorrect: null, earned: 0 });
    }
  }

  return {
    objectiveScore,
    totalScore,
    correctCount,
    answeredCount,
    wrongQuestionIds,
    perQuestion,
  };
}
