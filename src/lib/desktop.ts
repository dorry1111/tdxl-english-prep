/**
 * 桌面形态（Electron）检测与 API 访问。
 *
 * 约定：preload 通过 contextBridge 暴露 `window.tdxl`，
 * Web/PWA 形态下该属性为 undefined —— 这就是形态判断的唯一依据。
 * 前端代码严禁直接 process.versions 之类判断（jsdom 测试环境会挂）。
 */

/** 与 electron/preload.ts 暴露的 API 保持一致 */
export interface TdxlDesktopApi {
  isDesktop: true;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
  /** 单词搜索弹窗（主进程单例：已开则聚焦） */
  openSearch: () => void;
  getConfig: () => Promise<DesktopConfigBridge>;
  setConfig: (patch: Partial<DesktopConfigBridge>) => Promise<DesktopConfigBridge>;
  setThemeSource: (mode: 'system' | 'light' | 'dark') => Promise<void>;
  /** 本机局域网 IPv4 列表（同步卡「连接 NAS」子网探测用，v1.9.0） */
  getLanIps: () => Promise<string[]>;
  openDataDir: () => Promise<void>;
  exportFile: (defaultName: string, contents: string) => Promise<string | null>;
  pickImportFile: () => Promise<{ name: string; content: string } | null>;
}

export interface DesktopConfigBridge {
  material: 'auto' | 'acrylic' | 'blur' | 'solid';
  closeToTray: boolean;
  autoLaunch: boolean;
}

declare global {
  interface Window {
    tdxl?: TdxlDesktopApi;
  }
}

/** 当前是否运行在桌面壳里（模块加载时确定，整个会话不变） */
export const IS_DESKTOP = typeof window !== 'undefined' && window.tdxl?.isDesktop === true;

/** 取桌面 API（非桌面形态返回 undefined） */
export function desktopApi(): TdxlDesktopApi | undefined {
  return typeof window !== 'undefined' ? window.tdxl : undefined;
}
