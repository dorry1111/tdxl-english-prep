/**
 * P20 错题本（T15）。
 *
 * - 待复习错题列表（wrongRepo.listPending）+ 筛选（题型 / 错误次数）；
 * - 单题重做 / 批量重做：attemptStore.start(mode='section'，不限时) → 答题页；
 * - 重做答对 → 交卷时 setResolved(true) 自动移出待复习；
 * - 「已掌握」手动移出。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { EXAMS, ROUTES, SECTION_META, SECTION_TYPES_BY_ORDER, WRONG_REDO_BATCH_LIMIT } from '@/constants';
import { AiResultDialog, type AiDialogState } from '@/components/ai/AiResultDialog';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Tag } from '@/components/ui/Tag';
import { getExam } from '@/db/repos/examRepo';
import { listPending, setResolved } from '@/db/repos/wrongRepo';
import { shuffleSeeded } from '@/lib/exam/drill';
import { IS_DESKTOP } from '@/lib/desktop';
import { AI_NOT_CONFIGURED, runAi } from '@/lib/aiRunner';
import { diagnoseWrong } from '@/lib/llm';
import { fmtDate, now } from '@/lib/time';
import { toUserMessage } from '@/lib/errors';
import { useAttemptStore } from '@/store/attemptStore';
import { useUiStore } from '@/store/uiStore';
import type { Exam, Question, SectionType, WrongItem } from '@/types';

/** AI 诊断最多喂给模型的题数（控制 token 与报告聚焦度） */
const DIAGNOSE_MAX_ITEMS = 50;

export default function WrongBookPage() {
  const navigate = useNavigate();
  const toastError = useUiStore((state) => state.toast.error);
  const toastSuccess = useUiStore((state) => state.toast.success);
  const startAttempt = useAttemptStore((state) => state.start);

  const [items, setItems] = useState<WrongItem[]>([]);
  const [questionById, setQuestionById] = useState<Record<string, Question>>({});
  const [examById, setExamById] = useState<Record<string, Exam>>({});
  const [loaded, setLoaded] = useState(false);
  const [sectionFilter, setSectionFilter] = useState<SectionType | 'all'>('all');
  const [countFilter, setCountFilter] = useState<0 | 2 | 3>(0);
  const [aiDialog, setAiDialog] = useState<{ state: AiDialogState; content: string; error: string } | null>(null);

  const load = useCallback(async () => {
    const pending = await listPending();
    const qids = Array.from(new Set(pending.map((item) => item.questionId)));
    const paperIds = Array.from(new Set(pending.map((item) => item.paperId)));
    const [questions, exams] = await Promise.all([
      Promise.all(qids.map((id) => getQuestionById(id))),
      Promise.all(paperIds.map((id) => getExam(id))),
    ]);
    const qMap: Record<string, Question> = {};
    for (const question of questions) {
      if (question) {
        qMap[question.id] = question;
      }
    }
    const eMap: Record<string, Exam> = {};
    for (const exam of exams) {
      if (exam) {
        eMap[exam.id] = exam;
      }
    }
    setItems(pending);
    setQuestionById(qMap);
    setExamById(eMap);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (sectionFilter !== 'all' && item.sectionType !== sectionFilter) {
        return false;
      }
      if (countFilter !== 0 && item.wrongCount < countFilter) {
        return false;
      }
      return questionById[item.questionId] !== undefined;
    });
  }, [countFilter, items, questionById, sectionFilter]);

  /** 开一次「重做」答题：不限时专项 */
  const redo = useCallback(
    async (redoQuestions: Question[]) => {
      if (redoQuestions.length === 0) {
        return;
      }
      const paperId = redoQuestions[0]?.paperId;
      if (!paperId) {
        return;
      }
      const exam = examById[paperId] ?? (await getExam(paperId));
      if (!exam) {
        toastError(EXAMS.attemptNotFoundDesc);
        return;
      }
      const { getPassages } = await import('@/db/repos/examRepo');
      const passages = await getPassages(paperId);
      const sectionType = redoQuestions.length === 1 ? (redoQuestions[0]?.sectionType ?? null) : null;
      const attemptId = await startAttempt({
        exam,
        passages,
        questions: redoQuestions,
        mode: 'section',
        sectionType,
        timeLimitSec: null,
      });
      navigate(ROUTES.attempt.replace(':id', attemptId));
    },
    [examById, navigate, startAttempt, toastError],
  );

  const redoBatch = useCallback(async () => {
    const redoQuestions = shuffleSeeded(
      filtered
        .map((item) => questionById[item.questionId])
        .filter((question): question is Question => question !== undefined),
      Date.now() % 2147483647,
    ).slice(0, WRONG_REDO_BATCH_LIMIT);
    if (redoQuestions.length === 0) {
      return;
    }
    // 批量重做可能跨试卷：按试卷分组，逐卷各开一次（错题通常集中在一份卷内）
    const byPaper = new Map<string, Question[]>();
    for (const question of redoQuestions) {
      const list = byPaper.get(question.paperId) ?? [];
      list.push(question);
      byPaper.set(question.paperId, list);
    }
    const firstPaper = redoQuestions[0]?.paperId;
    if (firstPaper) {
      const firstList = byPaper.get(firstPaper) ?? [];
      await redo(firstList);
    }
  }, [filtered, questionById, redo]);

  const markResolved = useCallback(
    async (questionId: string) => {
      try {
        await setResolved(questionId, true);
        toastSuccess(EXAMS.wrongResolvedDone);
        await load();
      } catch (error) {
        toastError(toUserMessage(error));
      }
    },
    [load, toastError, toastSuccess],
  );

  // ---------- AI 诊断（桌面独占）：按当前筛选取最近 50 题生成归因报告 ----------
  /** 诊断缓存键：日期 + 筛选条件 + 题数（同键当天复用缓存，不重复计费） */
  const diagnoseRefId = useCallback(
    (): string => {
      const today = fmtDate(now(), 'YYYY-MM-DD');
      return `${today}:${sectionFilter}:${countFilter}:${Math.min(filtered.length, DIAGNOSE_MAX_ITEMS)}`;
    },
    [sectionFilter, countFilter, filtered.length],
  );

  const runDiagnose = useCallback(
    (regenerate: boolean) => {
      const briefs = filtered.slice(0, DIAGNOSE_MAX_ITEMS).map((item) => {
        const question = questionById[item.questionId];
        return {
          sectionType: item.sectionType,
          stem: question?.stem ?? '',
          options: (question?.options ?? []).map((option) => option.text),
          answerIndex:
            question?.answerKey != null
              ? question.options.findIndex((option) => option.key === question.answerKey)
              : -1,
          wrongCount: item.wrongCount,
        };
      });
      if (briefs.length === 0) {
        return;
      }
      setAiDialog({ state: 'loading', content: '', error: '' });
      void (async () => {
        try {
          if (regenerate) {
            const { removeCached } = await import('@/db/repos/llmCacheRepo');
            await removeCached('diagnose', diagnoseRefId());
          }
          const result = await runAi('diagnose', diagnoseRefId(), (config) =>
            diagnoseWrong(config, briefs),
          );
          setAiDialog({ state: 'done', content: result.content, error: '' });
        } catch (error) {
          setAiDialog({
            state: 'error',
            content: '',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    },
    [filtered, questionById, diagnoseRefId],
  );

  if (!loaded) {
    return (
      <Card title={EXAMS.wrongTitle}>
        <p className="text-sm text-text-2">{EXAMS.jsonReading}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-text">{EXAMS.wrongTitle}</h1>
        <div className="ms-auto flex items-center gap-2">
          {IS_DESKTOP ? (
            <Button
              size="sm"
              variant="secondary"
              icon={<Icon name="sparkle" size={16} />}
              onClick={() => runDiagnose(false)}
              disabled={filtered.length === 0}
            >
              {EXAMS.aiDiagnoseButton}
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => void redoBatch()}
            disabled={filtered.length === 0}
          >
            {EXAMS.wrongRedoBatch}
          </Button>
        </div>
      </div>

      {/* 筛选 */}
      <Card bodyClassName="py-3">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1">
            <FilterChip
              active={sectionFilter === 'all'}
              label={EXAMS.wrongCountAll}
              onClick={() => setSectionFilter('all')}
            />
            {SECTION_TYPES_BY_ORDER.map((type) => (
              <FilterChip
                key={type}
                active={sectionFilter === type}
                label={SECTION_META[type].shortName}
                onClick={() => setSectionFilter(type)}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-text-3">{EXAMS.wrongFilterCount}</span>
            <FilterChip active={countFilter === 0} label={EXAMS.wrongCountAll} onClick={() => setCountFilter(0)} />
            <FilterChip active={countFilter === 2} label={EXAMS.wrongCountGte(2)} onClick={() => setCountFilter(2)} />
            <FilterChip active={countFilter === 3} label={EXAMS.wrongCountGte(3)} onClick={() => setCountFilter(3)} />
          </div>
        </div>
      </Card>

      {/* 列表 */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon="exams" title={EXAMS.wrongTitle} description={EXAMS.wrongEmpty} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((item) => {
            const question = questionById[item.questionId];
            if (!question) {
              return null;
            }
            return (
              <li key={item.id}>
                <Card bodyClassName="py-3">
                  <div className="flex items-start gap-2">
                    <span className="w-8 shrink-0 tabular-nums text-sm font-semibold text-text-3">
                      {question.seq}
                    </span>
                    <div className="flex-1">
                      <p className="line-clamp-2 text-sm text-text">{question.stem}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-3">
                        <Tag color={SECTION_META[item.sectionType].color}>
                          {SECTION_META[item.sectionType].name}
                        </Tag>
                        <span>{EXAMS.wrongWrongTimes(item.wrongCount)}</span>
                        <span>
                          {EXAMS.wrongLastAt} {fmtDate(item.lastWrongAt)}
                        </span>
                        <span>{examById[item.paperId]?.title}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <Button size="sm" onClick={() => void redo([question])}>
                        {EXAMS.wrongRedo}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void markResolved(item.questionId)}>
                        {EXAMS.wrongResolvedMark}
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-text-3">{EXAMS.wrongRedoTip}</p>

      {/* AI 诊断报告对话框（桌面独占） */}
      {aiDialog ? (
        <AiResultDialog
          open
          title={EXAMS.aiDiagnoseDialogTitle}
          state={aiDialog.state}
          content={aiDialog.content}
          error={aiDialog.error || AI_NOT_CONFIGURED}
          onRegenerate={() => runDiagnose(true)}
          onClose={() => setAiDialog(null)}
        />
      ) : null}
    </div>
  );
}

/** 筛选小片 */
function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`app-tappable min-h-[36px] rounded-sm border px-2 text-xs font-medium ${
        active ? 'border-primary bg-primary-soft text-text' : 'border-border bg-surface text-text-2'
      }`}
    >
      {label}
    </button>
  );
}

/** 取单题（getQuestions 太重，这里用 db 直查的薄封装） */
async function getQuestionById(questionId: string): Promise<Question | undefined> {
  const { db } = await import('@/db');
  return db.questions.get(questionId);
}
