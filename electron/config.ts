/**
 * 桌面端配置（userData/tdxl-config.json）：
 * - material：界面质感（亚克力/磨砂/纯色）
 * - closeToTray：点关闭是否最小化到托盘
 * - autoLaunch：开机自启（写注册表 Run 项）
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import type { MaterialChoice } from './acrylic';

export interface DesktopConfig {
  material: MaterialChoice;
  closeToTray: boolean;
  autoLaunch: boolean;
}

export const DEFAULT_CONFIG: DesktopConfig = {
  material: 'auto',
  closeToTray: true,
  autoLaunch: false,
};

const FILE = 'tdxl-config.json';

function fileOf(): string {
  return path.join(app.getPath('userData'), FILE);
}

export function loadConfig(): DesktopConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(fileOf(), 'utf8')) as Partial<DesktopConfig>;
    const material = raw.material;
    return {
      material:
        material === 'auto' || material === 'acrylic' || material === 'blur' || material === 'solid'
          ? material
          : DEFAULT_CONFIG.material,
      closeToTray: raw.closeToTray !== false,
      autoLaunch: raw.autoLaunch === true,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: DesktopConfig): void {
  try {
    fs.writeFileSync(fileOf(), JSON.stringify(config, null, 2), 'utf8');
  } catch {
    // 忽略写失败（配置丢了回落默认值）
  }
}

/** 开机自启落库（注册表 Run 项；开发模式不设置） */
export function applyAutoLaunch(enabled: boolean): void {
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: enabled });
  }
}
