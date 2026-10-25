/**
 * lib/nativePlugins 守卫行为测试。
 *
 * isNativePluginAvailable 必须严格透传 Capacitor.isPluginAvailable：
 * - Web / jsdom（无原生壳）→ false（ Capacitor 全部走 Web 回落）；
 * - 原生壳内按注册表判断（mock 注入 true / false 各验一条）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 可控的 isPluginAvailable mock（vi.hoisted 保证与工厂共享同一引用） */
const capacitorState = vi.hoisted(() => ({ registered: new Set<string>() }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isPluginAvailable: (name: string): boolean => capacitorState.registered.has(name),
  },
}));

import { isNativePluginAvailable } from './nativePlugins';

beforeEach(() => {
  capacitorState.registered.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isNativePluginAvailable', () => {
  it('jsdom / Web 环境（Capacitor 判定插件不可用）→ false', () => {
    expect(isNativePluginAvailable('TtsBridge')).toBe(false);
    expect(isNativePluginAvailable('NasDiscovery')).toBe(false);
  });

  it('原生壳内注册表命中 → true（透传，不自作主张）', () => {
    capacitorState.registered.add('TtsBridge');
    capacitorState.registered.add('NasDiscovery');
    expect(isNativePluginAvailable('TtsBridge')).toBe(true);
    expect(isNativePluginAvailable('NasDiscovery')).toBe(true);
  });

  it('注册表未收录的插件名 → false（透传判断，不兜底放行）', () => {
    capacitorState.registered.add('TtsBridge');
    expect(isNativePluginAvailable('TtsBridge')).toBe(true);
    expect(isNativePluginAvailable('NotRegistered')).toBe(false);
  });
});
