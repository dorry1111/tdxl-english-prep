/**
 * Electron 主进程入口。
 *
 * 职责：
 * 1. 无边框主窗口（frame:false）+ 窗口材质分层降级（见 acrylic.ts）；
 * 2. 单实例锁定：二次启动聚焦已有窗口；
 * 3. 托盘常驻：关闭默认最小化到托盘（可在设置里改成直接退出）；
 * 4. 窗口位置/尺寸记忆；
 * 5. IPC：窗口控制、配置读写、数据导出/导入系统对话框、打开数据目录、开机自启。
 *
 * 生产环境加载 dist-desktop/index.html（vite --base=./ 的独立构建，
 * 不带 PWA service worker，避免 file:// 下注册报错）。
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { applyMaterial, type MaterialChoice } from './acrylic';
import { applyAutoLaunch, loadConfig, saveConfig, type DesktopConfig } from './config';
import { DEFAULT_HEIGHT, DEFAULT_WIDTH, loadWindowState, MIN_HEIGHT, MIN_WIDTH, saveWindowState } from './windowState';

const DEV_SERVER_URL = process.env.TDXL_DEV_SERVER_URL ?? '';

/** 桌面版前端资源目录（asar 内 dist-desktop/） */
const WEB_ROOT = path.join(__dirname, '..', 'dist-desktop');

/**
 * 自定义协议：必须在 app ready 前注册特权。
 *
 * 为什么不用 loadFile：file:// 下 Vite 构建的 `type="module"` 脚本被
 * Chromium 强制 CORS 检查拦截（origin=null），页面变成空壳灰屏。
 * 自定义 standard + secure 协议让页面跑在"正常源"上，绝对/相对路径都能解析。
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'tdxl', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/** SPA 路由 fallback：文件不存在时回 index.html */
function registerWebProtocol(): void {
  protocol.handle('tdxl', async (request) => {
    try {
      const url = new URL(request.url);
      // tdxl://app/<path>；host 固定 'app'，其余当作路径
      let pathname = decodeURIComponent(url.pathname);
      if (url.host && url.host !== 'app') {
        pathname = `/${url.host}${pathname}`;
      }
      let filePath = path.join(WEB_ROOT, pathname);
      // 防目录穿越
      if (!path.resolve(filePath).startsWith(path.resolve(WEB_ROOT))) {
        return new Response('forbidden', { status: 403 });
      }
      // 路径不存在（如 tdxl://app/study）或指向目录时回退 index.html
      let stat: fs.Stats | null = null;
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        stat = null;
      }
      if (!stat || stat.isDirectory()) {
        filePath = path.join(WEB_ROOT, 'index.html');
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (error) {
      appendLog(`[protocol] ${request.url} 处理失败: ${String(error)}`);
      return new Response('internal error', { status: 500 });
    }
  });
}

/** 主题三态映射（renderer uiStore 的 ThemeMode 与 nativeTheme.themeSource 同构） */
type ThemeSource = 'system' | 'light' | 'dark';

let mainWindow: BrowserWindow | null = null;
/** 单词搜索弹窗（单例：已开则聚焦，不重复建） */
let searchWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quittingByUser = false;
let config: DesktopConfig = loadConfig();

// ---------------------------------------------------------------------------
// 单实例
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  process.on('uncaughtException', (error) => {
    appendLog(`[uncaught] ${error.stack ?? String(error)}`);
  });
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ---------------------------------------------------------------------------
// 诊断日志（userData/tdxl-desktop.log）：渲染失败时 Boss 杜 只需发这一个文件
// ---------------------------------------------------------------------------
export function appendLog(line: string): void {
  try {
    const stamp = new Date().toISOString();
    fs.appendFileSync(path.join(app.getPath('userData'), 'tdxl-desktop.log'), `[${stamp}] ${line}\n`, 'utf8');
  } catch {
    // 日志写不进去就放弃，不影响功能
  }
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------
function createWindow(): void {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    width: state.bounds?.width ?? DEFAULT_WIDTH,
    height: state.bounds?.height ?? DEFAULT_HEIGHT,
    x: state.bounds?.x,
    y: state.bounds?.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    frame: false, // 自绘标题栏（TitleBar.tsx）
    title: '同等学力英语备考',
    icon: path.join(__dirname, '..', 'dist-desktop', 'icons', 'icon-512.png'),
    // 材质透出的关键：窗口底板透明；实色兜底时由 CSS 变量接管
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  applyMaterial(mainWindow, config.material);

  if (state.maximized === true) {
    mainWindow.maximize();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 窗口控制按钮 hover 状态需要知道最大化与否
  const sendMaximized = (): void => {
    mainWindow?.webContents.send('tdxl:maximized', mainWindow.isMaximized());
  };
  mainWindow.on('maximize', sendMaximized);
  mainWindow.on('unmaximize', sendMaximized);

  // 位置记忆（防抖由关闭时机保证：resize/move 里只记脏标记，quit 前落盘）
  let dirty = false;
  const markDirty = (): void => {
    dirty = true;
  };
  mainWindow.on('resize', markDirty);
  mainWindow.on('move', markDirty);
  mainWindow.on('close', () => {
    if (dirty && mainWindow && !mainWindow.isDestroyed()) {
      saveWindowState({
        bounds: mainWindow.getNormalBounds(),
        maximized: mainWindow.isMaximized(),
      });
    }
  });

  // 关闭 → 托盘（用户在托盘菜单/快捷键里退出时放行）
  mainWindow.on('close', (event) => {
    if (!quittingByUser && config.closeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // 外链走系统浏览器，不在应用内开新窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (DEV_SERVER_URL) {
    void mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadURL('tdxl://app/index.html');
  }

  // ---- 渲染故障诊断：全部落日志 ----
  mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    appendLog(`[did-fail-load] code=${code} desc=${desc} url=${url}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    appendLog(`[render-process-gone] ${JSON.stringify(details)}`);
    // 崩溃自愈：重载一次，避免留下灰窗口
    if (mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => void mainWindow?.reload(), 500);
    }
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    appendLog(`[preload-error] ${preloadPath}: ${String(error)}`);
  });
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) {
      appendLog(`[console:${level}] ${message}`);
    }
  });
}

/** 材质/主题变化后重刷（tint 颜色跟深浅色联动；覆盖主窗口与弹窗） */
function refreshMaterial(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      applyMaterial(win, config.material);
    }
  }
}

nativeTheme.on('updated', refreshMaterial);

// ---------------------------------------------------------------------------
// 单词搜索弹窗（右上角功能区入口；独立窗口，不打断主界面）
// ---------------------------------------------------------------------------
function createSearchWindow(): void {
  if (searchWindow && !searchWindow.isDestroyed()) {
    if (searchWindow.isMinimized()) {
      searchWindow.restore();
    }
    searchWindow.show();
    searchWindow.focus();
    return;
  }

  searchWindow = new BrowserWindow({
    width: 400,
    height: 620,
    minWidth: 320,
    minHeight: 420,
    show: false,
    frame: false, // 与主窗口一致走自绘迷你标题栏（PopupTitleBar）
    title: '单词搜索',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  applyMaterial(searchWindow, config.material);
  searchWindow.once('ready-to-show', () => searchWindow?.show());
  searchWindow.on('closed', () => {
    searchWindow = null;
  });

  // 弹窗内外链同样走系统浏览器
  searchWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  searchWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
    appendLog(`[search did-fail-load] code=${code} desc=${desc} url=${url}`);
  });

  // ?popup=search 让前端进入弹窗模式（无侧栏/底栏，只有迷你标题栏）；#/search 直达搜索页
  if (DEV_SERVER_URL) {
    void searchWindow.loadURL(`${DEV_SERVER_URL}?popup=search#/search`);
  } else {
    void searchWindow.loadURL('tdxl://app/index.html?popup=search#/search');
  }
}

// ---------------------------------------------------------------------------
// 托盘
// ---------------------------------------------------------------------------
function createTray(): void {
  try {
    // nativeImage 显式读（支持 asar 内路径），避免 Tray 构造时原生层读不到
    const { nativeImage } = require('electron') as typeof import('electron');
    const image = nativeImage.createFromPath(path.join(__dirname, '..', 'dist-desktop', 'icons', 'icon-512.png'));
    tray = new Tray(image.isEmpty() ? path.join(WEB_ROOT, 'icons', 'icon-512.png') : image);
  } catch {
    return; // 图标缺失就不常驻托盘，不影响主功能
  }
  tray.setToolTip('同等学力英语备考');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          quittingByUser = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc(): void {
  // --- 窗口控制（按 sender 定位窗口：主窗口与搜索弹窗共用同一组 IPC） ---
  ipcMain.on('tdxl:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on('tdxl:toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return;
    }
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.on('tdxl:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.handle('tdxl:is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  // --- 单词搜索弹窗 ---
  ipcMain.on('tdxl:open-search', () => createSearchWindow());

  // --- 配置 ---
  ipcMain.handle('tdxl:get-config', () => config);
  ipcMain.handle('tdxl:set-config', (_event, patch: Partial<DesktopConfig>) => {
    const next: DesktopConfig = {
      ...config,
      ...patch,
      material: (patch.material ?? config.material) as MaterialChoice,
    };
    config = next;
    saveConfig(config);
    if (patch.autoLaunch !== undefined) {
      applyAutoLaunch(patch.autoLaunch);
    }
    if (patch.material !== undefined) {
      refreshMaterial();
    }
    return config;
  });

  // --- 主题跟随（renderer 的三态同步到 nativeTheme，影响窗口按钮区配色） ---
  ipcMain.handle('tdxl:set-theme-source', (_event, mode: ThemeSource) => {
    nativeTheme.themeSource = mode;
  });

  // --- 数据目录 ---
  ipcMain.handle('tdxl:open-data-dir', async () => {
    await shell.openPath(app.getPath('userData'));
  });

  // --- 全库导出：系统另存为对话框 ---
  ipcMain.handle(
    'tdxl:export-file',
    async (_event, payload: { defaultName: string; contents: string }) => {
      if (!mainWindow) {
        return null;
      }
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: '导出全部数据',
        defaultPath: payload.defaultName,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (canceled || !filePath) {
        return null;
      }
      fs.writeFileSync(filePath, payload.contents, 'utf8');
      return filePath;
    },
  );

  // --- 全库导入：系统打开对话框，读回文本 ---
  ipcMain.handle('tdxl:pick-import-file', async () => {
    if (!mainWindow) {
      return null;
    }
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '导入数据备份',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || filePaths.length === 0) {
      return null;
    }
    const filePath = filePaths[0];
    return { name: path.basename(filePath), content: fs.readFileSync(filePath, 'utf8') };
  });
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  nativeTheme.themeSource = 'system';
  registerWebProtocol();
  registerIpc();
  createWindow();
  createTray();
  appendLog(`[app] 启动完成，electron=${process.versions.electron}，webRoot=${WEB_ROOT}`);

  app.on('activate', () => {
    // macOS 习惯；Windows 下窗口存在即可
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('before-quit', () => {
  quittingByUser = true;
});

// Windows 上托盘常驻时不退出进程
app.on('window-all-closed', () => {
  if (process.platform !== 'win32') {
    app.quit();
  }
});
