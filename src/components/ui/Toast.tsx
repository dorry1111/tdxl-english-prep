/**
 * 轻提示（Toast）容器。
 *
 * 放在 App 根部，订阅 uiStore.toasts；
 * 每条 3 秒后自动消失，最多同时显示 3 条（store 里已截断）。
 */
import clsx from 'clsx';
import { useEffect } from 'react';

import { useUiStore, type ToastItem } from '@/store/uiStore';
import { ACTIONS } from '@/constants';

import { Icon, type IconName } from './Icon';

/** 单条 Toast 的自动消失时间 */
const TOAST_DURATION_MS = 3000;

const KIND_STYLE: Record<ToastItem['kind'], { icon: IconName; colorClass: string }> = {
  success: { icon: 'check', colorClass: 'text-success' },
  error: { icon: 'alert', colorClass: 'text-danger' },
  info: { icon: 'sparkle', colorClass: 'text-primary' },
};

function ToastRow({ toast }: { toast: ToastItem }) {
  const dismissToast = useUiStore((state) => state.dismissToast);
  const style = KIND_STYLE[toast.kind];

  useEffect(() => {
    const timer = window.setTimeout(() => dismissToast(toast.id), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [dismissToast, toast.id]);

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex w-full max-w-[420px] items-start gap-2 rounded-md border border-border bg-surface px-4 py-3 text-sm text-text shadow-e2"
    >
      <span className={clsx('mt-0.5 shrink-0', style.colorClass)}>
        <Icon name={style.icon} size={16} />
      </span>
      <span className="flex-1">{toast.message}</span>
      <button
        type="button"
        aria-label={ACTIONS.close}
        onClick={() => dismissToast(toast.id)}
        className="app-tappable -mr-1 flex h-11 w-11 shrink-0 items-center justify-center text-text-3"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useUiStore((state) => state.toasts);
  if (toasts.length === 0) {
    return null;
  }
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--nav-h)+var(--safe-bottom)+12px)] z-50 flex flex-col items-center gap-2 px-4 tablet:bottom-6">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
