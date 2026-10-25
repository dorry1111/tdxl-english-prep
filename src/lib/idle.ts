/**
 * 空闲调度（`requestIdleCallback` 的安全封装）。
 *
 * 为什么需要：
 * 冷启动预热（词库索引、语音列表）必须避开「首屏渲染」与「用户的第一次点击」，
 * 否则会把本来能省的耗时搬到更敏感的时机上。
 *
 * 为什么要有兜底：
 * Safari（含 iOS 16）至今没有 `requestIdleCallback`，桌面端老版本浏览器也可能没有。
 * 兜底用 `setTimeout`，延迟取较小值（默认 300ms）——保证首屏已经绘制完再跑，
 * 又不会像缺少 rIC 的轮询那样无限等待。
 */

/** 空闲截止时间（这里只用到 timeRemaining，便于在没有 rIC 的环境里自行降级） */
export interface IdleDeadlineLike {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

type RequestIdleCallbackFn = (
  callback: (deadline: IdleDeadlineLike) => void,
  options?: { timeout?: number },
) => number;

/** rIC 的兜底超时：到点即执行，避免长时间空闲不下来导致预热永远不跑 */
const DEFAULT_TIMEOUT_MS = 2000;

/** 无 rIC 环境的兜底延迟：首屏绘制通常已完成 */
const FALLBACK_DELAY_MS = 300;

/**
 * 在浏览器空闲时执行一次任务（幂等：无论走 rIC 还是 setTimeout，任务只跑一次）。
 *
 * - 任务内部抛错会被吞掉：预热任务失败不应该影响任何业务流程；
 * - 不返回取消句柄：本项目的预热都是一次性的，没有取消场景。
 *
 * @param task     要执行的任务（应为「轻量的、可失败」的工作）
 * @param timeoutMs 最长等待时间，到时强制执行
 */
export function whenIdle(task: () => void, timeoutMs: number = DEFAULT_TIMEOUT_MS): void {
  if (typeof window === 'undefined') {
    return;
  }
  let done = false;
  const run = (): void => {
    if (done) {
      return;
    }
    done = true;
    try {
      task();
    } catch {
      // 预热失败：静默（调用方自行保证不抛业务异常）
    }
  };

  const requestIdle = (window as unknown as { requestIdleCallback?: RequestIdleCallbackFn })
    .requestIdleCallback;

  if (typeof requestIdle === 'function') {
    try {
      requestIdle.call(window, run, { timeout: timeoutMs });
      return;
    } catch {
      // 某些实现会在隐藏页面抛错：退化为 setTimeout
    }
  }
  window.setTimeout(run, Math.min(timeoutMs, FALLBACK_DELAY_MS));
}
