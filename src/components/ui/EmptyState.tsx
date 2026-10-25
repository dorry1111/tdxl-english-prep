/**
 * 空状态 / 占位。
 *
 * 批次 1 的四个一级页面都用它做「说明将来放什么」的占位，
 * 刻意不放假数据：宁可空，也不能让界面显示不存在的进度。
 */
import type { ReactNode } from 'react';

import { Icon, type IconName } from './Icon';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: IconName;
  /** 底部引导按钮等 */
  action?: ReactNode;
  /** 是否使用紧凑间距（嵌在卡片里时用） */
  compact?: boolean;
}

export function EmptyState({ title, description, icon = 'sparkle', action, compact }: EmptyStateProps) {
  return (
    <div
      className={
        compact
          ? 'flex flex-col items-center gap-2 px-4 py-6 text-center'
          : 'flex flex-col items-center gap-3 px-6 py-12 text-center'
      }
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon name={icon} size={24} />
      </span>
      <h3 className="text-lg font-semibold text-text">{title}</h3>
      {description ? (
        <p className="max-w-[42ch] text-sm leading-relaxed text-text-3">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
