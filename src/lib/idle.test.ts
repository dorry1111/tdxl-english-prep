/**
 * lib/idle 单测：验证「rIC 缺失时走 setTimeout 兜底、任务只执行一次、任务抛错不外溢」。
 *
 * jsdom 没有 `requestIdleCallback`，所以测试天然覆盖 Safari/老浏览器的降级路径。
 */
import { describe, expect, it, vi } from 'vitest';

import { whenIdle } from './idle';

/** 等一段真实时间（比 fake timers 更贴近 rIC/setTimeout 混用场景） */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('whenIdle', () => {
  it('没有 requestIdleCallback 时用 setTimeout 兜底，且同步调用不立即执行', async () => {
    const task = vi.fn();
    whenIdle(task, 10);
    expect(task).not.toHaveBeenCalled();
    await wait(40);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('任务抛错不会冒泡到调用方', async () => {
    const thrown = vi.fn(() => {
      throw new Error('预热失败');
    });
    expect(() => whenIdle(thrown, 10)).not.toThrow();
    await wait(40);
    expect(thrown).toHaveBeenCalledTimes(1);
  });

  it('有两个可用实现时任务也只跑一次（rIC 与 setTimeout 不重复）', async () => {
    const task = vi.fn();
    whenIdle(task, 10);
    await wait(60);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
