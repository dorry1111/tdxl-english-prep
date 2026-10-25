/**
 * 客观题选项列表（QuestionView / DialogueGroupView 共用）。
 *
 * 抽出来是为了让「口语交际整组同屏」复用同一套选项渲染与状态：
 * 选中态、解析模式的正确答案 / 错选态、禁用态、无障碍 role 全部保持一致。
 */
import clsx from 'clsx';

import { EXAMS } from '@/constants';
import { Icon } from '@/components/ui/Icon';
import type { Question } from '@/types';

/** 解析回看模式的数据（QuestionView 与 DialogueGroupView 共用）。 */
export interface QuestionViewReview {
  /** 我的选项字母（客观题） */
  myChoice: string | null;
  /** 我的作答文本（主观题） */
  myText: string | null;
  /** 判分结果：true 对 / false 错 / null 主观 */
  isCorrect: boolean | null;
  /** 自评分（主观题，未评为 null） */
  selfScore: number | null;
  /** 自评打分回调（传入才出现打分控件） */
  onSelfScore?: (score: number) => void;
}

export interface OptionListProps {
  question: Question;
  /** 当前选中的选项字母（答题模式） */
  choice?: string | null;
  onChoice?: (key: string) => void;
  /** 禁用（交卷后 / 暂停蒙层下 / 解析模式） */
  disabled?: boolean;
  /** 解析回看数据；传入则只读并标对错 */
  review?: QuestionViewReview;
  className?: string;
}

export function OptionList({
  question,
  choice = null,
  onChoice,
  disabled = false,
  review,
  className,
}: OptionListProps) {
  return (
    <div
      role="radiogroup"
      aria-label={EXAMS.examOptionGroup(question.seq)}
      className={clsx('flex flex-col gap-2', className)}
    >
      {question.options.map((option) => {
        const selected = review ? review.myChoice === option.key : choice === option.key;
        const isAnswerKey = review !== undefined && question.answerKey === option.key;
        const wrongPick = review !== undefined && selected && question.answerKey !== option.key;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || review !== undefined}
            onClick={() => onChoice?.(option.key)}
            className={clsx(
              'app-tappable flex min-h-[44px] w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-base transition-colors duration-fast',
              'disabled:cursor-default',
              selected
                ? 'border-primary bg-primary-soft text-text'
                : 'border-border bg-surface text-text hover:bg-surface-2',
              isAnswerKey && 'border-success bg-surface-2',
              wrongPick && 'border-danger bg-danger-soft',
            )}
          >
            <span
              className={clsx(
                'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border text-sm font-semibold',
                selected ? 'border-primary bg-primary text-primary-fg' : 'border-border text-text-2',
                isAnswerKey && 'border-success bg-success text-exam-on-state',
                wrongPick && 'border-danger bg-danger text-danger-fg',
              )}
            >
              {option.key}
            </span>
            <span className="flex-1">{option.text}</span>
            {isAnswerKey ? <Icon name="check" size={16} className="mt-1 shrink-0 text-success" /> : null}
          </button>
        );
      })}
    </div>
  );
}
