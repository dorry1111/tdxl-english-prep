/**
 * P14 主观题作答页（T14）：全屏大文本域，专注翻译 / 写作。
 *
 * 入口：答题页主观题下方「主观题作答页」（?q=序号）或答题卡主观题格。
 * 保存即写内存 + 立即落库（flush），返回答题页。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { EXAMS, ROUTES } from '@/constants';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PassageView } from '@/components/exam/PassageView';
import { SECTION_META } from '@/constants';
import { answerDraftOf, useAttemptStore } from '@/store/attemptStore';
import { useUiStore } from '@/store/uiStore';

export default function AttemptSubjectivePage() {
  const params = useParams<{ id: string }>();
  const attemptId = params.id ?? '';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toastSuccess = useUiStore((state) => state.toast.success);

  const questions = useAttemptStore((state) => state.questions);
  const passages = useAttemptStore((state) => state.passages);
  const currentSeq = useAttemptStore((state) => state.currentSeq);
  const setCurrentSeq = useAttemptStore((state) => state.setCurrentSeq);
  const setText = useAttemptStore((state) => state.setText);
  const flush = useAttemptStore((state) => state.flush);
  const status = useAttemptStore((state) => state.status);

  const qParam = searchParams.get('q');
  const targetSeq = useMemo(() => {
    if (qParam !== null && Number.isFinite(Number(qParam))) {
      return Number(qParam);
    }
    return currentSeq;
  }, [currentSeq, qParam]);

  const question = useMemo(
    () => questions.find((item) => item.seq === targetSeq && !item.isObjective),
    [questions, targetSeq],
  );
  const passage = useMemo(
    () =>
      question?.passageId != null
        ? passages.find((item) => item.id === question.passageId)
        : undefined,
    [passages, question],
  );

  const [text, setTextState] = useState('');
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  useEffect(() => {
    if (question && loadedFor !== question.seq) {
      setTextState(answerDraftOf(useAttemptStore.getState(), question.id).text ?? '');
      setLoadedFor(question.seq);
    }
  }, [loadedFor, question]);

  const save = useCallback(async () => {
    if (!question) {
      return;
    }
    setText(question.id, text);
    setCurrentSeq(question.seq);
    await flush();
    toastSuccess(EXAMS.attemptSubjectiveSaved);
    navigate(ROUTES.attempt.replace(':id', attemptId));
  }, [attemptId, flush, navigate, question, setCurrentSeq, setText, text, toastSuccess]);

  if (status !== 'active' || !question) {
    return (
      <Card title={EXAMS.attemptSubjectiveTitle}>
        <p className="text-sm text-text-2">{EXAMS.attemptNotFoundDesc}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-text">{EXAMS.attemptSubjectiveTitle}</h1>
        <span className="text-sm text-text-2">{SECTION_META[question.sectionType].name}</span>
      </div>
      {passage ? <PassageView passage={passage} defaultCollapsed={false} /> : null}
      <Card>
        <p className="whitespace-pre-wrap text-base leading-relaxed text-text">{question.stem}</p>
        <textarea
          value={text}
          onChange={(event) => setTextState(event.target.value)}
          aria-label={EXAMS.examSubjectiveInputLabel(question.seq)}
          rows={12}
          placeholder={EXAMS.attemptSubjectivePlaceholder}
          className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-base leading-relaxed text-text placeholder:text-text-3"
        />
      </Card>
      <Button block size="lg" onClick={() => void save()}>
        {EXAMS.attemptSubjectiveSave}
      </Button>
      {/* 若还有另一道主观题，提供直达 */}
      <div className="flex justify-center gap-2">
        {questions
          .filter((item) => !item.isObjective && item.seq !== question.seq)
          .map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchParams({ q: String(item.seq) }, { replace: true });
                setLoadedFor(null);
              }}
            >
              {SECTION_META[item.sectionType].name}
            </Button>
          ))}
      </div>
    </div>
  );
}
