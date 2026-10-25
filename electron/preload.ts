/**
 * 预加载脚本：contextBridge 暴露最小桌面 API（window.tdxl）。
 *
 * 约定：
 * - Web（PWA）形态下 window.tdxl === undefined，前端一律用它做形态判断；
 * - 只暴露 IPC 转发，不放任何 Node 能力（sandbox 下也没有）。
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface DesktopConfigBridge {
  material: 'auto' | 'acrylic' | 'blur' | 'solid';
  closeToTray: boolean;
  autoLaunch: boolean;
}

const api = {
  /** 桌面形态标记（web 端 undefined） */
  isDesktop: true as const,

  // 窗口控制
  minimize: (): void => ipcRenderer.send('tdxl:minimize'),
  toggleMaximize: (): void => ipcRenderer.send('tdxl:toggle-maximize'),
  close: (): void => ipcRenderer.send('tdxl:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('tdxl:is-maximized'),
  onMaximizedChange: (callback: (maximized: boolean) => void): (() => void) => {
    const listener = (_event: unknown, maximized: boolean): void => callback(maximized);
    ipcRenderer.on('tdxl:maximized', listener);
    return () => ipcRenderer.removeListener('tdxl:maximized', listener);
  },

  /** 单词搜索弹窗（主进程单例：已开则聚焦） */
  openSearch: (): void => ipcRenderer.send('tdxl:open-search'),

  // 配置
  getConfig: (): Promise<DesktopConfigBridge> => ipcRenderer.invoke('tdxl:get-config'),
  setConfig: (patch: Partial<DesktopConfigBridge>): Promise<DesktopConfigBridge> =>
    ipcRenderer.invoke('tdxl:set-config', patch),

  // 主题跟随（auto/light/dark → nativeTheme）
  setThemeSource: (mode: 'system' | 'light' | 'dark'): Promise<void> =>
    ipcRenderer.invoke('tdxl:set-theme-source', mode),

  // 本机局域网 IPv4（同步卡「连接 NAS」子网探测用）
  getLanIps: (): Promise<string[]> => ipcRenderer.invoke('tdxl:get-lan-ips'),

  // 数据目录
  openDataDir: (): Promise<void> => ipcRenderer.invoke('tdxl:open-data-dir'),

  // 全库导出/导入（系统对话框）
  exportFile: (defaultName: string, contents: string): Promise<string | null> =>
    ipcRenderer.invoke('tdxl:export-file', { defaultName, contents }),
  pickImportFile: (): Promise<{ name: string; content: string } | null> =>
    ipcRenderer.invoke('tdxl:pick-import-file'),
};

contextBridge.exposeInMainWorld('tdxl', api);

export type TdxlDesktopApi = typeof api;
