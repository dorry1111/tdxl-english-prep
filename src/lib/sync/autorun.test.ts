/**
 * QA 二层验证（同步批次必查项 6）：autorun.maybeAutoSync 单飞守卫与触发门槛。
 *
 * - 并发调用只跑一次（后到者返回 null，不重复打 NAS）；
 * - syncEnabled=false 不触发、不发请求；
 * - 距上次成功同步 < 5 分钟不触发；
 * - 同步结束后守卫释放（可再次触发）。
 *
 * 模块级 inFlight 在整个文件共享，因此每个用例都完整 await 到同步结束。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db';
import { buildDefaultSettings } from '@/db/seed';
import { ensureSettings, setSecret } from '@/db/repos/settingsRepo';
import type { Settings } from '@/types';

import { AUTO_SYNC_MIN_INTERVAL_MS, isAutoSyncRunning, maybeAutoSync } from './autorun';
import type { FetchLike } from './webdav';

const NOW_TS = 1_792_000_000_000;

function makeSettings(overrides?: Partial<Settings>): Settings {
  return {
    ...buildDefaultSettings(NOW_TS),
    syncEnabled: true,
    webdavUrl: 'https://nas.example:5005/tdxl-sync/',
    webdavUser: 'dorry',
    deviceId: 'devA',
    lastSyncAt: null,
    ...overrides,
  };
}

/** 可控闸门的 fetch：resolveGate() 之前所有请求挂起 → 同步保持 in-flight */
function gatedFetch(): { fetchImpl: FetchLike; resolveGate: () => void; calls: () => number } {
  let callCount = 0;
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchImpl: FetchLike = async () => {
    callCount += 1;
    await gate;
    return new Response(
      '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"></D:multistatus>',
      { status: 207 },
    );
  };
  return { fetchImpl, resolveGate: () => release?.(), calls: () => callCount };
}

beforeEach(async () => {
  await ensureSettings(makeSettings());
  await setSecret('pass');
});

afterEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('maybeAutoSync 单飞守卫', () => {
  it('并发调用只跑一次：后到者立即返回 null，不发出重复请求', async () => {
    const gate = gatedFetch();

    const first = maybeAutoSync({ fetchImpl: gate.fetchImpl, nowTs: () => NOW_TS });
    // 同步已进入 in-flight（等待闸门）
    await vi.waitFor(() => expect(isAutoSyncRunning()).toBe(true));

    // 同步未结束时的第二次调用：直接退出，不触发第二次同步
    const second = await maybeAutoSync({ fetchImpl: gate.fetchImpl, nowTs: () => NOW_TS });
    expect(second).toBeNull();
    expect(isAutoSyncRunning()).toBe(true);

    gate.resolveGate();
    const report = await first;
    expect(report?.error).toBeNull();
    expect(isAutoSyncRunning()).toBe(false);
  });

  it('同步结束后守卫释放：清除门槛后可以再次真实触发', async () => {
    const gate = gatedFetch();
    const first = maybeAutoSync({ fetchImpl: gate.fetchImpl, nowTs: () => NOW_TS });
    await vi.waitFor(() => expect(isAutoSyncRunning()).toBe(true));
    gate.resolveGate();
    await first;
    expect(isAutoSyncRunning()).toBe(false);

    // 清掉 lastSyncAt（写库直改）后再次调用：若守卫未释放会立即返回 null 且无请求；
    // 守卫已释放则会真实启动第二轮同步（进入 in-flight 并返回报告）
    await db.settings.update('global', { lastSyncAt: null });
    const gate2 = gatedFetch();
    const second = maybeAutoSync({ fetchImpl: gate2.fetchImpl, nowTs: () => NOW_TS });
    await vi.waitFor(() => expect(isAutoSyncRunning()).toBe(true));
    gate2.resolveGate();
    const report = await second;
    expect(report?.error).toBeNull();
    expect(isAutoSyncRunning()).toBe(false);
  });
});

describe('maybeAutoSync 触发门槛', () => {
  it('syncEnabled=false → 不触发、不发请求', async () => {
    await db.settings.update('global', { syncEnabled: false });
    let calls = 0;
    const report = await maybeAutoSync({
      fetchImpl: async () => {
        calls += 1;
        return new Response('', { status: 200 });
      },
      nowTs: () => NOW_TS,
    });
    expect(report).toBeNull();
    expect(calls).toBe(0);
  });

  it('距上次成功同步 < 5 分钟 → 不触发（AUTO_SYNC_MIN_INTERVAL_MS）', async () => {
    // 间隔判断用真实时钟 now()，这里用 Date.now() 保证落在窗口内
    await db.settings.update('global', { lastSyncAt: Date.now() - AUTO_SYNC_MIN_INTERVAL_MS + 60_000 });
    let calls = 0;
    const report = await maybeAutoSync({
      fetchImpl: async () => {
        calls += 1;
        return new Response('', { status: 200 });
      },
      nowTs: () => NOW_TS,
    });
    expect(report).toBeNull();
    expect(calls).toBe(0);
  });

  it('距上次成功同步 ≥ 5 分钟 → 正常触发并完成', async () => {
    await db.settings.update('global', { lastSyncAt: Date.now() - AUTO_SYNC_MIN_INTERVAL_MS - 1_000 });
    const gate = gatedFetch();
    const task = maybeAutoSync({ fetchImpl: gate.fetchImpl, nowTs: () => NOW_TS });
    await vi.waitFor(() => expect(isAutoSyncRunning()).toBe(true));
    gate.resolveGate();
    const report = await task;
    expect(report?.error).toBeNull();
  });
});
