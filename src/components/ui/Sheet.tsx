/**
 * 底部抽屉（移动端）：答题卡、退出确认、选项面板等。
 *
 * iOS 细节（ARCHITECTURE 8.2 / 8.7）：
 * - 打开时锁 body 滚动，且用 position: fixed + 记录 scrollTop，否则 iOS 上仅设
 *   overflow:hidden 不生效；
 * - 关闭后恢复原来的滚动位置。
 */
import clsx from 'clsx';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { ACTIONS } from '@/constants';

import { Icon } from './Icon';

export interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 底部按钮区 */
  footer?: ReactNode;
  /** 抽屉最大高度类，默认 80dvh */
  heightClassName?: string;
}

export function Sheet({ open, title, onClose, children, footer, heightClassName }: SheetProps) {
  const scrollTopRef = useRef(0);

  // body 滚动锁定（iOS 需要 position:fixed 才真正锁定）
  useEffect(() => {
    if (!open) {
      return;
    }
    const { body } = document;
    scrollTopRef.current = window.scrollY;
    body.classList.add('app-body-locked');
    body.style.top = `-${scrollTopRef.current}px`;

    return () => {
      body.classList.remove('app-body-locked');
      body.style.top = '';
      window.scrollTo({ top: scrollTopRef.current, behavior: 'instant' as ScrollBehavior });
    };
  }, [open]);

  // Esc 关闭
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* 遮罩：点击关闭 */}
      <button
        type="button"
        aria-label={ACTIONS.close}
        onClick={onClose}
        className="absolute inset-0 bg-overlay"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          'relative flex w-full flex-col rounded-t-xl border-t border-border bg-surface',
          heightClassName ?? 'max-h-[80dvh]',
        )}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={ACTIONS.close}
            className="app-tappable flex h-11 w-11 items-center justify-center rounded-md text-text-2"
          >
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="app-no-scrollbar flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer ? (
          <div className="border-t border-border px-4 py-3 app-safe-bottom">{footer}</div>
        ) : (
          <div className="app-safe-bottom" />
        )}
      </div>
    </div>,
    document.body,
  );
}
