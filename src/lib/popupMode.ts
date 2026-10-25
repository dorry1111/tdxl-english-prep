/**
 * 桌面弹窗模式标记。
 *
 * 搜索弹窗等独立小窗口加载 `tdxl://app/index.html?popup=search#/...`，
 * query 里的 `popup=<name>` 让 AppShell 走精简壳（无侧栏/底栏/TopBar，
 * 只有一条可拖动的迷你标题栏），弹窗内可以正常 SPA 导航。
 *
 * 与 IS_DESKTOP 同风格：模块加载时确定，整个窗口生命周期不变。
 */
export const POPUP_MODE: string | null =
  typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('popup')
    : null;

/** 弹窗用途 → 迷你标题栏文案 */
export const POPUP_TITLES: Record<string, string> = {
  search: '单词搜索',
} as const;
