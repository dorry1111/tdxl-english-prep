/**
 * P13 组卷页（T14）：整卷 / 专项。
 *
 * - 整卷：整卷题集 + 试卷限时（timeLimitSec）；
 * - 专项：题型 + 题量（10/20/30/全部）+ 限时开关（限时 = 题量 × 每题 60s），
 *   pickDrillQuestions 确定性抽题；
 * - 未校对 / 缺答案的卷不再拦截：开考前弹一次确认框说明后果，确认后照常开考
 *   （缺答案的客观题由判分逻辑自动剔除，不计入分母）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import {
  ACTIONS,
  DRILL_COUNT_OPTIONS,
  DRILL_TIME_PER_QUESTION_SEC,
  EXAMS,
  ROUTES,
  SECTION_META,
  SECTION_TYPES_BY_ORDER,
} from '@/constants';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { getPaperDetail } from '@/db/repos/examRepo';
import { pickDrillQuestions } from '@/lib/exam/drill';
import { useAttemptStore } from '@/store/attemptStore';
import { useUiStore } from '@/store/uiStore';
import type { Exam, Question, SectionType } from '@/types';

type StartMode = 'full' | 'section';

export default function ExamStartPage() {
  const params = useParams<{ id: string }>();
  const paperId = params.id ?? '';
  const navigate = useNavigate();
  const toastError = useUiStore((state) => state.toast.error);
  const toastInfo = useUiStore((state) => state.toast.info);
  const startAttempt = useAttemptStore((state) => state.start);

  const [exam, setExam] = useState<Exam | null>(null);
  const [paperPassages, setPaperPassages] = useState<Awaited<ReturnType<typeof getPaperDetail>>['passages']>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);

  const [mode, setMode] = useState<StartMode>('full');
  const [sectionType, setSectionType] = useState<SectionType>('dialogue');
  const [count, setCount] = useState<number | 'all'>(10);
  const [timed, setTimed] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getPaperDetail(paperId).then((detail) => {
      if (cancelled) {
        return;
      }
      if (detail.exam) {
        setExam(detail.exam);
        setPaperPassages(detail.passages);
        setQuestions(detail.questions);
        const firstPool = SECTION_TYPES_BY_ORDER.find(
          (type) => detail.questions.some((question) => question.sectionType === type),
        );
        if (firstPool) {
          setSectionType(firstPool);
        }
      }
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  /** 缺答案的客观题数（回忆版卷常见；开考前提示用） */
  const missingAnswers = useMemo(
    () => questions.filter((question) => question.isObjective && question.answerKey === null).length,
    [questions],
  );
  /** 需要开考前确认：未校对，或存在缺答案客观题 */
  const needConfirm = exam !== null && (exam.parseStatus !== 'verified' || missingAnswers > 0);

  const startNow = useCallback(async () => {
    if (!exam) {
      return;
    }
    const picked =
      mode === 'full'
        ? questions
        : pickDrillQuestions(
            questions,
            sectionType,
            count === 'all' ? questions.length : count,
            Date.now() % 2147483647,
          );
    if (picked.length === 0) {
      toastError(EXAMS.manualEmpty);
      return;
    }
    if (mode === 'section' && count !== 'all') {
      const pool = questions.filter((question) => question.sectionType === sectionType).length;
      if (picked.length < count && pool > picked.length) {
        toastInfo(EXAMS.poolTooSmall(pool));
      }
    }
    const timeLimitSec =
      mode === 'full'
        ? exam.timeLimitSec
        : timed
          ? picked.length * DRILL_TIME_PER_QUESTION_SEC
          : null;
    try {
      const attemptId = await startAttempt({
        exam,
        passages: paperPassages,
        questions: picked,
        mode,
        sectionType: mode === 'full' ? null : sectionType,
        timeLimitSec,
      });
      navigate(ROUTES.attempt.replace(':id', attemptId));
    } catch {
      toastError(EXAMS.startBlocked);
    }
  }, [count, exam, mode, navigate, paperPassages, questions, sectionType, startAttempt, timed, toastError, toastInfo]);

  /** 需要确认的先弹框，确认后才真正开考 */
  const begin = useCallback(() => {
    if (needConfirm) {
      setPendingConfirm(true);
      return;
    }
    void startNow();
  }, [needConfirm, startNow]);

  if (!loaded) {
    return (
      <Card title={EXAMS.startTitle}>
        <p className="text-sm text-text-2">{EXAMS.jsonReading}</p>
      </Card>
    );
  }
  if (!exam) {
    return (
      <Card title={EXAMS.startTitle}>
        <p className="text-sm text-text-2">{EXAMS.emptyTitle}</p>
      </Card>
    );
  }

  const poolCount = questions.filter((question) => question.sectionType === sectionType).length;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-text">{EXAMS.startTitle}</h1>
      <Card>
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-text">{exam.title}</h2>
          <p className="text-sm text-text-2">
            {EXAMS.fullDesc(exam.totalQuestions, exam.totalScore, Math.round(exam.timeLimitSec / 60))}
          </p>
        </div>
      </Card>

      <SegmentedControl<StartMode>
        ariaLabel={EXAMS.startTitle}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'full', label: EXAMS.modeFull },
          { value: 'section', label: EXAMS.modeSection },
        ]}
      />

      {mode === 'section' ? (
        <Card title={EXAMS.modeSection}>
          <div className="flex flex-col gap-4">
            {/* 题型 */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-text-2">{EXAMS.sectionTypeLabel}</span>
              <div className="grid grid-cols-2 gap-2 tablet:grid-cols-4">
                {SECTION_TYPES_BY_ORDER.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSectionType(type)}
                    aria-pressed={sectionType === type}
                    className={`app-tappable min-h-[44px] rounded-md border px-3 text-sm font-medium ${
                      sectionType === type
                        ? 'border-primary bg-primary-soft text-text'
                        : 'border-border bg-surface text-text-2'
                    }`}
                  >
                    {SECTION_META[type].name}
                  </button>
                ))}
              </div>
            </div>
            {/* 题量 */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-text-2">{EXAMS.sectionCountLabel}</span>
              <div className="flex flex-wrap gap-2">
                {DRILL_COUNT_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCount(value)}
                    aria-pressed={count === value}
                    className={`app-tappable min-h-[44px] rounded-md border px-3 text-sm font-medium ${
                      count === value
                        ? 'border-primary bg-primary-soft text-text'
                        : 'border-border bg-surface text-text-2'
                    }`}
                  >
                    {value}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCount('all')}
                  aria-pressed={count === 'all'}
                  className={`app-tappable min-h-[44px] rounded-md border px-3 text-sm font-medium ${
                    count === 'all'
                      ? 'border-primary bg-primary-soft text-text'
                      : 'border-border bg-surface text-text-2'
                  }`}
                >
                  {EXAMS.countAll}
                </button>
              </div>
            </div>
            {/* 限时 */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-2">{EXAMS.sectionTimedLabel}</span>
              <button
                type="button"
                onClick={() => setTimed((prev) => !prev)}
                aria-pressed={timed}
                className={`app-tappable min-h-[44px] rounded-md border px-3 text-sm font-medium ${
                  timed
                    ? 'border-primary bg-primary-soft text-text'
                    : 'border-border bg-surface text-text-2'
                }`}
              >
                {timed ? EXAMS.sectionTimedOn : EXAMS.sectionTimedOff}
              </button>
              {timed ? (
                <span className="text-xs text-text-3">
                  {EXAMS.drillTimeOf(
                    Math.max(
                      1,
                      Math.round(
                        ((count === 'all' ? poolCount : count) * DRILL_TIME_PER_QUESTION_SEC) / 60,
                      ),
                    ),
                  )}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-text-3">
              {count !== 'all' && poolCount < count ? EXAMS.poolTooSmall(poolCount) : null}
            </p>
          </div>
        </Card>
      ) : null}

      <Button block size="lg" onClick={begin}>
        {EXAMS.beginAttempt}
      </Button>

      {/* 开考前确认：未校对 / 缺答案的卷不拦截，只告知后果 */}
      <Dialog
        open={pendingConfirm}
        title={EXAMS.startConfirmTitle}
        onClose={() => setPendingConfirm(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPendingConfirm(false)}>
              {ACTIONS.cancel}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setPendingConfirm(false);
                void startNow();
              }}
            >
              {EXAMS.startConfirmAnyway}
            </Button>
          </div>
        }
      >
        <ul className="flex list-disc flex-col gap-1 ps-4">
          {exam.parseStatus !== 'verified' ? <li>{EXAMS.startConfirmUnverified}</li> : null}
          {missingAnswers > 0 ? <li>{EXAMS.startConfirmMissing(missingAnswers)}</li> : null}
        </ul>
      </Dialog>
    </div>
  );
}
