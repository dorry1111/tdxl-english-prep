/**
 * 答题卡（T14）：77 格按 7 区段分组（Ⅰ 口语交际 … Ⅶ 写作）。
 *
 * - 三态：未答（浅底）/ 已答（实心绿）/ 已标记（琥珀描边）；
 * - 主观题两格显示「译」「写」，客观题显示全卷序号；
 * - 点击任意格 → onJump(question) 跳题；
 * - 「只看标记」筛选：仅渲染 flagged 的格子。
 */
import { useMemo, useState } from 'react';
import clsx from 'clsx';

import { EXAMS, SECTION_ROMAN, SECTION_TYPES_BY_ORDER } from '@/constants';
import { SECTION_META } from '@/constants';
import type { AnswerDraft } from '@/store/attemptStore';
import type { Question } from '@/types';

export interface AnswerSheetProps {
  questions: Question[];
  answers: Record<string, AnswerDraft>;
  /** 当前题 seq（高亮当前格），可空 */
  currentSeq?: number | null;
  onJump: (question: Question) => void;
  className?: string;
}

/** 判断一格是否「已答」 */
function isAnswered(draft: AnswerDraft | undefined): boolean {
  if (!draft) {
    return false;
  }
  return (
    (draft.choice !== null && draft.choice !== '') ||
    (draft.text !== null && draft.text.trim() !== '')
  );
}

export function AnswerSheet({ questions, answers, currentSeq, onJump, className }: AnswerSheetProps) {
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  // 按区段分组（顺序 = SECTION_TYPES_BY_ORDER，与卷面一致）
  const groups = useMemo(() => {
    return SECTION_TYPES_BY_ORDER.map((type) => ({
      type,
      meta: SECTION_META[type],
      questions: questions.filter((question) => question.sectionType === type),
    })).filter((group) => group.questions.length > 0);
  }, [questions]);

  const answeredTotal = questions.filter((question) => isAnswered(answers[question.id])).length;

  return (
    <section className={clsx('flex flex-col gap-3', className)} aria-label={EXAMS.sheetTitle}>
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-text">{EXAMS.sheetTitle}</h2>
        <span className="text-sm text-text-2">{EXAMS.sheetAnsweredCount(answeredTotal, questions.length)}</span>
        <button
          type="button"
          onClick={() => setFlaggedOnly((prev) => !prev)}
          aria-pressed={flaggedOnly}
          className={clsx(
            'app-tappable ms-auto min-h-[44px] rounded-md border px-3 text-sm font-medium',
            flaggedOnly
              ? 'border-exam-flagged bg-surface text-exam-flagged'
              : 'border-border bg-surface text-text-2',
          )}
        >
          {EXAMS.sheetFlaggedOnly}
        </button>
      </header>

      {/* 图例 */}
      <div className="flex items-center gap-3 text-xs text-text-2">
        <span className="flex items-center gap-1">
          <span aria-hidden className="inline-block h-3 w-3 rounded-sm border border-border bg-exam-unanswered" />
          {EXAMS.sheetLegendUnanswered}
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-exam-answered" />
          {EXAMS.sheetLegendAnswered}
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden className="inline-block h-3 w-3 rounded-sm border-2 border-exam-flagged bg-exam-unanswered" />
          {EXAMS.sheetLegendFlagged}
        </span>
      </div>

      {/* 分区段网格 */}
      <div className="flex flex-col gap-4">
        {groups.map((group) => {
          const visible = flaggedOnly
            ? group.questions.filter((question) => answers[question.id]?.flagged === true)
            : group.questions;
          const roman = SECTION_ROMAN[group.meta.order - 1] ?? String(group.meta.order);
          return (
            <div key={group.type} data-section={group.type} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-text-2">
                {EXAMS.sheetGroupLabel(roman, group.meta.name, group.questions.length)}
              </h3>
              {visible.length === 0 ? (
                <p className="text-xs text-text-3">{EXAMS.sheetFlaggedEmpty}</p>
              ) : (
                <div className="grid grid-cols-8 gap-1.5 tablet:grid-cols-10">
                  {visible.map((question) => {
                    const draft = answers[question.id];
                    const answered = isAnswered(draft);
                    const flagged = draft?.flagged ?? false;
                    const isCurrent = question.seq === currentSeq;
                    const subjectiveLabel =
                      question.sectionType === 'translation'
                        ? EXAMS.sheetSubjectiveTranslation
                        : question.sectionType === 'writing'
                          ? EXAMS.sheetSubjectiveWriting
                          : null;
                    return (
                      <button
                        key={question.id}
                        type="button"
                        onClick={() => onJump(question)}
                        aria-label={EXAMS.sheetJumpTo(question.seq)}
                        aria-current={isCurrent ? 'true' : undefined}
                        className={clsx(
                          'app-tappable flex h-9 items-center justify-center rounded-sm border text-sm font-semibold tabular-nums',
                          answered
                            ? 'border-transparent bg-exam-answered text-exam-on-state'
                            : 'border-border bg-exam-unanswered text-text-2',
                          flagged && 'border-2 border-exam-flagged',
                          isCurrent && 'outline outline-2 outline-primary',
                        )}
                      >
                        {subjectiveLabel ?? question.seq}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
