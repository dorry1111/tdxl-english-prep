/**
 * 口语交际整组视图（T16）：一段对话只显示一次，下面按空位顺序列出各组选项。
 *
 * 数据里对话正文被复制进每个空位的 stem（且只是窗口片段），逐题罗列会重复同一段对话。
 * 这里用 lib/exam/dialogueGroup 还原出一段完整正文（空位写作 `____(N)` 长下划线标记），
 * 再按空位顺序渲染选项；选中 / 标记 / 解析对错 / 禁用等状态复用 OptionList，与单题视图一致。
 */
import clsx from 'clsx';

import { EXAMS } from '@/constants';
import { BlankMarker } from '@/components/exam/BlankMarker';
import { FlagButton } from '@/components/exam/FlagButton';
import { OptionList, type QuestionViewReview } from '@/components/exam/OptionList';
import { Tag } from '@/components/ui/Tag';
import { splitDialogueText, type DialogueGroup } from '@/lib/exam/dialogueGroup';
import type { Question } from '@/types';

/** 单个空位的作答状态 */
export interface DialogueBlankState {
  /** 已选选项字母 */
  choice: string | null;
  /** 是否已标记 */
  flagged: boolean;
}

export interface DialogueGroupViewProps {
  /** 口语组（含还原后的正文） */
  group: DialogueGroup;
  /** 取每个空位的作答状态 */
  stateOf: (question: Question) => DialogueBlankState;
  /** 选择选项（questionId + 选项键） */
  onChoice: (questionId: string, key: string) => void;
  /** 切换标记；不传则不显示标记按钮 */
  onToggleFlag?: (questionId: string) => void;
  /** 当前聚焦的空位序号（主题色高亮 + 卡片描边） */
  activeBlank?: number | null;
  /** 禁用输入（暂停 / 交卷后） */
  disabled?: boolean;
  /** 解析回看模式：取每个空位的回看数据；返回 undefined 表示答题模式 */
  reviewOf?: (question: Question) => QuestionViewReview | undefined;
  className?: string;
}

export function DialogueGroupView({
  group,
  stateOf,
  onChoice,
  onToggleFlag,
  activeBlank = null,
  disabled = false,
  reviewOf,
  className,
}: DialogueGroupViewProps) {
  const parts = splitDialogueText(group.text);

  return (
    <section className={clsx('flex flex-col gap-3', className)}>
      {/* 对话正文：整组只出现一次 */}
      <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
        <p className="text-xs font-semibold text-text-2">{EXAMS.dialogueScriptTitle}</p>
        <p className="whitespace-pre-wrap text-base leading-relaxed text-text">
          {parts.map((part, index) =>
            part.kind === 'blank' ? (
              <BlankMarker key={index} value={part.blank} active={part.blank === activeBlank} />
            ) : (
              part.text
            ),
          )}
        </p>
      </div>

      {/* 各空位选项（按空位顺序） */}
      {group.questions.map((question) => {
        const state = stateOf(question);
        const review = reviewOf?.(question);
        const blank = question.blankIndex ?? question.seq;
        const active = blank === activeBlank;
        return (
          <div
            key={question.id}
            data-blank-block={blank}
            className={clsx(
              'flex flex-col gap-2 rounded-lg px-1 py-1 ring-1',
              active ? 'ring-primary' : 'ring-transparent',
            )}
          >
            <header className="flex items-center gap-2">
              <span className="text-base font-semibold text-text">{question.seq}.</span>
              <Tag>{EXAMS.examBlankBadge(blank)}</Tag>
              {review ? (
                review.isCorrect === true ? (
                  <Tag color="var(--c-success)">{EXAMS.reviewCorrect}</Tag>
                ) : review.isCorrect === false ? (
                  <Tag color="var(--c-danger)">{EXAMS.reviewWrong}</Tag>
                ) : question.answerKey === null ? (
                  <Tag color="var(--c-warn)">{EXAMS.reviewAnswerPending}</Tag>
                ) : null
              ) : null}
              {onToggleFlag && !review ? (
                <FlagButton
                  flagged={state.flagged}
                  onToggle={() => onToggleFlag(question.id)}
                />
              ) : null}
            </header>
            <OptionList
              question={question}
              choice={state.choice}
              onChoice={(key) => onChoice(question.id, key)}
              disabled={disabled}
              review={review}
            />
            {/* 解析回看：整组所有空位的解析全部展开（用户拍板「全组解析都展开」） */}
            {review ? (
              <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
                <p className="text-xs font-semibold text-text-2">{EXAMS.reviewExplanationTitle}</p>
                <p className="whitespace-pre-wrap text-sm text-text">
                  {question.explanation !== '' ? question.explanation : EXAMS.reviewExplanationEmpty}
                </p>
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
