/**
 * 倒计时（T14）。
 *
 * - 展示 mm:ss（超 1 小时 h:mm:ss），由 store 的 remainingSec 驱动；
 * - 剩余 ≤ 5 分钟整段变红（COUNTDOWN_WARN_SEC）；
 * - 可暂停 / 继续（答题页把 onTogglePause 传进来即启用按钮）。
 */
import clsx from 'clsx';

import { COUNTDOWN_WARN_SEC, EXAMS } from '@/constants';

export interface CountdownProps {
  /** 剩余秒数 */
  remainingSec: number;
  paused: boolean;
  onTogglePause?: () => void;
  className?: string;
}

/** 秒 → h:mm:ss / mm:ss */
function formatClock(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(secs)}`;
  }
  return `${pad(minutes)}:${pad(secs)}`;
}

export function Countdown({ remainingSec, paused, onTogglePause, className }: CountdownProps) {
  const danger = remainingSec <= COUNTDOWN_WARN_SEC;
  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <output
        aria-label={EXAMS.countdownLabel}
        className={clsx(
          'rounded-md border px-3 py-1 font-mono text-lg font-semibold tabular-nums',
          danger
            ? 'border-danger bg-danger-soft text-danger'
            : 'border-border bg-surface-2 text-text',
          paused && !danger && 'text-text-3',
        )}
      >
        {formatClock(remainingSec)}
      </output>
      {onTogglePause ? (
        <button
          type="button"
          onClick={onTogglePause}
          aria-pressed={paused}
          className="app-tappable flex h-11 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-text-2"
        >
          {paused ? EXAMS.attemptResume : EXAMS.attemptPause}
        </button>
      ) : null}
    </div>
  );
}
