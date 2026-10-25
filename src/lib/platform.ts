/**
 * 运行平台判断（基于 Capacitor，单一真源）。
 *
 * - IS_NATIVE：是否运行在原生壳（iOS/Android）内；
 * - IS_IOS / IS_ANDROID：具体原生平台；
 * - 在浏览器/PWA/Electron 下 IS_NATIVE 为 false。
 *
 * 用于 iOS 专属默认（直连局域网 NAS、启动即自动同步）与桌面端差异逻辑。
 */
import { Capacitor } from '@capacitor/core';

/** 是否运行在原生壳内 */
export const IS_NATIVE = Capacitor.isNativePlatform();

/** 是否 iOS 原生壳 */
export const IS_IOS = IS_NATIVE && Capacitor.getPlatform() === 'ios';

/** 是否 Android 原生壳 */
export const IS_ANDROID = IS_NATIVE && Capacitor.getPlatform() === 'android';
