/**
 * 原生 TTS 桥的 TS 封装（对应 iOS 原生 TtsBridge 插件）。
 *
 * 仅原生 iOS 端可用：Web / PWA / 桌面端走系统 speechSynthesis（见 lib/tts）。
 * iOS 原生端改用 AVSpeechSynthesizer 并走媒体路径（忽略静音键），稳定可靠。
 */
import { registerPlugin } from '@capacitor/core';

export interface TtsBridgePlugin {
  speak(options: { text: string; lang: string; rate: number }): Promise<void>;
  stop(): Promise<void>;
  isSupported(): Promise<{ supported: boolean }>;
}

export const TtsBridge = registerPlugin<TtsBridgePlugin>('TtsBridge');
