/**
 * lib/tts 原生壳 TtsBridge 兜底回落测试（v1.8.0 T00 补充）。
 *
 * 场景：iOS 原生壳内 TtsBridge 插件未注册（旧 IPA / 注册遗漏）时，
 * speakText 必须回落 Web speechSynthesis（有声总比无声好），而不是
 * 把桥接异常吞掉后无声；插件可用时走 TtsBridge 且不碰 speechSynthesis。
 *
 * IS_IOS / 插件可用性都用 getter mock 注入（jsdom 恒非原生，必须可切换），
 * 每个用例 vi.resetModules + 动态 import 拿到干净模块实例。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 平台标志与插件可用性的测试内可控状态 */
const platformState = vi.hoisted(() => ({ isIos: false }));
const pluginState = vi.hoisted(() => ({ available: true }));

vi.mock('@/lib/platform', () => ({
  get IS_IOS() {
    return platformState.isIos;
  },
  get IS_NATIVE() {
    return platformState.isIos;
  },
  IS_ANDROID: false,
}));

vi.mock('./nativePlugins', () => ({
  isNativePluginAvailable: (name: string): boolean => {
    void name;
    return pluginState.available;
  },
}));

const ttsBridge = vi.hoisted(() => ({
  speak: vi.fn((_options: { text: string; lang: string; rate: number }) => Promise.resolve()),
  stop: vi.fn(() => Promise.resolve()),
  isSupported: vi.fn(() => Promise.resolve({ supported: true })),
}));

vi.mock('./nativeTts', () => ({
  TtsBridge: ttsBridge,
}));

/** 假 SpeechSynthesisUtterance：只保留断言需要的字段 */
class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

/** 在 window 上安装最小 speechSynthesis 替身，记录 speak / cancel 调用 */
function installFakeSpeechSynthesis(): {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
} {
  const speak = vi.fn();
  const cancel = vi.fn();
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    writable: true,
    value: {
      speak,
      cancel,
      getVoices: () => [],
      // loadVoices 的 voiceschanged 异步路径需要（getVoices 为空时会挂监听）
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
  return { speak, cancel };
}

/** 桌面 UA：规避手势解锁入队分支，聚焦回落路径本身 */
function setDesktopUserAgent(): void {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { configurable: true, value: 0 });
}

beforeEach(() => {
  vi.resetModules();
  platformState.isIos = false;
  pluginState.available = true;
  ttsBridge.speak.mockClear();
  ttsBridge.stop.mockClear();
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    configurable: true,
    writable: true,
    value: FakeUtterance,
  });
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).speechSynthesis;
  delete (globalThis as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
  vi.restoreAllMocks();
});

describe('speakText — iOS 原生壳 TtsBridge 兜底回落（v1.8.0）', () => {
  it('IS_IOS 且插件可用：走 TtsBridge.speak，不碰 speechSynthesis', async () => {
    platformState.isIos = true;
    pluginState.available = true;
    const synth = installFakeSpeechSynthesis();
    const { speakText } = await import('./tts');

    await speakText('apple', { rate: 1, accent: 'uk' });

    expect(ttsBridge.speak).toHaveBeenCalledTimes(1);
    expect(ttsBridge.speak).toHaveBeenCalledWith({ text: 'apple', lang: 'en-GB', rate: 1 });
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('IS_IOS 但插件不可用（旧 IPA）：回落 speechSynthesis，不调 TtsBridge', async () => {
    platformState.isIos = true;
    pluginState.available = false;
    const synth = installFakeSpeechSynthesis();
    const { speakText } = await import('./tts');

    await speakText('apple', { rate: 1, accent: 'uk' });

    expect(ttsBridge.speak).not.toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(synth.speak.mock.calls[0]?.[0]).toBeInstanceOf(FakeUtterance);
  });

  it('回落时 console.warn 只警告一次（重复朗读不刷日志）', async () => {
    platformState.isIos = true;
    pluginState.available = false;
    installFakeSpeechSynthesis();
    const { speakText } = await import('./tts');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await speakText('apple', { rate: 1, accent: 'uk' });
    await speakText('banana', { rate: 1, accent: 'uk' });

    const fallbackWarnings = warn.mock.calls.filter((call) =>
      String(call[0]).includes('TtsBridge 原生插件不可用'),
    );
    expect(fallbackWarnings).toHaveLength(1);
  });

  it('IS_IOS 插件不可用时 cancelSpeech 回落 speechSynthesis.cancel', async () => {
    platformState.isIos = true;
    pluginState.available = false;
    const synth = installFakeSpeechSynthesis();
    const { cancelSpeech } = await import('./tts');

    cancelSpeech();

    expect(ttsBridge.stop).not.toHaveBeenCalled();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it('IS_IOS 插件可用时 cancelSpeech 走 TtsBridge.stop', async () => {
    platformState.isIos = true;
    pluginState.available = true;
    installFakeSpeechSynthesis();
    const { cancelSpeech } = await import('./tts');

    cancelSpeech();

    expect(ttsBridge.stop).toHaveBeenCalledTimes(1);
  });

  it('非 iOS 平台（PWA/桌面）行为不变：不查插件、不碰 TtsBridge', async () => {
    platformState.isIos = false;
    pluginState.available = false; // 即便判定函数异常返回 false 也不影响 Web 路径
    setDesktopUserAgent();
    const synth = installFakeSpeechSynthesis();
    const { speakText } = await import('./tts');

    await speakText('apple', { rate: 1, accent: 'us' });

    expect(ttsBridge.speak).not.toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });
});
