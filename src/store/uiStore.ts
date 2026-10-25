/**
 * 全局 UI 状态（Zustand）：主题、Toast 队列、PWA 更新状态。
 *
 * 为什么用 Zustand 而不是 Context：会话里高频更新的状态会引发整棵树重渲染；
 * Zustand 的 selector 订阅可以做到「只有用到的组件重渲染」（ARCHITECTURE 1.1）。
 *
 * 主题三态（auto/light/dark）：
 * - 立即写 `<html class="dark">` 并持久化到 localStorage（T05 之后再迁到 IndexedDB 的 Settings）；
 * - auto 模式监听 `prefers-color-scheme`，系统切换时自动跟随。
 */
import { create } from 'zustand';

import { BG_THEME_STORAGE_KEY, THEME_STORAGE_KEY } from '@/constants/routes';
import { newId } from '@/lib/id';
import type { BgTheme, ThemeMode } from '@/types';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
}

interface UiState {
  /** 当前主题模式 */
  theme: ThemeMode;
  /** 背景颜色主题（只影响浅色态底色；深色态由 theme 决定） */
  bgTheme: BgTheme;
  /** SW 已就绪、可以提示用户更新（会话中会被 defer） */
  updateReady: boolean;
  /** 会话中检测到更新，等退出会话再提示 */
  pendingUpdate: boolean;
  /** 当前显示的 Toast（最多 3 条） */
  toasts: ToastItem[];

  setTheme: (theme: ThemeMode) => void;
  setBgTheme: (bg: BgTheme) => void;
  setUpdateReady: (ready: boolean) => void;
  setPendingUpdate: (pending: boolean) => void;
  pushToast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: string) => void;

  /** 便捷方法，避免每处都写 pushToast('error', ...) */
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
  };
}

/** 读取系统是否偏好深色 */
function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 根据主题模式判断当前是否应为深色 */
export function resolveIsDark(theme: ThemeMode): boolean {
  if (theme === 'dark') {
    return true;
  }
  if (theme === 'light') {
    return false;
  }
  return systemPrefersDark();
}

/** 把主题落到 DOM（只切 `<html class="dark">`，CSS 变量自动生效） */
function paintTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.classList.toggle('dark', resolveIsDark(theme));
}

/** 把背景颜色落到 DOM（`<html data-bg="...">`，tokens.css 按属性选择器换底色） */
function paintBgTheme(bg: BgTheme): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.dataset.bg = bg;
}

/** 从 localStorage 读取上次选择的背景颜色（非法值回落 classic） */
function readStoredBgTheme(): BgTheme {
  try {
    const raw = window.localStorage.getItem(BG_THEME_STORAGE_KEY);
    if (raw === 'classic' || raw === 'green' || raw === 'paper' || raw === 'gray') {
      return raw;
    }
  } catch {
    // 隐私模式下 localStorage 可能抛异常，忽略即可
  }
  return 'classic';
}

/** 持久化背景颜色（失败不影响使用） */
function storeBgTheme(bg: BgTheme): void {
  try {
    window.localStorage.setItem(BG_THEME_STORAGE_KEY, bg);
  } catch {
    // 忽略：存储不可用时设置仍在本次会话内生效
  }
}

/** 从 localStorage 读取上次选择的主题（非法值回落 auto） */
function readStoredTheme(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'auto' || raw === 'light' || raw === 'dark') {
      return raw;
    }
  } catch {
    // 隐私模式下 localStorage 可能抛异常，忽略即可
  }
  return 'auto';
}

/** 持久化主题（失败不影响使用，只是下次启动回到 auto） */
function storeTheme(theme: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 忽略：存储不可用时主题仍在本次会话内生效
  }
}

export const useUiStore = create<UiState>()((set, get) => ({
  theme: 'auto',
  bgTheme: 'classic',
  updateReady: false,
  pendingUpdate: false,
  toasts: [],

  setTheme: (theme) => {
    paintTheme(theme);
    storeTheme(theme);
    set({ theme });
  },

  setBgTheme: (bgTheme) => {
    paintBgTheme(bgTheme);
    storeBgTheme(bgTheme);
    set({ bgTheme });
  },

  setUpdateReady: (ready) => set({ updateReady: ready }),

  setPendingUpdate: (pending) => set({ pendingUpdate: pending }),

  pushToast: (kind, message) => {
    const item: ToastItem = { id: newId('toast'), kind, message };
    set((state) => ({ toasts: [...state.toasts, item].slice(-3) }));
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  toast: {
    success: (message) => get().pushToast('success', message),
    error: (message) => get().pushToast('error', message),
    info: (message) => get().pushToast('info', message),
  },
}));

/**
 * 启动时调用一次：恢复上次主题 + 监听系统配色变化。
 * 返回取消监听的函数（热更新/测试时清理用）。
 */
export function initTheme(): () => void {
  const theme = readStoredTheme();
  paintTheme(theme);
  useUiStore.setState({ theme });

  const bgTheme = readStoredBgTheme();
  paintBgTheme(bgTheme);
  useUiStore.setState({ bgTheme });

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = (): void => {
    // 只有 auto 模式需要跟随系统；手动选定的模式不受影响
    if (useUiStore.getState().theme === 'auto') {
      paintTheme('auto');
    }
  };
  media.addEventListener('change', handleChange);
  return () => media.removeEventListener('change', handleChange);
}
