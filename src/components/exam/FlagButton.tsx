/**
 * 标记（旗标）按钮（QuestionView / DialogueGroupView 共用）。
 *
 * 只负责「已标记 / 未标记」的视觉与无障碍属性，翻页与落库由调用方的回调处理。
 */
import clsx from 'clsx';

import { EXAMS } from '@/constants';
import { Icon } from '@/components/ui/Icon';

export interface FlagButtonProps {
  flagged: boolean;
  onToggle: () => void;
  className?: string;
}

export function FlagButton({ flagged, onToggle, className }: FlagButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={flagged}
      aria-label={flagged ? EXAMS.attemptFlaggedOn : EXAMS.attemptFlagged}
      className={clsx(
        'app-tappable ms-auto flex h-11 items-center gap-1 rounded-md border px-3 text-sm font-medium',
        flagged
          ? 'border-exam-flagged bg-surface text-exam-flagged'
          : 'border-border bg-surface text-text-2',
        className,
      )}
    >
      <Icon name="alert" size={16} />
      {flagged ? EXAMS.attemptFlaggedOn : EXAMS.attemptFlagged}
    </button>
  );
}
