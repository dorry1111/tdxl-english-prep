/**
 * 原生插件可用性探测（Capacitor 注册表，单一真源）。
 *
 * 背景：Capacitor 8 下原生插件必须 conform `CAPBridgedPlugin` 注册，
 * 否则 JS 侧调用会抛 not implemented（旧 IPA / 注册遗漏时发生）。
 * 这里封装 `Capacitor.isPluginAvailable`，供调用方在走原生路径前做防御性判断：
 * 插件不可用时回落 Web 实现（如 speechSynthesis），而不是吞下桥接异常。
 *
 * - Web / PWA / 桌面（Electron）：恒 false（无原生壳， Capacitor 全部走 Web 回落）；
 * - 原生壳内：按 Capacitor 启动时构建的插件注册表判断。
 */
import { Capacitor } from '@capacitor/core';

/**
 * 判断指定原生插件是否可用。
 *
 * @param name 插件注册名（与 Swift 侧 `jsName` 一致，如 'TtsBridge' / 'NasDiscovery'）
 */
export function isNativePluginAvailable(name: string): boolean {
  return Capacitor.isPluginAvailable(name);
}
