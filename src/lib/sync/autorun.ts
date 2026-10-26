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

/** 两次自动同步的最小间隔：30 秒（实时同步口径，局域网载荷仅 KB 级，30s 轮询无压力） */
export const AUTO_SYNC_MIN_INTERVAL_MS = 30 * 1000;

/** 实时同步轮询间隔：30 秒（仅页面可见时轮询，后台标签页/挂起时跳过） */
export const REALTIME_POLL_INTERVAL_MS = 30 * 1000;

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

/**
 * 安装实时同步监听（v1.10.0「实时同步」）：
 *
 * 1. visibilitychange → 页面回到前台立即同步（修 iOS IPA/PWA 从后台切回不刷新）；
 * 2. window focus → 桌面端窗口聚焦立即同步；
 * 3. 30 秒轮询 → 仅页面可见时兜底（后台标签页/系统挂起时跳过，省电不打 NAS）。
 *
 * 全部走 maybeAutoSync：单飞守卫 + 30 秒最小间隔 + syncEnabled 门槛天然生效，
 * 不会因频繁触发打出并发请求。返回卸载函数（React StrictMode 双挂载与测试用）。
 *
 * @param pollIntervalMs 测试可注入更短的轮询间隔（默认 REALTIME_POLL_INTERVAL_MS）
 */
export function installRealtimeSync(
  deps: SyncDeps = {},
  pollIntervalMs: number = REALTIME_POLL_INTERVAL_MS,
): () => void {
  const trigger = (): void => {
    void maybeAutoSync(deps);
  };
  const onVisibility = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      trigger();
    }
  };
  const onTick = (): void => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      trigger();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', trigger);
  const timer = setInterval(onTick, pollIntervalMs);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', trigger);
    clearInterval(timer);
  };
}
