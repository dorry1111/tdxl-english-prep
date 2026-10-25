/**
 * 桌面版自绘标题栏（frameless 窗口专用）。
 *
 * - 36px 高，整条可拖动（-webkit-app-region: drag）；
 * - 右侧窗口按钮遵循 Windows 习惯：46px 宽、关闭键 hover 红；
 * - Web/PWA 形态不渲染（AppShell 用 IS_DESKTOP 判断）。
 */
import { useEffect, useState, type ReactElement } from 'react';

import { desktopApi } from '@/lib/desktop';

/** Windows Segoe Fluent 图标风格的极简窗口按钮（自绘 SVG，不引字体） */
function IconMinimize(): ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function IconMaximize({ maximized }: { maximized: boolean }): ReactElement {
  return maximized ? (
    // 还原（两方块）
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d="M2.5 2.5v-2h7v7h-2M.5 3.5h6v6h-6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  ) : (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function IconClose(): ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

/** 单词搜索入口（放大镜，独立小弹窗，不打断主界面） */
function IconSearch(): ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.4 9.4L13 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function TitleBar(): ReactElement {
  const [maximized, setMaximized] = useState(false);
  const api = desktopApi();

  useEffect(() => {
    if (!api) {
      return;
    }
    let disposed = false;
    void api.isMaximized().then((value) => {
      if (!disposed) {
        setMaximized(value);
      }
    });
    const un = api.onMaximizedChange(setMaximized);
    return () => {
      disposed = true;
      un();
    };
  }, [api]);

  return (
    <div className="tdxl-titlebar app-glass fixed inset-x-0 top-0 z-50 flex h-[var(--titlebar-h)] items-center justify-between border-b border-glass-border">
      <div className="flex items-center gap-2 pl-3">
        <span className="text-xs font-semibold text-text-2">同等学力英语备考</span>
      </div>
      <div className="flex items-center">
        {/* 功能区：单词搜索弹窗（主进程单例，重复点击只聚焦） */}
        <button
          type="button"
          className="tdxl-titlebar-btn"
          aria-label="单词搜索"
          title="单词搜索"
          onClick={() => api?.openSearch()}
        >
          <IconSearch />
        </button>
        <button
          type="button"
          className="tdxl-titlebar-btn"
          aria-label="最小化"
          onClick={() => api?.minimize()}
        >
          <IconMinimize />
        </button>
        <button
          type="button"
          className="tdxl-titlebar-btn"
          aria-label={maximized ? '还原' : '最大化'}
          onClick={() => api?.toggleMaximize()}
        >
          <IconMaximize maximized={maximized} />
        </button>
        <button
          type="button"
          className="tdxl-titlebar-btn close"
          aria-label="关闭"
          onClick={() => api?.close()}
        >
          <IconClose />
        </button>
      </div>
    </div>
  );
}
