/**
 * 分段控件：主题三态、题型筛选等。
 *
 * 无障碍：外层 role="radiogroup"，每个选项是 role="radio" + aria-checked，
 * 键盘 Tab 可进入，方向键行为交给浏览器默认的 radio 语义（这里用按钮实现，
 * 因此额外支持 Enter/Space 触发）。
 */
import clsx from 'clsx';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** 无障碍名称 */
  ariaLabel: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={clsx(
        'inline-flex w-full items-stretch gap-1 rounded-md border border-border bg-surface-2 p-1',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={clsx(
              'app-tappable flex-1 rounded-sm font-medium transition-colors duration-fast',
              // 两种尺寸的命中高度都 ≥ 44px
              size === 'sm' ? 'min-h-[44px] text-sm' : 'min-h-[44px] text-base',
              active
                ? 'bg-surface text-text shadow-e1'
                : 'bg-transparent text-text-2 hover:text-text',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
