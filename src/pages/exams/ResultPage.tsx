/**
 * P17 成绩单（T15）。
 *
 * - 三段展示：客观（0~75）/ 主观自评（0~25）/ 总分（0~100）——
 *   分母由题目分值实时汇总，不硬编码；
 * - 用时 / 客观正确率 / 分题型分项；
 * - 主观题自评入口：英译汉 0~10、写作 0~15，提交后
 *   updateAnswer(selfScore) + patchAttempt(subjectiveScore/totalScore) 合并总分。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { EXAMS, ROUTES, SECTION_TYPES_BY_ORDER } from '@/constants';
import { SECTION_META } from '@/constants';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Tag } from '@/components/ui/Tag';
import {
  getAnswers,
  getAttempt,
  patchAttempt,
  updateAnswer,
} from '@/db/repos/attemptRepo';
import { getPaperDetail } from '@/db/repos/examRepo';
import { objectiveFullScore, pendingAnswerQuestions } from '@/lib/exam/grade';
import { fmtDuration } from '@/lib/time';
import { toUserMessage } from '@/lib/errors';
import { SUBJECTIVE_MAX_SCORE } from '@/constants';
import { useUiStore } from '@/store/uiStore';
import type { Attempt, AttemptAnswer, Question } from '@/types';

export default function ResultPage() {
  const params = useParams<{ id: string }>();
  const attemptId = params.id ?? '';
  const navigate = useNavigate();
  const toastError = useUiStore((state) => state.toast.error);
  const toastSuccess = useUiStore((state) => state.toast.success);

  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<AttemptAnswer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selfEval, setSelfEval] = useState<Record<string, number>>({});
  const [savingEval, setSavingEval] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const attemptRow = await getAttempt(attemptId);
      if (cancelled) {
        return;
      }
      if (!attemptRow) {
        setLoaded(true);
        return;
      }
      const detail = await getPaperDetail(attemptRow.paperId);
      const answerRows = await getAnswers(attemptId);
      if (cancelled) {
        return;
      }
      setAttempt(attemptRow);
      setQuestions(detail.questions);
      setAnswers(answerRows);
      // 预填自评
      const prefilled: Record<string, number> = {};
      for (const row of answerRows) {
        if (row.selfScore !== null) {
          prefilled[row.questionId] = row.selfScore;
        }
      }
      setSelfEval(prefilled);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  // 客观满分分母：answerKey=null 的客观题（回忆版源文本未提供答案）永不判分，剔除
  const objectiveFull = useMemo(() => objectiveFullScore(questions), [questions]);
  const pendingAnswers = useMemo(() => pendingAnswerQuestions(questions), [questions]);
  const subjectiveFull = useMemo(
    () =>
      questions
        .filter((question) => !question.isObjective)
        .reduce((sum, question) => sum + question.score, 0),
    [questions],
  );
  const subjectiveQuestions = useMemo(
    () => questions.filter((question) => !question.isObjective),
    [questions],
  );

  /** 分题型分项：得分 / 满分 / 答对数 / 题数 */
  const sectionStats = useMemo(() => {
    const answerByQid = new Map(answers.map((row) => [row.questionId, row]));
    return SECTION_TYPES_BY_ORDER.map((type) => {
      const inSection = questions.filter((question) => question.sectionType === type);
      if (inSection.length === 0) {
        return null;
      }
      let earned = 0;
      let full = 0;
      let correct = 0;
      for (const question of inSection) {
        // 无答案客观题永不判分：不计入区段满分分母与题数分母（口径与整卷一致）
        const gradable = !question.isObjective || question.answerKey !== null;
        if (gradable) {
          full += question.score;
        }
        const row = answerByQid.get(question.id);
        if (question.isObjective && row?.isCorrect === true) {
          earned += question.score;
          correct += 1;
        }
        if (!question.isObjective && row?.selfScore != null) {
          earned += row.selfScore;
        }
      }
      const objectiveCount = inSection.filter(
        (question) => question.isObjective && question.answerKey !== null,
      ).length;
      return { type, earned, full, correct, total: objectiveCount };
    }).filter((item): item is NonNullable<typeof item> => item !== null);
  }, [answers, questions]);

  const objectiveCorrect = useMemo(
    () => answers.filter((row) => row.isCorrect === true).length,
    [answers],
  );
  const objectiveAnswered = useMemo(
    () => answers.filter((row) => row.isCorrect !== null).length,
    [answers],
  );

  /** 提交自评：写 selfScore + 合并 totalScore */
  const submitSelfEval = useCallback(async () => {
    if (!attempt || savingEval) {
      return;
    }
    setSavingEval(true);
    try {
      let subjectiveScore = 0;
      for (const question of subjectiveQuestions) {
        const score = selfEval[question.id];
        if (score === undefined) {
          continue;
        }
        const max =
          question.sectionType === 'translation'
            ? SUBJECTIVE_MAX_SCORE.translation
            : SUBJECTIVE_MAX_SCORE.writing;
        const clamped = Math.min(Math.max(0, Math.round(score)), max);
        const existing = answers.find((row) => row.questionId === question.id);
        const row = existing ?? {
          id: `aa-${attempt.id}-${question.id}`,
          attemptId: attempt.id,
          questionId: question.id,
          choice: null,
          text: null,
          isCorrect: null,
          flagged: false,
          selfScore: null,
          answeredAt: Date.now(),
        };
        await updateAnswer({ ...row, selfScore: clamped });
        subjectiveScore += clamped;
      }
      const next = await patchAttempt(attempt.id, {
        subjectiveScore,
        totalScore: attempt.objectiveScore + subjectiveScore,
      });
      if (next) {
        setAttempt(next);
      }
      setAnswers((prev) =>
        prev.map((row) => {
          const value = selfEval[row.questionId];
          return value !== undefined
            ? { ...row, selfScore: Math.min(Math.max(0, Math.round(value)), 15) }
            : row;
        }),
      );
      toastSuccess(EXAMS.resultSelfEvalSaved);
    } catch (error) {
      toastError(toUserMessage(error));
    } finally {
      setSavingEval(false);
    }
  }, [answers, attempt, savingEval, selfEval, subjectiveQuestions, toastError, toastSuccess]);

  if (!loaded) {
    return (
      <Card title={EXAMS.resultTitle}>
        <p className="text-sm text-text-2">{EXAMS.jsonReading}</p>
      </Card>
    );
  }
  if (!attempt || attempt.submittedAt === null) {
    return (
      <Card title={EXAMS.resultTitle}>
        <p className="text-sm text-text-2">{EXAMS.attemptNotFoundDesc}</p>
      </Card>
    );
  }

  const subjectiveScore = attempt.subjectiveScore ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-text">{EXAMS.resultTitle}</h1>

      {/* 三段分值 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col items-center gap-1 rounded-lg border border-border bg-surface px-2 py-4">
          <span className="text-xs text-text-2">{EXAMS.resultObjective}</span>
          <span className="text-2xl font-semibold tabular-nums text-text">
            {attempt.objectiveScore}
            <span className="text-sm text-text-3">/{objectiveFull}</span>
          </span>
        </div>
        <div className="flex flex-col items-center gap-1 rounded-lg border border-border bg-surface px-2 py-4">
          <span className="text-xs text-text-2">{EXAMS.resultSubjective}</span>
          <span className="text-2xl font-semibold tabular-nums text-text">
            {subjectiveScore}
            <span className="text-sm text-text-3">/{subjectiveFull}</span>
          </span>
        </div>
        <div className="flex flex-col items-center gap-1 rounded-lg border border-primary bg-primary-soft px-2 py-4">
          <span className="text-xs text-text-2">{EXAMS.resultTotal}</span>
          <span className="text-2xl font-semibold tabular-nums text-primary">
            {attempt.totalScore}
            <span className="text-sm text-text-3">/{objectiveFull + subjectiveFull}</span>
          </span>
        </div>
      </div>

      {/* 待补答案提示（回忆版内置卷 2023-2025 客观题缺答案时） */}
      {pendingAnswers.length > 0 ? (
        <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-2">
          {EXAMS.resultPendingAnswers(pendingAnswers.length)}
        </div>
      ) : null}

      {/* 用时 / 正确率 / 模式 */}
      <Card>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="text-text-2">
            {EXAMS.resultDuration}：
            <span className="font-medium text-text">{fmtDuration(attempt.durationSec)}</span>
          </span>
          <span className="text-text-2">
            {EXAMS.resultAccuracy}：
            <span className="font-medium text-text">
              {EXAMS.resultCorrectUnit(objectiveCorrect, Math.max(1, objectiveAnswered))}
            </span>
          </span>
          <Tag>
            {attempt.mode === 'full' ? EXAMS.resultModeFull : EXAMS.resultModeSection}
          </Tag>
        </div>
      </Card>

      {/* 分题型分项 */}
      <Card title={EXAMS.resultSectionBreakdown}>
        <ul className="flex flex-col gap-2">
          {sectionStats.map((item) => (
            <li key={item.type} className="text-sm text-text">
              {EXAMS.resultSectionScore(
                SECTION_META[item.type].name,
                item.earned,
                item.full,
                item.correct,
                item.total,
              )}
            </li>
          ))}
        </ul>
      </Card>

      {/* 主观题自评 */}
      {subjectiveQuestions.length > 0 ? (
        <Card title={EXAMS.resultSelfEvalTitle} action={<span className="text-xs text-text-3">{EXAMS.resultSelfEvalDesc}</span>}>
          <div className="flex flex-col gap-3">
            {subjectiveQuestions.map((question) => {
              const max =
                question.sectionType === 'translation'
                  ? SUBJECTIVE_MAX_SCORE.translation
                  : SUBJECTIVE_MAX_SCORE.writing;
              return (
                <div key={question.id} className="flex items-center gap-2">
                  <label htmlFor={`eval-${question.id}`} className="flex-1 text-sm text-text">
                    {EXAMS.resultSelfEvalOf(SECTION_META[question.sectionType].name, max)}
                  </label>
                  <input
                    id={`eval-${question.id}`}
                    type="number"
                    min={0}
                    max={max}
                    value={selfEval[question.id] ?? ''}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      setSelfEval((prev) => ({
                        ...prev,
                        [question.id]: Number.isFinite(parsed) ? parsed : 0,
                      }));
                    }}
                    className="h-11 w-20 rounded-md border border-border bg-surface px-2 text-center text-base text-text"
                  />
                  <span className="text-xs text-text-3">{EXAMS.resultSelfScore(max)}</span>
                </div>
              );
            })}
            <Button onClick={() => void submitSelfEval()} disabled={savingEval}>
              {EXAMS.resultSelfEvalSave}
            </Button>
          </div>
        </Card>
      ) : null}

      {/* 操作 */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => navigate(ROUTES.attemptReview.replace(':id', attemptId))}>
          {EXAMS.resultViewReview}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => navigate(ROUTES.exams)}>
          {EXAMS.resultBackToExams}
        </Button>
      </div>
    </div>
  );
}
