/**
 * P13/P14 答题页（T14）。
 *
 * - 宽屏双栏：左题目 + 可折叠原文（PassageView），右答题卡常驻；
 *   移动端单栏 + 底部「答题卡」抽屉（Sheet，不遮挡倒计时）；
 * - 倒计时：remainingSec 由 store.tick() 每秒推进，可暂停（蒙层遮挡题目与原文），
 *   剩 5 分钟变红，超时自动交卷；
 * - 口语交际：按「选项签名」分组，一段对话一屏（对话正文只出现一次，下面按空位列选项），
 *   翻页按组走；其余题型一题一屏（答题卡与进度语义不变）；
 * - 快捷键：1/2/3/4 选 ABCD、F 标记、←/→ 切题（输入框聚焦忽略，见 useHotkeys）；
 * - 每次选择写内存，store.tick() 内每 3s 落库一次；刷新后 restore() 恢复；
 * - 交卷确认 → gradeAttempt → Attempt + AttemptAnswer + WrongItem → 成绩单。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { ACTIONS, EXAMS, ROUTES } from '@/constants';
import { AnswerSheet } from '@/components/exam/AnswerSheet';
import { Countdown } from '@/components/exam/Countdown';
import { DialogueGroupView } from '@/components/exam/DialogueGroupView';
import { PassageView } from '@/components/exam/PassageView';
import { QuestionView } from '@/components/exam/QuestionView';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Sheet } from '@/components/ui/Sheet';
import { useHotkeys } from '@/hooks/useHotkeys';
import { listTextHighlightsByAnchorId } from '@/db/repos/textHighlightRepo';
import { useExamHighlightActions } from '@/pages/exams/useExamHighlightActions';
import {
  answerDraftOf,
  useAttemptStore,
} from '@/store/attemptStore';
import { useUiStore } from '@/store/uiStore';
import {
  buildQuestionPages,
  dialogueBlankIndex,
  groupDialogueQuestions,
} from '@/lib/exam/dialogueGroup';
import type { Question } from '@/types';

export default function AttemptPage() {
  const params = useParams<{ id: string }>();
  const attemptId = params.id ?? '';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toastError = useUiStore((state) => state.toast.error);
  const toastInfo = useUiStore((state) => state.toast.info);

  const status = useAttemptStore((state) => state.status);
  const storeAttemptId = useAttemptStore((state) => state.attemptId);
  const questions = useAttemptStore((state) => state.questions);
  const passages = useAttemptStore((state) => state.passages);
  const currentSeq = useAttemptStore((state) => state.currentSeq);
  const answers = useAttemptStore((state) => state.answers);
  const remainingSec = useAttemptStore((state) => state.remainingSec);
  const paused = useAttemptStore((state) => state.paused);
  const timeoutSubmitted = useAttemptStore((state) => state.timeoutSubmitted);
  const error = useAttemptStore((state) => state.error);

  const restore = useAttemptStore((state) => state.restore);
  const setCurrentSeq = useAttemptStore((state) => state.setCurrentSeq);
  const setChoice = useAttemptStore((state) => state.setChoice);
  const setText = useAttemptStore((state) => state.setText);
  const toggleFlag = useAttemptStore((state) => state.toggleFlag);
  const togglePause = useAttemptStore((state) => state.togglePause);
  const tick = useAttemptStore((state) => state.tick);
  const submit = useAttemptStore((state) => state.submit);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const submittingRef = useRef(false);

  const highlightActions = useExamHighlightActions();

  // 恢复 / 守卫
  useEffect(() => {
    if (status === 'idle' || (status === 'active' && storeAttemptId !== attemptId)) {
      void restore(attemptId).then((ok) => {
        if (!ok) {
          // 已交卷 → 去成绩单；不存在 → 回试卷库
          toastError(EXAMS.attemptRestoreFailed);
        }
      });
    }
  }, [attemptId, restore, status, storeAttemptId, toastError]);

  // 恢复失败分流：submitted 去成绩单；not found 回试卷库
  useEffect(() => {
    if (status !== 'idle' || error === null) {
      return;
    }
    if (error === 'ATTEMPT_NOT_FOUND') {
      void restoreIfSubmitted();
    } else {
      navigate(ROUTES.exams);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, error]);

  async function restoreIfSubmitted(): Promise<void> {
    // 状态为 idle 且标记 ATTEMPT_NOT_FOUND：区分「不存在」与「已交卷」
    const { getAttempt } = await import('@/db/repos/attemptRepo');
    const attempt = await getAttempt(attemptId);
    if (attempt && attempt.submittedAt !== null) {
      navigate(ROUTES.attemptResult.replace(':id', attemptId));
    } else {
      navigate(ROUTES.exams);
    }
  }

  // 每秒 tick：倒计时推进 + 3s 节流落库 + 超时自动交卷
  useEffect(() => {
    if (status !== 'active') {
      return;
    }
    const timer = window.setInterval(() => {
      void tick();
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [status, tick]);

  // 超时自动交卷提示
  useEffect(() => {
    if (timeoutSubmitted && !submittingRef.current) {
      toastInfo(EXAMS.attemptAutoSubmitted);
    }
  }, [timeoutSubmitted, toastInfo]);

  // 已提交 → 跳成绩单
  useEffect(() => {
    if (status === 'submitted') {
      navigate(ROUTES.attemptResult.replace(':id', attemptId));
    }
  }, [attemptId, navigate, status]);

  // ?q= 初始题号（答题卡独立页跳回用）
  useEffect(() => {
    const q = searchParams.get('q');
    if (q !== null) {
      const seq = Number(q);
      if (Number.isFinite(seq) && seq >= 1) {
        setCurrentSeq(seq);
      }
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setCurrentSeq, setSearchParams]);

  const currentQuestion = useMemo<Question | undefined>(
    () => questions.find((question) => question.seq === currentSeq),
    [currentSeq, questions],
  );
  const currentPassage = useMemo(
    () =>
      currentQuestion?.passageId !== null && currentQuestion?.passageId !== undefined
        ? passages.find((passage) => passage.id === currentQuestion?.passageId)
        : undefined,
    [currentQuestion, passages],
  );
  /** 口语交际：按「选项签名」分组，一段对话一屏（正文只显示一次 + 各空位选项） */
  const dialogueGroups = useMemo(() => groupDialogueQuestions(questions), [questions]);
  const currentGroup = useMemo(
    () =>
      currentQuestion?.sectionType === 'dialogue'
        ? dialogueGroups.find((group) =>
            group.questions.some((question) => question.seq === currentSeq),
          ) ?? null
        : null,
    [currentQuestion, currentSeq, dialogueGroups],
  );

  /** 翻页序列：口语按组，其余按题 */
  const pages = useMemo(() => buildQuestionPages(questions), [questions]);
  const currentPageIndex = useMemo(
    () => pages.findIndex((page) => page.seqs.includes(currentSeq)),
    [currentSeq, pages],
  );

  /** 完形/短文完成原文中的空位序号集合，PassageView 据此给数字加下划线 */
  const passageBlanks = useMemo<ReadonlySet<number> | undefined>(() => {
    if (!currentPassage) {
      return undefined;
    }
    const blanks = questions
      .filter((question) => question.passageId === currentPassage.id && question.blankIndex !== null)
      .map((question) => question.blankIndex as number);
    return blanks.length > 0 ? new Set(blanks) : undefined;
  }, [currentPassage, questions]);

  /** 当前原文/当前题的划词高亮（答题中也可划词，实时订阅） */
  const passageHighlights = useLiveQuery(
    () => (currentPassage ? listTextHighlightsByAnchorId(currentPassage.id) : []),
    [currentPassage?.id],
    [],
  );
  const questionHighlights = useLiveQuery(
    () => (currentQuestion ? listTextHighlightsByAnchorId(currentQuestion.id) : []),
    [currentQuestion?.id],
    [],
  );

  /** 上一屏：口语按组整组翻，其余题型逐题 */
  const goPrev = useCallback(() => {
    if (currentPageIndex > 0) {
      setCurrentSeq(pages[currentPageIndex - 1]?.anchorSeq ?? 1);
    }
  }, [currentPageIndex, pages, setCurrentSeq]);

  /** 下一屏：口语按组整组翻，其余题型逐题 */
  const goNext = useCallback(() => {
    if (currentPageIndex >= 0 && currentPageIndex < pages.length - 1) {
      setCurrentSeq(pages[currentPageIndex + 1]?.anchorSeq ?? 1);
    }
  }, [currentPageIndex, pages, setCurrentSeq]);

  const doSubmit = useCallback(async () => {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setConfirmOpen(false);
    setSheetOpen(false);
    try {
      await submit();
      navigate(ROUTES.attemptResult.replace(':id', attemptId));
    } catch {
      toastError(EXAMS.attemptSaveFailed);
      submittingRef.current = false;
    }
  }, [attemptId, navigate, submit, toastError]);

  // 快捷键
  useHotkeys(
    {
      onChoice: (index) => {
        if (!currentQuestion || paused) {
          return;
        }
        const option = currentQuestion.options[index];
        if (option) {
          setChoice(currentQuestion.id, option.key);
        }
      },
      onFlag: () => {
        if (currentQuestion && !paused) {
          toggleFlag(currentQuestion.id);
        }
      },
      onPrev: goPrev,
      onNext: goNext,
    },
    status === 'active',
  );

  if (status === 'loading' || status === 'idle') {
    return (
      <Card title={EXAMS.attemptSubmit}>
        <p className="text-sm text-text-2">{EXAMS.jsonReading}</p>
      </Card>
    );
  }
  if (status === 'submitting' || status === 'submitted' || !currentQuestion) {
    return (
      <Card title={EXAMS.attemptSubmit}>
        <p className="text-sm text-text-2">{EXAMS.attemptSubmitted}</p>
      </Card>
    );
  }

  const snapshot = useAttemptStore.getState();
  const draft = answerDraftOf(snapshot, currentQuestion.id);

  const sheet = (
    <AnswerSheet
      questions={questions}
      answers={answers}
      currentSeq={currentSeq}
      onJump={(question) => {
        setCurrentSeq(question.seq);
        setSheetOpen(false);
      }}
    />
  );

  return (
    <div className="relative flex flex-col gap-3">
      {/* 顶栏：倒计时 + 答题卡 + 交卷（sticky 基准避开全局 TopBar，防止重叠） */}
      <div className="sticky top-[var(--sticky-top)] z-20 -mx-2 flex items-center gap-2 border-b border-border bg-surface px-2 py-2">
        <Countdown remainingSec={remainingSec} paused={paused} onTogglePause={togglePause} />
        <Button
          variant="secondary"
          size="sm"
          className="ms-auto tablet:hidden"
          onClick={() => setSheetOpen(true)}
        >
          {EXAMS.attemptSheet}
        </Button>
        <Button variant="primary" size="sm" onClick={() => setConfirmOpen(true)}>
          {EXAMS.attemptSubmit}
        </Button>
      </div>

      {/* 双栏主体 */}
      <div className="flex flex-col gap-4 tablet:grid tablet:grid-cols-[1fr_300px] tablet:items-start">
        <div className="flex flex-col gap-3">
          {currentGroup ? (
            /* 口语交际：一段对话一屏（正文只出现一次），下面按空位顺序列出各组选项 */
            <DialogueGroupView
              group={currentGroup}
              stateOf={(question) => {
                const itemDraft = answerDraftOf(snapshot, question.id);
                return { choice: itemDraft.choice, flagged: itemDraft.flagged };
              }}
              onChoice={(questionId, key) => {
                setChoice(questionId, key);
                // 自动跳下一空：答完当前聚焦空位后，聚焦推进到组内按空位顺序的下一个未作答空位
                if (paused || !currentQuestion || questionId !== currentQuestion.id) {
                  return;
                }
                const fresh = useAttemptStore.getState();
                const next = currentGroup?.questions.find(
                  (question) =>
                    question.id !== questionId &&
                    answerDraftOf(fresh, question.id).choice === null,
                );
                if (next) {
                  setCurrentSeq(next.seq);
                }
              }}
              onToggleFlag={(questionId) => toggleFlag(questionId)}
              activeBlank={dialogueBlankIndex(currentQuestion)}
              disabled={paused}
            />
          ) : (
            <>
              {currentPassage ? (
                <PassageView
                  passage={currentPassage}
                  blankNumbers={passageBlanks}
                  activeBlank={currentQuestion.blankIndex}
                  highlights={(passageHighlights ?? []).filter((row) => row.anchorKind === 'passage')}
                  highlightActions={highlightActions}
                />
              ) : null}
              <QuestionView
                question={currentQuestion}
                choice={draft.choice}
                text={draft.text}
                flagged={draft.flagged}
                onChoice={(key) => setChoice(currentQuestion.id, key)}
                onText={(text) => setText(currentQuestion.id, text)}
                onToggleFlag={() => toggleFlag(currentQuestion.id)}
                disabled={paused}
                highlights={(questionHighlights ?? []).filter((row) => row.anchorKind === 'question')}
                highlightActions={highlightActions}
              />
            </>
          )}
          {/* 主观题入口 */}
          {!currentQuestion.isObjective ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                navigate(
                  `${ROUTES.attemptSubjective.replace(':id', attemptId)}?q=${currentQuestion.seq}`,
                )
              }
            >
              {EXAMS.attemptSubjectiveEntry}
            </Button>
          ) : null}
          {/* 翻题 */}
          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" size="sm" onClick={goPrev} disabled={currentPageIndex <= 0}>
              {EXAMS.attemptPrev}
            </Button>
            <span className="text-sm tabular-nums text-text-2">
              {currentSeq} / {questions.length}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={goNext}
              disabled={currentPageIndex < 0 || currentPageIndex >= pages.length - 1}
            >
              {EXAMS.attemptNext}
            </Button>
          </div>
        </div>

        {/* 宽屏常驻答题卡 */}
        <Card className="hidden tablet:block">{sheet}</Card>
      </div>

      {/* 移动端答题卡抽屉 */}
      <Sheet open={sheetOpen} title={EXAMS.sheetTitle} onClose={() => setSheetOpen(false)}>
        {sheet}
      </Sheet>

      {/* 暂停蒙层：遮挡题目与原文 */}
      {paused ? (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-exam-overlay px-6">
          <p className="text-2xl font-semibold text-primary-fg">{EXAMS.attemptPausedTitle}</p>
          <p className="max-w-xs text-center text-sm text-primary-fg">{EXAMS.attemptPausedDesc}</p>
          <Countdown remainingSec={remainingSec} paused onTogglePause={togglePause} />
          <Button size="lg" onClick={togglePause}>
            {EXAMS.attemptResume}
          </Button>
        </div>
      ) : null}

      {/* 交卷确认 */}
      <Dialog
        open={confirmOpen}
        title={EXAMS.attemptSubmitConfirmTitle}
        description={EXAMS.attemptSubmitConfirmDesc}
        onClose={() => setConfirmOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(false)}>
              {ACTIONS.cancel}
            </Button>
            <Button size="sm" onClick={() => void doSubmit()}>
              {ACTIONS.confirm}
            </Button>
          </div>
        }
      />
    </div>
  );
}
