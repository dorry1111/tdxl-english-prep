/**
 * 窗口位置/尺寸记忆（userData/window-state.json）。
 *
 * 恢复时把 bounds 夹回到当前可见工作区内，
 * 避免拔掉副屏后窗口跑到屏幕外找不回来。
 */
import { app, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface WindowState {
  bounds: { x: number; y: number; width: number; height: number };
  maximized: boolean;
}

const FILE = 'window-state.json';

/** 默认窗口：1120×760，居中交给 Electron */
export const DEFAULT_WIDTH = 1120;
export const DEFAULT_HEIGHT = 760;
export const MIN_WIDTH = 1024;
export const MIN_HEIGHT = 700;

function fileOf(): string {
  return path.join(app.getPath('userData'), FILE);
}

export function loadWindowState(): Partial<WindowState> {
  try {
    const raw = fs.readFileSync(fileOf(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    if (!parsed.bounds || typeof parsed.bounds.width !== 'number') {
      return {};
    }
    // 夹回工作区：至少 2/3 可见
    const area = screen.getPrimaryDisplay().workArea;
    const b = parsed.bounds;
    const width = Math.min(b.width, area.width);
    const height = Math.min(b.height, area.height);
    const x = Math.min(Math.max(b.x, area.x - width + 160), area.x + area.width - 160);
    const y = Math.min(Math.max(b.y, area.y), area.y + area.height - 80);
    return { bounds: { x, y, width, height }, maximized: parsed.maximized === true };
  } catch {
    return {};
  }
}

export function saveWindowState(state: WindowState): void {
  try {
    fs.writeFileSync(fileOf(), JSON.stringify(state), 'utf8');
  } catch {
    // 记不住就算了，不影响使用
  }
}
