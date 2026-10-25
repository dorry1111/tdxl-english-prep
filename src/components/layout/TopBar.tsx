/**
 * 顶栏：页面标题 + （手机端）单词搜索入口 + 主题切换。
 *
 * 倒计时与右侧操作（T10）后续批次接入；这里先把位置和高度占好，
 * 避免页面各自实现一遍头部。
 *
 * 单词搜索按钮：仅网页/PWA 形态渲染 —— 桌面版的搜索入口在自绘标题栏
 * 右上角功能区（独立弹窗），主窗口内不再放重复入口。
 */
import { useLocation, useNavigate } from 'react-router';

import { Icon, type IconName } from '@/components/ui/Icon';
import { needsBackButton, ROUTES, THEME_LABEL, titleOfPath } from '@/constants';
import { IS_DESKTOP } from '@/lib/desktop';
import { useUiStore } from '@/store/uiStore';
import type { ThemeMode } from '@/types';

/** 主题循环顺序：跟随系统 → 浅色 → 深色 → 跟随系统 */
const NEXT_THEME: Record<ThemeMode, ThemeMode> = {
  auto: 'light',
  light: 'dark',
  dark: 'auto',
};

const THEME_ICON: Record<ThemeMode, IconName> = {
  auto: 'auto',
  light: 'sun',
  dark: 'moon',
};

export function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const title = titleOfPath(location.pathname);
  // 次级页面给返回按钮；会话页（背单词/答题）保持不打断，走页面内的退出确认
  const showBack = needsBackButton(location.pathname);

  return (
    <header className="app-topbar sticky top-0 z-20 border-b border-border bg-bg pt-[var(--safe-top)]">
      <div className="mx-auto flex h-[var(--nav-h)] w-full max-w-[720px] items-center justify-between gap-3 px-4 tablet:max-w-[960px] desktop:max-w-content">
        <div className="flex min-w-0 items-center gap-1">
          {showBack ? (
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="返回上一页"
              title="返回"
              className="app-tappable -ms-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-2 hover:bg-surface-2"
            >
              <Icon name="chevron-right" size={20} className="rotate-180" />
            </button>
          ) : null}
          <h1 className="truncate text-lg font-semibold text-text">{title}</h1>
        </div>
        <div className="flex shrink-0 items-center">
          {/* 单词搜索：放在主题切换左侧（仅手机/网页端） */}
          {!IS_DESKTOP ? (
            <button
              type="button"
              onClick={() => navigate(ROUTES.search)}
              aria-label="单词搜索"
              title="单词搜索"
              className="app-tappable flex h-11 w-11 items-center justify-center rounded-md text-text-2 hover:bg-surface-2"
            >
              <Icon name="sparkle" size={20} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setTheme(NEXT_THEME[theme])}
            aria-label={`${THEME_LABEL[theme]}，点击切换`}
            title={THEME_LABEL[theme]}
            className="app-tappable flex h-11 w-11 items-center justify-center rounded-md text-text-2 hover:bg-surface-2"
          >
            <Icon name={THEME_ICON[theme]} size={20} />
          </button>
        </div>
      </div>
    </header>
  );
}
