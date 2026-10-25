/**
 * 全屏加载 / 骨架视图。
 */
import { LOADING } from '@/constants';

export interface LoadingViewProps {
  /** 提示文案，默认「页面加载中…」 */
  message?: string;
  /** 是否全屏（占满内容区） */
  fullscreen?: boolean;
}

export function LoadingView({ message = LOADING.page, fullscreen = false }: LoadingViewProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        fullscreen
          ? 'flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg'
          : 'flex flex-col items-center justify-center gap-3 py-12'
      }
    >
      <span
        aria-hidden="true"
        className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary"
      />
      <p className="text-sm text-text-3">{message}</p>
    </div>
  );
}
