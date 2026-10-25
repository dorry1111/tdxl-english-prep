/**
 * 冷启动空闲预热（lib/warmup）回归测试。
 *
 * 背景：`main.tsx` 在首屏之后调用 `scheduleWarmup()`，它内部会 `loadCoreIndex()`，
 * 而首页 `HomePage.tsx` 的 `useLiveQuery(loadCoreIndex)` 也会调同一个函数。
 * 这里要守住两条线：
 * 1. **单例**：预热与页面共用同一个 Promise，253KB 的 core-index.json 只能 fetch 一次；
 * 2. **失败静默**：断网 / SW 未缓存时预热失败不得冒泡、不写缓存、还能重试。
 *
 * `warmup.ts` 有模块级 `scheduled` 幂等标记，因此每个用例都要
 * `vi.resetModules()` + 动态 import 拿干净实例（两次 import 共享同一个 wordbookCache 实例）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CoreIndex } from './wordbookCache';

/** 一份最小的合法索引（entries 为空也能通过格式校验） */
function makeIndex(total: number): CoreIndex {
  return { bookId: 'core', version: 2, total, shards: [], entries: [] };
}

/** 等一段真实时间，让 whenIdle 的 setTimeout(300ms) 兜底真的跑起来 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

beforeEach(() => {
  vi.resetModules();
});

describe('scheduleWarmup', () => {
  it('与首页共用 loadCoreIndex 单例：并发调用索引只 fetch 一次', async () => {
    const cache = await import('./wordbookCache');
    const { scheduleWarmup } = await import('./warmup');

    let fetchCount = 0;
    cache.setCoreFetcher(async () => {
      fetchCount += 1;
      await wait(10);
      return makeIndex(6);
    });

    scheduleWarmup(); // 只调度，300ms 后才真正发起

    // 首页 useLiveQuery 的调用（并发两次）
    const [first, second] = await Promise.all([cache.loadCoreIndex(), cache.loadCoreIndex()]);
    expect(second).toBe(first); // 同一个索引对象，不是两次解析结果

    // 等空闲预热也跑完：此时应命中缓存，不再 fetch
    await wait(400);

    expect(fetchCount).toBe(1);
    expect(cache.peekCoreIndex()?.total).toBe(6);
  });

  it('索引预热失败（断网 + SW 未缓存）时静默：不抛错、不写缓存、可重试', async () => {
    const cache = await import('./wordbookCache');
    const { scheduleWarmup } = await import('./warmup');

    let attempts = 0;
    cache.setCoreFetcher(async () => {
      attempts += 1;
      throw new Error('断网：core-index.json 取不到');
    });

    // 关键：调度本身不抛；失败发生在空闲回调内部并被吞掉（warmup.ts 的 .catch）
    expect(() => scheduleWarmup()).not.toThrow();
    await wait(400);

    expect(attempts).toBe(1);
    expect(cache.peekCoreIndex()).toBeNull();

    // 恢复网络后可重试成功（失败不会被永久缓存成坏状态）
    cache.setCoreFetcher(async () => makeIndex(3));
    await expect(cache.loadCoreIndex()).resolves.toMatchObject({ total: 3 });
  });

  it('重复调用只调度一次（幂等）', async () => {
    const cache = await import('./wordbookCache');
    const { scheduleWarmup } = await import('./warmup');

    let fetchCount = 0;
    cache.setCoreFetcher(async () => {
      fetchCount += 1;
      return makeIndex(6);
    });

    scheduleWarmup();
    scheduleWarmup();
    scheduleWarmup();
    await wait(400);

    expect(fetchCount).toBe(1);
  });
});
