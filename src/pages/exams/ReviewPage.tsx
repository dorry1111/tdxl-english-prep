/**
 * P18 解析回看（T15）。
 *
 * - 双栏：左题目列表（我的答案 / 正确答案摘要），右逐题解析
 *   （QuestionView review 模式 + 解析 + 参考答案）；
 * - 划词高亮（P3）：原文段落 / 题干 / 解析均可划选——
 *   单词 → 生词本；任意选区 → 4 色高亮 / 划词笔记；点已有高亮 → 编辑/换色/删除；
 *   高亮锚 passageId / questionId（跨设备同步、跨答题次数共享）；
 * - 移动端单栏：先列表后详情（点击列表项滚动到详情）。
 */
import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useParams, useSearchParams } from 'react-router';

import { EXAMS, SECTION_META } from '@/constants';
import { AiResultDialog, type AiDialogState } from '@/components/ai/AiResultDialog';
import { DialogueGroupView } from '@/components/exam/DialogueGroupView';
import { QuestionView } from '@/components/exam/QuestionView';
import { PassageView } from '@/components/exam/PassageView';
import { Card } from '@/components/ui/Card';
import { Tag } from '@/components/ui/Tag';
import { getAnswers, getAttempt } from '@/db/repos/attemptRepo';
import { getPaperDetail } from '@/db/repos/examRepo';
import { removeCached } from '@/db/repos/llmCacheRepo';
import { listTextHighlightsByAnchorId } from '@/db/repos/textHighlightRepo';
import { dialogueBlankIndex, groupDialogueQuestions } from '@/lib/exam/dialogueGroup';
import { IS_DESKTOP } from '@/lib/desktop';
import { AI_NOT_CONFIGURED, runAi } from '@/lib/aiRunner';
import { explainQuestion } from '@/lib/llm';
import { useExamHighlightActions } from '@/pages/exams/useExamHighlightActions';
import type { Attempt, AttemptAnswer, Passage, Question } from '@/types';

/** 「AI 讲解」对话框状态（当前只看一道题，切题即关闭） */
interface AiExplainDialog {
  questionId: string;
  state: AiDialogState;
  content: string;
  error: string;
}

export default function ReviewPage() {
  const params = useParams<{ id: string }>();
  const attemptId = params.id ?? '';
  // 搜索页「真题整句」跳转带 ?q=<questionId>：加载完成后定位到该题
  const [searchParams] = useSearchParams();
  const focusQuestionId = searchParams.get('q');

  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [answers, setAnswers] = useState<AttemptAnswer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const [aiDialog, setAiDialog] = useState<AiExplainDialog | null>(null);

  const highlightActions = useExamHighlightActions();

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
      setPassages(detail.passages);
      setAnswers(answerRows);
      // ?q= 定位：命中题目则聚焦之，否则回落到第一题
      const focus = detail.questions.find((question) => question.id === focusQuestionId);
      setActiveId(focus?.id ?? detail.questions[0]?.id ?? null);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [attemptId, focusQuestionId]);

  const answerByQid = useMemo(() => new Map(answers.map((row) => [row.questionId, row])), [answers]);
  const activeQuestion = useMemo(
    () => questions.find((question) => question.id === activeId) ?? null,
    [activeId, questions],
  );
  const activePassage = useMemo(
    () =>
      activeQuestion?.passageId != null
        ? passages.find((passage) => passage.id === activeQuestion.passageId)
        : undefined,
    [activeQuestion, passages],
  );

  /** 当前原文与当前题的划词高亮（实时订阅，增删改即时反映） */
  const passageHighlights = useLiveQuery(
    () => (activePassage ? listTextHighlightsByAnchorId(activePassage.id) : []),
    [activePassage?.id],
    [],
  );
  const questionHighlights = useLiveQuery(
    () => (activeQuestion ? listTextHighlightsByAnchorId(activeQuestion.id) : []),
    [activeQuestion?.id],
    [],
  );

  /** 口语交际整组回看：点任一空位都显示整段对话（正文只出现一次） */
  const dialogueGroups = useMemo(() => groupDialogueQuestions(questions), [questions]);
  const activeGroup = useMemo(
    () =>
      activeQuestion?.sectionType === 'dialogue'
        ? dialogueGroups.find((group) =>
            group.questions.some((question) => question.id === activeQuestion.id),
          ) ?? null
        : null,
    [activeQuestion, dialogueGroups],
  );

  /** 原文空位序号集合（完形 46~55）+ 当前空位，PassageView 据此画长下划线 */
  const passageBlanks = useMemo<ReadonlySet<number> | undefined>(() => {
    if (!activePassage) {
      return undefined;
    }
    const blanks = questions
      .filter((question) => question.passageId === activePassage.id && question.blankIndex !== null)
      .map((question) => question.blankIndex as number);
    return blanks.length > 0 ? new Set(blanks) : undefined;
  }, [activePassage, questions]);

  // ---------- AI 讲解（桌面独占；PWA 无 CORS 通道不开放） ----------
  const handleAiExplain = useCallback(
    (question: Question): void => {
      if (!IS_DESKTOP) {
        return;
      }
      if (aiDialog?.questionId === question.id) {
        // 再点一次 = 关闭
        setAiDialog(null);
        return;
      }
      setAiDialog({ questionId: question.id, state: 'loading', content: '', error: '' });
      const answerIndex =
        question.answerKey !== null
          ? question.options.findIndex((option) => option.key === question.answerKey)
          : -1;
      void (async () => {
        try {
          const result = await runAi('explain', question.id, (config) =>
            explainQuestion(config, {
              paperId: attempt?.paperId ?? '',
              sectionType: question.sectionType,
              stem: question.stem,
              options: question.options.map((option) => option.text),
              answerIndex,
              passage: activePassage?.content,
              explanation: question.explanation,
            }),
          );
          setAiDialog({ questionId: question.id, state: 'done', content: result.content, error: '' });
        } catch (error) {
          setAiDialog({
            questionId: question.id,
            state: 'error',
            content: '',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    },
    [aiDialog, attempt?.paperId, activePassage?.content],
  );

  const handleAiRegenerate = useCallback((): void => {
    const question = questions.find((row) => row.id === aiDialog?.questionId);
    if (!question) {
      return;
    }
    setAiDialog({ questionId: question.id, state: 'loading', content: '', error: '' });
    void (async () => {
      try {
        await removeCached('explain', question.id);
        const answerIndex =
          question.answerKey !== null
            ? question.options.findIndex((option) => option.key === question.answerKey)
            : -1;
        const result = await runAi('explain', question.id, (config) =>
          explainQuestion(config, {
            paperId: attempt?.paperId ?? '',
            sectionType: question.sectionType,
            stem: question.stem,
            options: question.options.map((option) => option.text),
            answerIndex,
            passage: activePassage?.content,
            explanation: question.explanation,
          }),
        );
        setAiDialog({ questionId: question.id, state: 'done', content: result.content, error: '' });
      } catch (error) {
        setAiDialog({
          questionId: question.id,
          state: 'error',
          content: '',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, [aiDialog?.questionId, questions, attempt?.paperId, activePassage?.content]);

  if (!loaded) {
    return (
      <Card title={EXAMS.reviewExamTitle}>
        <p className="text-sm text-text-2">{EXAMS.jsonReading}</p>
      </Card>
    );
  }
  if (!attempt) {
    return (
      <Card title={EXAMS.reviewExamTitle}>
        <p className="text-sm text-text-2">{EXAMS.attemptNotFoundDesc}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-text">{EXAMS.reviewExamTitle}</h1>

      <div className="flex flex-col gap-4 tablet:grid tablet:grid-cols-[300px_1fr] tablet:items-start">
        {/* 左：题目列表 */}
        <Card bodyClassName="max-h-[70vh] overflow-y-auto p-0">
          <ul className="flex flex-col">
            {questions.map((question) => {
              const row = answerByQid.get(question.id);
              const active = question.id === activeId;
              return (
                <li key={question.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveId(question.id);
                      // 切题即关 AI 对话框：避免旧题的讲解留在新题上造成误解
                      setAiDialog(null);
                    }}
                    className={`app-tappable flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm ${
                      active ? 'bg-primary-soft text-text' : 'text-text-2'
                    }`}
                  >
                    <span className="w-8 shrink-0 tabular-nums font-semibold text-text-3">
                      {question.seq}
                    </span>
                    <span className="line-clamp-1 flex-1">{question.stem}</span>
                    {question.isObjective ? (
                      row?.isCorrect === true ? (
                        <Tag color="var(--c-success)">{EXAMS.reviewCorrect}</Tag>
                      ) : (
                        <Tag color="var(--c-danger)">{EXAMS.reviewWrong}</Tag>
                      )
                    ) : (
                      <Tag color="var(--c-info)">{SECTION_META[question.sectionType].shortName}</Tag>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* 右：逐题解析 */}
        <div ref={detailRef}>
          {activeQuestion ? (
            <div className="flex flex-col gap-3">
              {activeGroup ? (
                <DialogueGroupView
                  group={activeGroup}
                  stateOf={() => ({ choice: null, flagged: false })}
                  onChoice={() => undefined}
                  activeBlank={dialogueBlankIndex(activeQuestion)}
                  disabled
                  reviewOf={(question) => ({
                    myChoice: answerByQid.get(question.id)?.choice ?? null,
                    myText: answerByQid.get(question.id)?.text ?? null,
                    isCorrect: answerByQid.get(question.id)?.isCorrect ?? null,
                    selfScore: answerByQid.get(question.id)?.selfScore ?? null,
                  })}
                />
              ) : null}
              {activePassage ? (
                <PassageView
                  passage={activePassage}
                  defaultCollapsed={false}
                  blankNumbers={passageBlanks}
                  activeBlank={activeQuestion.blankIndex}
                  highlights={(passageHighlights ?? []).filter((row) => row.anchorKind === 'passage')}
                  highlightActions={highlightActions}
                />
              ) : null}
              {!activeGroup ? (
                <QuestionView
                  question={activeQuestion}
                  review={{
                    myChoice: answerByQid.get(activeQuestion.id)?.choice ?? null,
                    myText: answerByQid.get(activeQuestion.id)?.text ?? null,
                    isCorrect: answerByQid.get(activeQuestion.id)?.isCorrect ?? null,
                    selfScore: answerByQid.get(activeQuestion.id)?.selfScore ?? null,
                  }}
                  highlights={(questionHighlights ?? []).filter((row) => row.anchorKind === 'question')}
                  highlightActions={highlightActions}
                  onAiExplain={IS_DESKTOP ? () => handleAiExplain(activeQuestion) : undefined}
                  aiExplainActive={aiDialog?.questionId === activeQuestion.id}
                />
              ) : null}
              {activeQuestion.isObjective && activeQuestion.answerKey !== null ? (
                <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
                  <span className="text-text-2">
                    {EXAMS.reviewMyAnswer}：
                    <span className="font-semibold text-text">
                      {answerByQid.get(activeQuestion.id)?.choice ?? EXAMS.reviewNoAnswer}
                    </span>
                  </span>
                  <span className="text-text-2">
                    {EXAMS.reviewCorrectAnswer}：
                    <span className="font-semibold text-success">{activeQuestion.answerKey}</span>
                  </span>
                </div>
              ) : null}
              <p className="text-xs text-text-3">{EXAMS.reviewPickWordHint}</p>
            </div>
          ) : null}
        </div>
      </div>

      {/* AI 讲解对话框（桌面独占） */}
      {aiDialog ? (
        <AiResultDialog
          open
          title={EXAMS.aiExplainDialogTitle}
          state={aiDialog.state}
          content={aiDialog.content}
          error={aiDialog.error || AI_NOT_CONFIGURED}
          onRegenerate={handleAiRegenerate}
          onClose={() => setAiDialog(null)}
        />
      ) : null}
    </div>
  );
}
