/**
 * 会话结算后的自动同步（PRD 5.7 / ARCHITECTURE 4.2 防抖策略）。
 *
 * 【接线点】后续批次在会话结算页（sessionStore.settle 之后）调用一次：
 * ```ts
 * import { maybeAutoSync } from '@/lib/sync/autorun';
 * // 结算落库完成后（不 await，失败静默）：
 * void maybeAutoSync();
 * ```
 *
 * 触发条件（全部满足才发同步）：
 * 1. Settings.syncEnabled === true；
 * 2. 距上次成功同步 > 5 分钟（避免连续结算反复打 NAS）；
 * 3. 当前没有进行中的同步（模块级单飞，多标签页共享同一进程内守卫）。
 *
 * 刻意不改 sessionStore.ts（并行批次在改同一文件），本模块只提供独立入口。
 */
import { getSettings } from '@/db/repos/settingsRepo';
import { now } from '@/lib/time';
import type { SyncReport } from '@/types';

import { syncNow, type SyncDeps } from './engine';

/** 两次自动同步的最小间隔：5 分钟 */
export const AUTO_SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000;

/** 进程内单飞守卫（同一浏览器上下文内保证只有一个同步在跑） */
let inFlight: Promise<SyncReport> | null = null;

/** 是否有自动同步正在进行（测试与调试用） */
export function isAutoSyncRunning(): boolean {
  return inFlight !== null;
}

/**
 * 判断并触发自动同步。
 *
 * @returns 本次实际执行的 SyncReport；未触发（未启用/太频繁/已有同步在跑）返回 null。
 *          同步失败也返回报告（error 字段带错误码），不向上抛异常。
 */
export async function maybeAutoSync(deps: SyncDeps = {}): Promise<SyncReport | null> {
  if (inFlight !== null) {
    return null;
  }
  const settings = await getSettings();
  if (inFlight !== null) {
    // await 期间已有并发调用进入，让后到者直接退出
    return null;
  }
  if (!settings || !settings.syncEnabled) {
    return null;
  }
  const last = settings.lastSyncAt;
  if (last !== null && now() - last < AUTO_SYNC_MIN_INTERVAL_MS) {
    return null;
  }
  const task = syncNow(settings, deps);
  inFlight = task.finally(() => {
    inFlight = null;
  });
  try {
    return await task;
  } catch {
    // 自动同步是尽力而为：任何意外异常都静默吞掉，不打断结算流程
    return null;
  }
}
