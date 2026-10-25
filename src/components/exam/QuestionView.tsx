/**
 * 题目视图（T14 答题 / T15 解析回看共用）。
 *
 * 三种形态（ARCHITECTURE T11 遗留件的落地）：
 * 1. 四选项客观题（口语 / 词汇 / 阅读）：选项按钮（OptionList），选中高亮，解析模式标对错；
 * 2. blankIndex 题（完形 / 短文完成）：题干带「第 N 空」徽标，其余同客观题；
 * 3. 主观文本域（英译汉 / 写作）：textarea，答题主观题显示参考答案。
 *
 * 词汇题：原题的下划线考点词在 OCR 后丢失，改由 lib/exam/vocabTarget 从解析文本
 * 反推考点词并高亮（加粗 + 主题色 + 下划线）；解析缺失（回忆版）时原样输出，不猜词。
 */
import { useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';

import { EXAMS, SECTION_META } from '@/constants';
import { SUBJECTIVE_MAX_SCORE } from '@/constants';
import { ExamHighlightable, type ExamHighlightActions } from '@/components/exam/ExamHighlightable';
import { FlagButton } from '@/components/exam/FlagButton';
import { OptionList, type QuestionViewReview } from '@/components/exam/OptionList';
import { Icon } from '@/components/ui/Icon';
import { Tag } from '@/components/ui/Tag';

import { vocabStemSegments } from '@/lib/exam/vocabTarget';
import type { Question, TextHighlight } from '@/types';
import type { ExamHighlightPageActions } from '@/pages/exams/useExamHighlightActions';

export type { QuestionViewReview } from '@/components/exam/OptionList';

/** 词汇题题干：考点词加粗 + 主题色 + 下划线（模拟原题的下划线词） */
function renderStem(question: Question): ReactNode {
  if (question.sectionType !== 'vocabulary') {
    return question.stem;
  }
  const segments = vocabStemSegments(question.stem, question.explanation);
  if (segments.length === 1 && !segments[0]?.target) {
    return question.stem;
  }
  return segments.map((segment, index) =>
    segment.target ? (
      <strong
        key={index}
        data-vocab-target="true"
        className="font-bold text-exam-target underline decoration-2 underline-offset-2"
      >
        {segment.text}
      </strong>
    ) : (
      segment.text
    ),
  );
}

export interface QuestionViewProps {
  question: Question;
  /** 答题模式下的当前作答 */
  choice?: string | null;
  text?: string | null;
  flagged?: boolean;
  onChoice?: (key: string) => void;
  onText?: (text: string) => void;
  onToggleFlag?: () => void;
  /** 输入禁用（交卷后 / 暂停蒙层下） */
  disabled?: boolean;
  /** 解析回看模式的数据 */
  review?: QuestionViewReview;
  /** 「AI 讲解」回调（仅回看模式 + 桌面端由页面层传入；缺省 = 不显示按钮） */
  onAiExplain?: () => void;
  /** 本题的 AI 讲解对话框是否正打开（按钮高亮） */
  aiExplainActive?: boolean;
  /** 本题的划词高亮记录（anchorKind='question'，含题干与解析） */
  highlights?: TextHighlight[];
  /** 划词动作（页面级，anchorKind/anchorId 在这里绑定）；缺省 = 不启交互 */
  highlightActions?: ExamHighlightPageActions;
  className?: string;
}

/** 主观题满分（英译汉 10 / 写作 15；其他主观题型兜底 15） */
function subjectiveMaxOf(question: Question): number {
  if (question.sectionType === 'translation') {
    return SUBJECTIVE_MAX_SCORE.translation;
  }
  if (question.sectionType === 'writing') {
    return SUBJECTIVE_MAX_SCORE.writing;
  }
  return SUBJECTIVE_MAX_SCORE.writing;
}

export function QuestionView({
  question,
  choice = null,
  text = null,
  flagged = false,
  onChoice,
  onText,
  onToggleFlag,
  disabled = false,
  review,
  onAiExplain,
  aiExplainActive = false,
  highlights,
  highlightActions,
  className,
}: QuestionViewProps) {
  const meta = SECTION_META[question.sectionType];
  const isSubjective = question.options.length === 0 || !question.isObjective;
  const [selfScoreDraft, setSelfScoreDraft] = useState<number>(review?.selfScore ?? 0);

  /** 本题高亮按块分桶：stem / explanation */
  const highlightsByBlock = useMemo(() => {
    const map = new Map<string, TextHighlight[]>();
    if (!highlights) {
      return map;
    }
    for (const item of highlights) {
      const bucket = map.get(item.blockKey);
      if (bucket) {
        bucket.push(item);
      } else {
        map.set(item.blockKey, [item]);
      }
    }
    return map;
  }, [highlights]);

  /** 绑定 blockKey 的块级动作 */
  const blockActionsOf = (blockKey: string): ExamHighlightActions | undefined => {
    if (!highlightActions) {
      return undefined;
    }
    return {
      onAdd: (text, start, color, note) =>
        highlightActions.onAdd({
          anchorKind: 'question',
          anchorId: question.id,
          blockKey,
          text,
          start,
          color,
          note,
        }),
      onAddWord: highlightActions.onAddWord,
      onUpdate: highlightActions.onUpdate,
      onDelete: highlightActions.onDelete,
    };
  };

  return (
    <section className={clsx('flex flex-col gap-3', className)}>
      {/* 题头：序号 + 区段 + 空位 + 标记 */}
      <header className="flex items-center gap-2">
        <span className="text-base font-semibold text-text">{question.seq}.</span>
        <Tag color={meta.color}>{meta.shortName}</Tag>
        {question.blankIndex !== null ? (
          <Tag>
            {EXAMS.examBlankBadge(question.blankIndex)}
          </Tag>
        ) : null}
        {review ? (
          review.isCorrect === true ? (
            <Tag color="var(--c-success)">{EXAMS.reviewCorrect}</Tag>
          ) : review.isCorrect === false ? (
            <Tag color="var(--c-danger)">{EXAMS.reviewWrong}</Tag>
          ) : question.isObjective && question.answerKey === null ? (
            // 回忆版（2023-2025）无答案客观题：永不判分，明确标注与主观题的区别
            <Tag color="var(--c-warn)">{EXAMS.reviewAnswerPending}</Tag>
          ) : (
            <Tag color="var(--c-info)">{EXAMS.reviewSubjective}</Tag>
          )
        ) : null}
        {onToggleFlag && !review ? (
          <FlagButton flagged={flagged} onToggle={onToggleFlag} />
        ) : null}
      </header>

      {/* 题干（词汇题的考点词渲染优先，不做划词分段；其余题型支持划词高亮） */}
      {question.sectionType === 'vocabulary' ? (
        <p className="whitespace-pre-wrap text-base leading-relaxed text-text">
          {renderStem(question)}
        </p>
      ) : (
        <ExamHighlightable
          as="p"
          text={question.stem}
          highlights={highlightsByBlock.get('stem') ?? []}
          actions={blockActionsOf('stem')}
          className="whitespace-pre-wrap text-base leading-relaxed text-text"
        />
      )}

      {/* 客观题选项 / 主观题文本域 */}
      {!isSubjective ? (
        <OptionList
          question={question}
          choice={choice}
          onChoice={onChoice}
          disabled={disabled}
          review={review}
        />
      ) : review ? (
        <div className="flex flex-col gap-2">
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
            <p className="text-xs font-semibold text-text-2">{EXAMS.reviewMyAnswer}</p>
            <p className="whitespace-pre-wrap text-sm text-text">
              {review.myText && review.myText.trim() !== '' ? review.myText : EXAMS.reviewNoAnswer}
            </p>
          </div>
          {question.referenceAnswer ? (
            <div className="rounded-md border border-success bg-surface-2 px-3 py-2">
              <p className="text-xs font-semibold text-success">{EXAMS.reviewReference}</p>
              <p className="whitespace-pre-wrap text-sm text-text">{question.referenceAnswer}</p>
            </div>
          ) : null}
          {/* 主观题自评打分（成绩单入口；解析页只读时无 onSelfScore） */}
          {review.onSelfScore ? (
            <div className="flex items-center gap-2">
              <label htmlFor={`self-score-${question.id}`} className="text-sm text-text-2">
                {EXAMS.resultSelfEvalOf(meta.name, subjectiveMaxOf(question))}
              </label>
              <input
                id={`self-score-${question.id}`}
                type="number"
                min={0}
                max={subjectiveMaxOf(question)}
                step={1}
                value={selfScoreDraft}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  setSelfScoreDraft(Number.isFinite(parsed) ? Math.max(0, parsed) : 0);
                }}
                className="h-11 w-20 rounded-md border border-border bg-surface px-2 text-center text-base text-text"
              />
              <button
                type="button"
                onClick={() => review.onSelfScore?.(Math.min(selfScoreDraft, subjectiveMaxOf(question)))}
                className="app-tappable h-11 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg"
              >
                {EXAMS.attemptSubjectiveSave}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <textarea
            value={text ?? ''}
            disabled={disabled}
            onChange={(event) => onText?.(event.target.value)}
            placeholder={EXAMS.attemptSubjectivePlaceholder}
            aria-label={EXAMS.examSubjectiveInputLabel(question.seq)}
            rows={question.sectionType === 'writing' ? 10 : 6}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base leading-relaxed text-text placeholder:text-text-3"
          />
          <p className="text-xs text-text-3">
            {EXAMS.examSubjectiveMaxOf(meta.name, subjectiveMaxOf(question))}
          </p>
        </div>
      )}

      {/* 解析（回看模式支持划词高亮与笔记；头部右侧挂「AI 讲解」入口） */}
      {review ? (
        <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-text-2">{EXAMS.reviewExplanationTitle}</p>
            {onAiExplain ? (
              <button
                type="button"
                onClick={onAiExplain}
                className={clsx(
                  'app-tappable flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors duration-fast',
                  aiExplainActive
                    ? 'bg-primary text-primary-fg'
                    : 'bg-primary-soft text-primary hover:opacity-80',
                )}
              >
                <Icon name="sparkle" size={13} />
                {EXAMS.aiExplainButton}
              </button>
            ) : null}
          </div>
          <ExamHighlightable
            as="div"
            text={question.explanation !== '' ? question.explanation : EXAMS.reviewExplanationEmpty}
            highlights={highlightsByBlock.get('explanation') ?? []}
            actions={question.explanation !== '' ? blockActionsOf('explanation') : undefined}
            className="whitespace-pre-wrap text-sm text-text"
          />
        </div>
      ) : null}
    </section>
  );
}
