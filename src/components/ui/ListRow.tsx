/**
 * 通用列表行：左主文案 + 右副文案 + 箭头。
 * 可点击时整体渲染为 button，保证键盘可达与 44px 命中区。
 */
import clsx from 'clsx';
import type { ReactNode } from 'react';

import { Icon } from './Icon';

export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** 右侧文案（如「12 个」「已学 860」） */
  meta?: ReactNode;
  /** 右侧任意内容（优先于 meta） */
  right?: ReactNode;
  onClick?: () => void;
  /** 是否显示右箭头，默认有 onClick 时显示 */
  showChevron?: boolean;
  className?: string;
}

export function ListRow({
  title,
  subtitle,
  meta,
  right,
  onClick,
  showChevron,
  className,
}: ListRowProps) {
  const isClickable = typeof onClick === 'function';
  const shouldShowChevron = showChevron ?? isClickable;
  const content = (
    <>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-base text-text">{title}</span>
        {subtitle ? <span className="mt-1 block text-sm text-text-3">{subtitle}</span> : null}
      </span>
      {right ? (
        <span className="shrink-0">{right}</span>
      ) : meta !== undefined ? (
        <span className="shrink-0 text-sm text-text-2">{meta}</span>
      ) : null}
      {shouldShowChevron ? <Icon name="chevron-right" size={16} className="shrink-0 text-text-3" /> : null}
    </>
  );

  if (!isClickable) {
    return (
      <div className={clsx('flex w-full items-center gap-3 px-4 py-3', className)}>{content}</div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'app-tappable flex w-full min-h-[52px] items-center gap-3 px-4 py-3 text-left',
        'transition-colors duration-fast hover:bg-surface-2 active:bg-surface-2',
        className,
      )}
    >
      {content}
    </button>
  );
}
