/**
 * 小标签：题型、词性、状态。
 *
 * 颜色通过 `color` 传入 CSS 变量值（如 SECTION_META[...].color）。
 * 注意：不使用 `color-mix()` 做半透明底——它要求 iOS 16.4+，
 * 而本项目支持下限是 iOS 16.0（这也是不用 Tailwind v4 的同一个原因）。
 * 这里用「颜色描边 + 颜色文字 + 中性底」表达同样的语义。
 */
import clsx from 'clsx';
import type { CSSProperties, ReactNode } from 'react';

export interface TagProps {
  children: ReactNode;
  /** 主色，通常是 var(--c-xxx) */
  color?: string;
  /** 尺寸 */
  size?: 'sm' | 'md';
  className?: string;
}

export function Tag({ children, color, size = 'sm', className }: TagProps) {
  const style: CSSProperties | undefined = color
    ? { color, borderColor: color, backgroundColor: 'var(--c-surface)' }
    : undefined;

  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-sm border font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
        !color && 'border-border bg-surface-2 text-text-2',
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}
