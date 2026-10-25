/**
 * 按钮（8 个原子组件之一）。
 *
 * 约束：
 * - 触控目标 ≥ 44×44（size='md' 起）；
 * - 支持 className 透传（页面可以用布局类覆盖宽度）；
 * - 焦点环统一由全局 `:focus-visible` 处理，不在组件里另写。
 */
import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 占满父容器宽度（移动端主 CTA） */
  block?: boolean;
  /** 左侧图标 */
  icon?: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-hover',
  secondary: 'bg-surface-2 text-text border border-border hover:bg-surface-2/80',
  danger: 'bg-danger text-danger-fg hover:opacity-90',
  ghost: 'bg-transparent text-text-2 hover:bg-surface-2',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  // 三种尺寸的命中高度都 ≥ 44px（T03 验收：所有可点元素触控目标 ≥ 44×44）
  sm: 'min-h-[44px] px-3 text-sm',
  md: 'min-h-[44px] px-4 text-base',
  lg: 'min-h-[52px] px-5 text-lg',
};

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-fast',
        'app-tappable select-none disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      {children}
    </button>
  );
}
