/**
 * 数字步进器：每日新词上限（1~200）、语速等小范围数值输入。
 *
 * 交互细节：
 * - 两个按钮都是 44×44，符合触控要求；
 * - 中间是 number input，键盘可直接输入，失焦时收敛到 [min, max]；
 * - 到达边界时按钮禁用并给出 aria-disabled。
 */
import clsx from 'clsx';
import { useEffect, useState } from 'react';

import { Icon } from './Icon';

export interface NumberStepperProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** 无障碍名称，如「每日新词上限」 */
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

export function NumberStepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
  disabled = false,
  className,
}: NumberStepperProps) {
  // 输入框保留字符串态，允许用户中途输入「1」再输「0」组成 10
  const [draft, setDraft] = useState<string>(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (next: number): void => {
    const clamped = Math.min(Math.max(next, min), max);
    onChange(clamped);
    setDraft(String(clamped));
  };

  const canDecrease = !disabled && value > min;
  const canIncrease = !disabled && value < max;

  return (
    <div className={clsx('inline-flex items-center gap-1', className)}>
      <button
        type="button"
        aria-label={`${ariaLabel}减少`}
        aria-disabled={!canDecrease}
        disabled={!canDecrease}
        onClick={() => commit(value - step)}
        className="app-tappable flex h-11 w-11 items-center justify-center rounded-md border border-border bg-surface text-text-2 disabled:opacity-40"
      >
        <span aria-hidden="true" className="text-lg leading-none">
          −
        </span>
      </button>

      <input
        type="number"
        inputMode="numeric"
        aria-label={ariaLabel}
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const parsed = Number(draft);
          commit(Number.isFinite(parsed) && draft.trim() !== '' ? parsed : value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
        }}
        className="h-11 w-16 rounded-md border border-border bg-surface text-center text-base text-text"
      />

      <button
        type="button"
        aria-label={`${ariaLabel}增加`}
        aria-disabled={!canIncrease}
        disabled={!canIncrease}
        onClick={() => commit(value + step)}
        className="app-tappable flex h-11 w-11 items-center justify-center rounded-md border border-border bg-surface text-text-2 disabled:opacity-40"
      >
        <Icon name="chevron-right" size={16} className="rotate-90" />
      </button>
    </div>
  );
}
