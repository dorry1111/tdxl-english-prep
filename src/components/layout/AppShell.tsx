/**
 * 四端布局骨架（PRD 6.2.1 断点表）。
 *
 * | 断点            | 导航               | 内容宽度 |
 * |-----------------|--------------------|----------|
 * | < 640px         | 底部标签栏 56px    | 自适应   |
 * | 640 ~ 1023px    | 底部标签栏 56px    | ≤ 720px  |
 * | 1024 ~ 1279px   | 左侧图标导轨 72px  | ≤ 960px  |
 * | ≥ 1280px        | 左侧侧边栏 220px   | ≤ 1200px |
 *
 * 导航形态的选择：640~1023px 统一沿用底部标签栏（PRD 允许「底部标签栏 或 顶部精简导航」二选一，
 * 这里选底部：与手机端一致，减少一套导航实现与样式分支）。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { CommandPalette } from '@/components/desktop/CommandPalette';
import { PopupTitleBar } from '@/components/desktop/PopupTitleBar';
import { TitleBar } from '@/components/desktop/TitleBar';
import { LAYOUT, NAV_ITEMS } from '@/constants';
import { desktopApi, IS_DESKTOP } from '@/lib/desktop';
import { POPUP_MODE, POPUP_TITLES } from '@/lib/popupMode';
import { useUiStore } from '@/store/uiStore';

import { OfflineBanner } from './OfflineBanner';
import { Rail } from './Rail';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { TopBar } from './TopBar';

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const theme = useUiStore((state) => state.theme);
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);

  /* ---- 桌面形态专属接线（Web/PWA 下全部跳过） ---- */
  useEffect(() => {
    if (!IS_DESKTOP) {
      return;
    }
    const api = desktopApi();
    if (!api) {
      return;
    }
    // 材质标记：纯色兜底时 CSS 退回实色，其余用玻璃
    void api.getConfig().then((config) => {
      document.documentElement.dataset.material = config.material === 'solid' ? 'solid' : 'glass';
    });
  }, []);

  useEffect(() => {
    if (!IS_DESKTOP) {
      return;
    }
    // 主题三态同步到主进程 nativeTheme（影响窗口描边等系统级配色）
    const source = theme === 'auto' ? ('system' as const) : theme;
    void desktopApi()?.setThemeSource(source);
  }, [theme]);

  useEffect(() => {
    if (!IS_DESKTOP) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      // Alt + ←：桌面版返回（Windows 惯例）
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        navigate(-1);
        return;
      }
      if (!event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      if (event.key === 'k' || event.key === 'K') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      const index = Number(event.key) - 1;
      const target = NAV_ITEMS[index];
      if (target) {
        event.preventDefault();
        navigate(target.path);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  // ---- 弹窗模式（搜索弹窗等独立小窗口）：精简壳，不渲染主导航 ----
  if (POPUP_MODE !== null) {
    return (
      <div className="min-h-dvh pt-[var(--titlebar-h)] text-text">
        <PopupTitleBar title={POPUP_TITLES[POPUP_MODE] ?? '同等学力备考'} />
        <main id="main-content" className="mx-auto w-full max-w-[520px] px-4 pb-6 pt-3">
          {children}
        </main>
      </div>
    );
  }

  return (
    /* 桌面形态：根容器透明（亚克力透出），顶部让位给自绘标题栏 */
    <div
      className={
        IS_DESKTOP ? 'min-h-dvh pt-[var(--titlebar-h)] text-text' : 'min-h-dvh bg-bg text-text'
      }
    >
      {IS_DESKTOP ? <TitleBar /> : null}

      {/* 键盘/读屏用户跳过导航 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-text"
      >
        {LAYOUT.skipToContent}
      </a>

      <Sidebar />
      <Rail />

      <div className="tablet:pl-rail desktop:pl-sidebar">
        <TopBar />
        <OfflineBanner />
        <main
          id="main-content"
          className="mx-auto w-full max-w-[720px] px-4 pb-[calc(var(--nav-h)+var(--safe-bottom)+24px)] pt-4 tablet:max-w-[960px] tablet:pb-8 desktop:max-w-content"
        >
          {children}
        </main>
      </div>

      <TabBar />

      {IS_DESKTOP ? (
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      ) : null}
    </div>
  );
}
