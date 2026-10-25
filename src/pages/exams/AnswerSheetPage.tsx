/**
 * P14 答题卡独立页（T14）：全屏三态网格 + 交卷确认。
 *
 * 与 AttemptPage 共用 attemptStore 与 AnswerSheet 组件；
 * 点格跳回答题页（?q=序号），不遮挡顶部倒计时（本页不渲染倒计时条）。
 */
import { useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';

import { ACTIONS, EXAMS, ROUTES } from '@/constants';
import { AnswerSheet } from '@/components/exam/AnswerSheet';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { useAttemptStore } from '@/store/attemptStore';
import { useUiStore } from '@/store/uiStore';
import { useState } from 'react';

export default function AnswerSheetPage() {
  const params = useParams<{ id: string }>();
  const attemptId = params.id ?? '';
  const navigate = useNavigate();
  const toastError = useUiStore((state) => state.toast.error);

  const status = useAttemptStore((state) => state.status);
  const storeAttemptId = useAttemptStore((state) => state.attemptId);
  const questions = useAttemptStore((state) => state.questions);
  const answers = useAttemptStore((state) => state.answers);
  const currentSeq = useAttemptStore((state) => state.currentSeq);
  const restore = useAttemptStore((state) => state.restore);
  const submit = useAttemptStore((state) => state.submit);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'idle' || (status === 'active' && storeAttemptId !== attemptId)) {
      void restore(attemptId).then((ok) => {
        if (!ok) {
          toastError(EXAMS.attemptRestoreFailed);
        }
      });
    }
  }, [attemptId, restore, status, storeAttemptId, toastError]);

  const doSubmit = useCallback(async () => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setConfirmOpen(false);
    try {
      await submit();
      navigate(ROUTES.attemptResult.replace(':id', attemptId));
    } catch {
      toastError(EXAMS.attemptSaveFailed);
      setSubmitting(false);
    }
  }, [attemptId, navigate, submit, submitting, toastError]);

  if (status !== 'active') {
    return (
      <Card title={EXAMS.sheetTitle}>
        <p className="text-sm text-text-2">{EXAMS.attemptNotFoundDesc}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title={EXAMS.sheetTitle}>
        <AnswerSheet
          questions={questions}
          answers={answers}
          currentSeq={currentSeq}
          onJump={(question) =>
            navigate(`${ROUTES.attempt.replace(':id', attemptId)}?q=${question.seq}`)
          }
        />
      </Card>
      <Button block size="lg" onClick={() => setConfirmOpen(true)}>
        {EXAMS.attemptSubmit}
      </Button>

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
