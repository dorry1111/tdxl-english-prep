/**
 * 轻量性能探针（默认完全静默，零依赖，生产环境不产生副作用）。
 *
 * 为什么需要这个文件：
 * 「Windows 重启电脑后第一次点单词要等很久」只在冷启动那一刻复现——静态读代码
 * 只能列出嫌疑，无法定论到底是 ① TTS 引擎首次初始化卡主线程、② 词库索引/分片
 * 首次 fetch+parse、还是 ③ IndexedDB 冷开库与后台 seed 抢任务。
 * 让用户在下一次重启后带 `?perf=1` 打开一次，就能拿到真实数字自证根因。
 *
 * 会打印什么（带 `?perf=1` 时）：
 * - 启动口径：DOMContentLoaded / load / FCP / React 首次绘制；
 * - 关键异步耗时：`db:open`、`wordbook:core-index`、`wordbook:shard:*`、`word:getWord`；
 * - 首次手势：pointerdown 距页面创建的时间、pointerdown → 业务响应、pointerdown → 下一帧；
 * - 所有 ≥50ms 的长任务（`PerformanceObserver('longtask')`，Chrome/Edge 支持）。
 *
 * 不带 `?perf=1` 时，本文件所有导出函数都是「读一次缓存的布尔值 → 直接 return」，
 * 不注册监听、不打点、不输出任何日志。
 */

/** 长任务阈值：与 Chrome DevTools 口径一致（>50ms 即为长任务） */
const LONG_TASK_MS = 50;

/** `?perf=1` 判定结果缓存（模块生命周期内只解析一次 URL） */
let enabledCache: boolean | null = null;

/** 是否开启性能探针（`?perf=1`） */
export function isPerfEnabled(): boolean {
  if (enabledCache !== null) {
    return enabledCache;
  }
  if (typeof window === 'undefined') {
    enabledCache = false;
    return false;
  }
  try {
    enabledCache = new URLSearchParams(window.location.search).get('perf') === '1';
  } catch {
    enabledCache = false;
  }
  return enabledCache;
}

/** 探针是否已安装（避免重复注册 observer / 监听器） */
let installed = false;

/** 首次 pointerdown 的时间戳（performance 时间轴，毫秒；null = 尚未发生） */
let firstGestureAt: number | null = null;

/** 启动口径是否已输出 */
let bootReported = false;

/** 取高精度时间（无 performance 的环境返回 0，探针本身只在真实浏览器里使用） */
export function perfNow(): number {
  if (typeof performance === 'undefined' || typeof performance.now !== 'function') {
    return 0;
  }
  return performance.now();
}

/** 打一个 User Timing 标记（默认关闭时为空操作） */
export function perfMark(name: string): void {
  if (!isPerfEnabled() || typeof performance === 'undefined') {
    return;
  }
  try {
    performance.mark(name);
  } catch {
    // 标记重名/不支持：忽略
  }
}

/** 输出一行探针日志（默认关闭时为空操作） */
export function perfLog(message: string, detail?: Record<string, unknown>): void {
  if (!isPerfEnabled()) {
    return;
  }
  if (detail) {
    console.info(`[perf] ${message}`, detail);
    return;
  }
  console.info(`[perf] ${message}`);
}

/**
 * 从「首次 pointerdown」到当前时刻的耗时（用于验证「点下去多久才有反应」）。
 *
 * 首次 pointerdown 之前调用只会打标记、不输出相对耗时（例如键盘操作触发）。
 */
export function perfMarkFromFirstGesture(label: string, detail?: Record<string, unknown>): void {
  if (!isPerfEnabled()) {
    return;
  }
  perfMark(`perf:${label}`);
  if (firstGestureAt === null) {
    perfLog(`${label}：本次交互之前没有 pointerdown，无法计算相对耗时`);
    return;
  }
  perfLog(`${label}：距首次 pointerdown ${roundMs(perfNow() - firstGestureAt)}ms`, detail);
}

/**
 * 包裹一次异步操作并记录耗时（默认关闭时只多一层函数调用，不测量、不输出）。
 *
 * 语义必须与被包裹的操作完全一致：成功原样返回、失败原样抛出。
 *
 * @param label 日志标签，如 `db:open`
 * @param task  被测量的异步操作
 */
export async function traceAsync<T>(label: string, task: () => Promise<T>): Promise<T> {
  if (!isPerfEnabled()) {
    return task();
  }
  const startedAt = perfNow();
  const startMark = `perf:${label}:start`;
  perfMark(startMark);
  try {
    const value = await task();
    report(label, startedAt, startMark, true);
    return value;
  } catch (error) {
    report(label, startedAt, startMark, false);
    throw error;
  }
}

/**
 * 安装探针（在 React 挂载之前调用，才能抓到首屏与首次手势）。
 *
 * 未带 `?perf=1` 时直接返回，不注册任何监听。
 */
export function installPerfProbe(): void {
  if (installed || !isPerfEnabled() || typeof window === 'undefined') {
    return;
  }
  installed = true;
  perfLog('探针已开启（URL 带 perf=1）：重启后首次交互的耗时都会打印在这里');

  // 1) 启动口径：load 事件之后 paint/navigation 条目一定已就绪
  window.addEventListener('load', reportBootMetrics, { once: true });
  if (document.readyState === 'complete') {
    window.setTimeout(reportBootMetrics, 0);
  }

  // 2) 长任务：能直接看出「是谁把主线程占住了」
  observeLongTasks();

  // 3) 首次手势：pointerdown → 下一帧、以及后续业务侧自定义标记的基准时间
  watchFirstGesture();
}

// ---------------------------------------------------------------------------
// 内部实现
// ---------------------------------------------------------------------------

/** 毫秒取整（日志里不需要小数） */
function roundMs(value: number): number {
  return Math.round(value);
}

/** 输出一次耗时，并补一条 User Timing measure 便于在 Performance 面板里对照 */
function report(label: string, startedAt: number, startMark: string, ok: boolean): void {
  const duration = roundMs(perfNow() - startedAt);
  perfMark(`perf:${label}:end`);
  try {
    performance.measure(`perf:${label}`, startMark);
  } catch {
    // measure 失败（标记丢失）：忽略
  }
  perfLog(`${label} 耗时 ${duration}ms${ok ? '' : '（失败）'}`);
}

/** 输出启动口径（只输出一次） */
function reportBootMetrics(): void {
  if (bootReported || typeof performance === 'undefined') {
    return;
  }
  bootReported = true;

  const navigation = performance.getEntriesByType('navigation')[0] as
    PerformanceNavigationTiming | undefined;
  if (navigation) {
    perfLog(
      `导航（${navigation.type}）：DOMContentLoaded ${roundMs(navigation.domContentLoadedEventEnd)}ms / load ${roundMs(navigation.loadEventEnd)}ms`,
    );
  }
  for (const entry of performance.getEntriesByType('paint')) {
    perfLog(`${entry.name} ${roundMs(entry.startTime)}ms`);
  }
  const painted = performance.getEntriesByName('perf:app-painted')[0];
  if (painted) {
    perfLog(`React 首次绘制 ${roundMs(painted.startTime)}ms（≈ 首屏可交互时间）`);
  }
}

/** 观测长任务（Safari 不支持 longtask，静默跳过） */
function observeLongTasks(): void {
  if (typeof PerformanceObserver === 'undefined') {
    perfLog('当前浏览器没有 PerformanceObserver，跳过长任务观测');
    return;
  }
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < LONG_TASK_MS) {
          continue;
        }
        perfLog(
          `长任务：${roundMs(entry.startTime)}ms 起，持续 ${roundMs(entry.duration)}ms`,
          attributionOf(entry),
        );
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    perfLog('longtask 观测注册失败（浏览器不支持该条目类型）');
  }
}

/** 取长任务的归因信息（Chrome 会给出 containerType / containerSrc） */
function attributionOf(entry: PerformanceEntry): Record<string, unknown> | undefined {
  const withAttribution = entry as PerformanceEntry & {
    attribution?: ReadonlyArray<{ name?: string; containerType?: string; containerSrc?: string }>;
  };
  const attribution = withAttribution.attribution;
  if (!attribution || attribution.length === 0) {
    return undefined;
  }
  return {
    source: attribution.map((item) => item.containerType ?? item.name ?? 'unknown').join(','),
  };
}

/** 记录首次 pointerdown，并测出「按下去 → 下一帧」的间隔 */
function watchFirstGesture(): void {
  const stamp = (): void => {
    if (firstGestureAt !== null) {
      return;
    }
    firstGestureAt = perfNow();
    perfMark('perf:first-pointerdown');
    perfLog(`首次 pointerdown（此时页面已存在 ${roundMs(firstGestureAt)}ms）`);
    // 双 rAF：等浏览器把这次交互提交到屏幕，能直接看出「按下去多久才有视觉反馈」
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (firstGestureAt === null) {
          return;
        }
        perfLog(`首次 pointerdown → 下一帧绘制 ${roundMs(perfNow() - firstGestureAt)}ms`);
      });
    });
  };
  document.addEventListener('pointerdown', stamp, { capture: true, once: true });
}
