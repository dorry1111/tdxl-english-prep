/**
 * 弹窗迷你标题栏（搜索弹窗等 frameless 小窗口专用）。
 *
 * 与主窗口 TitleBar 的差异：
 * - 不可最大化（固定尺寸工具窗），只有关闭按钮；
 * - 标题文字可变（弹窗用途名）；
 * - 复用 tdxl-titlebar / tdxl-titlebar-btn 样式，拖动区一致。
 */
import { type ReactElement } from 'react';

import { desktopApi } from '@/lib/desktop';

function IconClose(): ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function PopupTitleBar({ title }: { title: string }): ReactElement {
  return (
    <div className="tdxl-titlebar app-glass fixed inset-x-0 top-0 z-50 flex h-[var(--titlebar-h)] items-center justify-between border-b border-glass-border">
      <div className="flex items-center gap-2 pl-3">
        <span className="text-xs font-semibold text-text-2">{title}</span>
      </div>
      <div className="flex items-center">
        <button
          type="button"
          className="tdxl-titlebar-btn close"
          aria-label="关闭"
          onClick={() => desktopApi()?.close()}
        >
          <IconClose />
        </button>
      </div>
    </div>
  );
}
