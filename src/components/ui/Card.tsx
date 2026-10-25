/**
 * 卡片容器：圆角 12px、surface 底色、可选标题与右侧操作。
 */
import clsx from 'clsx';
import type { ReactNode } from 'react';

export interface CardProps {
  title?: ReactNode;
  /** 标题右侧的操作区（按钮、标签等） */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** 内容区额外的 className（控制内边距等） */
  bodyClassName?: string;
}

export function Card({ title, action, children, className, bodyClassName }: CardProps) {
  return (
    <section
      className={clsx(
        'rounded-lg border border-border bg-surface shadow-e1',
        className,
      )}
    >
      {title || action ? (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          {title ? <h2 className="text-base font-semibold text-text">{title}</h2> : <span />}
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </header>
      ) : null}
      <div className={clsx('px-4 py-4', bodyClassName)}>{children}</div>
    </section>
  );
}
