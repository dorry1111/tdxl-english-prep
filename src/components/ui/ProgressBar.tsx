/**
 * 进度条：会话进度、导入进度、SW 缓存进度共用。
 */
import clsx from 'clsx';

export interface ProgressBarProps {
  value: number;
  max: number;
  /** 左侧说明文字 */
  label?: string;
  /** 是否在右侧显示百分比 */
  showPercent?: boolean;
  className?: string;
}

export function ProgressBar({ value, max, label, showPercent, className }: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const percent = Math.round((clamped / safeMax) * 100);

  return (
    <div className={clsx('w-full', className)}>
      {label || showPercent ? (
        <div className="mb-1 flex items-center justify-between text-xs text-text-3">
          <span>{label}</span>
          {showPercent ? <span>{percent}%</span> : null}
        </div>
      ) : null}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-label={label ?? '进度'}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-base ease-app"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
