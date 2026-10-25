/**
 * lib/tts 手势解锁行为测试（jsdom + 假 speechSynthesis）。
 *
 * 为什么必须用「行为测试」而不是读代码：
 * 「Windows 重启后首次点单词卡好几秒」的根因是 `primeSpeechOnFirstGesture()` 在
 * pointerdown 捕获阶段里立刻 `speak()`。这个缺陷只有在**真的派发一次 pointerdown**
 * 时才会暴露，纯函数测试（isAppleSpeechPlatform）无法证明手势里没有发声。
 *
 * 覆盖：
 * 1. 桌面 Windows Chrome/Edge → pointerdown 后 speak 0 次（本次修复的核心断言）；
 * 2. iPhone → pointerdown 后 speak 1 次且 volume === 0（iOS 解锁不能坏）；
 * 3. 重复调用 primeSpeechOnFirstGesture → 监听只绑一次、只解锁一次（幂等）；
 * 4. iPadOS 伪装 macOS（Macintosh + maxTouchPoints > 1）→ 仍走 Apple 解锁；
 * 5. speakText → 语音列表为空时也同步发声（不等 voices），有列表时按口音选 voice。
 *
 * 说明：tts.ts 用模块级变量保存 `primed` / `gestureBound` / `voicesCache`，
 * 因此每个用例都要 `vi.resetModules()` + 动态 import，拿到干净实例。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 真实 UA（平台判定读 navigator，不在浏览器里就只能改写它） */
const UA = {
  winChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  winEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  /** iPadOS 13+ 桌面模式：UA 自称 macOS Safari，靠 maxTouchPoints 区分 */
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  /** macOS 上的 Chrome：UA 同时含 Macintosh 与 Safari，但不是真 Safari */
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
} as const;

/** 假的 SpeechSynthesisUtterance：只保留断言需要的字段 */
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

/** 假 speechSynthesis 的句柄：暴露调用记录与可控的语音列表 */
interface FakeSynth {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  getVoices: ReturnType<typeof vi.fn>;
  /** 已「朗读」的 utterance（按调用顺序） */
  spoken: FakeUtterance[];
  setVoices(next: SpeechSynthesisVoice[]): void;
  /** 触发一次 voiceschanged（模拟系统语音列表异步就绪） */
  emitVoicesChanged(): void;
}

function voice(lang: string, name: string): SpeechSynthesisVoice {
  return { default: false, lang, localService: true, name, voiceURI: name } as SpeechSynthesisVoice;
}

/** 装一个假 speechSynthesis 到 window 上 */
function installFakeSpeechSynthesis(initialVoices: SpeechSynthesisVoice[] = []): FakeSynth {
  const spoken: FakeUtterance[] = [];
  const listeners = new Set<() => void>();
  let voices = initialVoices;

  const speak = vi.fn((utterance: FakeUtterance) => {
    spoken.push(utterance);
  });
  const cancel = vi.fn();
  const getVoices = vi.fn(() => voices);

  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    writable: true,
    value: {
      speak,
      cancel,
      getVoices,
      addEventListener: (type: string, handler: () => void): void => {
        if (type === 'voiceschanged') {
          listeners.add(handler);
        }
      },
      removeEventListener: (type: string, handler: () => void): void => {
        if (type === 'voiceschanged') {
          listeners.delete(handler);
        }
      },
    },
  });

  return {
    speak,
    cancel,
    getVoices,
    spoken,
    setVoices: (next) => {
      voices = next;
    },
    emitVoicesChanged: () => {
      for (const handler of [...listeners]) {
        handler();
      }
    },
  };
}

/** 改写 navigator（UA 与触点数决定走哪条解锁分支） */
function setUserAgent(userAgent: string, maxTouchPoints = 0): void {
  Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: userAgent });
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    configurable: true,
    value: maxTouchPoints,
  });
}

/** 派发一次真实冒泡的 pointerdown（捕获阶段监听才会被触发） */
function dispatchPointerDown(): void {
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

/** 等一段真实时间，让 whenIdle 的 setTimeout(300ms) 兜底真的跑起来 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    configurable: true,
    writable: true,
    value: FakeUtterance,
  });
});

afterEach(() => {
  // 兜底：若某用例在派发 pointerdown 之前就断言失败，一次性监听会残留到下一个用例，
  // 这里空派发一次让它自移除（此时断言已结束，不会污染结果）。
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  delete (window as unknown as Record<string, unknown>).speechSynthesis;
  delete (globalThis as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
  vi.restoreAllMocks();
});

describe('isAppleSpeechPlatform — 纯函数（不读 navigator，直接断言 UA + 触点数）', () => {
  it('iPadOS 13+ 伪装成 macOS：Macintosh UA + maxTouchPoints > 1 → true', async () => {
    const { isAppleSpeechPlatform } = await import('./tts');
    expect(isAppleSpeechPlatform(UA.macSafari, 5)).toBe(true);
    expect(isAppleSpeechPlatform(UA.macSafari, 2)).toBe(true);
  });

  it('macOS Safari 桌面版（无多点触控）也 true；macOS Chrome 必须 false', async () => {
    const { isAppleSpeechPlatform } = await import('./tts');
    // 真 Safari：UA 含 Safari 且不含任何其它内核标识
    expect(isAppleSpeechPlatform(UA.macSafari, 0)).toBe(true);
    // macOS Chrome：UA 同时含 Macintosh 与 Safari，但 Chrome 标识必须把它排除掉，
    // 否则 macOS Chrome 用户会被白白塞进手势栈里 speak（本次修复要消灭的行为）
    expect(isAppleSpeechPlatform(UA.macChrome, 0)).toBe(false);
  });

  it('Windows Chrome / Edge：maxTouchPoints 再大也不能变成 Apple 分支', async () => {
    const { isAppleSpeechPlatform } = await import('./tts');
    expect(isAppleSpeechPlatform(UA.winChrome, 0)).toBe(false);
    expect(isAppleSpeechPlatform(UA.winChrome, 10)).toBe(false);
    expect(isAppleSpeechPlatform(UA.winEdge, 0)).toBe(false);
    expect(isAppleSpeechPlatform(UA.winEdge, 10)).toBe(false);
  });

  it('iPhone UA 直接命中设备名，与触点数无关', async () => {
    const { isAppleSpeechPlatform } = await import('./tts');
    expect(isAppleSpeechPlatform(UA.iphone, 0)).toBe(true);
    expect(isAppleSpeechPlatform(UA.iphone, 5)).toBe(true);
  });
});

describe('primeSpeechOnFirstGesture — 桌面端（本次修复的核心）', () => {
  it('Windows Chrome：pointerdown 后 speak 调用 0 次', async () => {
    setUserAgent(UA.winChrome, 0);
    const synth = installFakeSpeechSynthesis([voice('en-GB', 'Daniel')]);
    const tts = await import('./tts');

    expect(tts.requiresGestureUnlock()).toBe(false);

    tts.primeSpeechOnFirstGesture();
    dispatchPointerDown();
    dispatchPointerDown();

    expect(synth.speak).toHaveBeenCalledTimes(0);
  });

  it('Windows Chrome：空闲预热只枚举语音列表，绝不发声', async () => {
    setUserAgent(UA.winChrome, 0);
    const synth = installFakeSpeechSynthesis([voice('en-GB', 'Daniel')]);
    const tts = await import('./tts');

    tts.primeSpeechOnFirstGesture();
    // 桌面分支只调度 whenIdle(…, 2500)，jsdom 无 rIC → setTimeout 300ms 兜底
    await wait(400);

    expect(synth.getVoices).toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledTimes(0);
  });

  it('Windows Edge：同样不在手势里发声', async () => {
    setUserAgent(UA.winEdge, 0);
    const synth = installFakeSpeechSynthesis([voice('en-GB', 'Daniel')]);
    const tts = await import('./tts');

    expect(tts.requiresGestureUnlock()).toBe(false);

    tts.primeSpeechOnFirstGesture();
    dispatchPointerDown();

    expect(synth.speak).toHaveBeenCalledTimes(0);
  });
});

describe('primeSpeechOnFirstGesture — Apple 端（手势解锁不能被改坏）', () => {
  it('iPhone：pointerdown 触发一次 volume=0 的静音解锁', async () => {
    setUserAgent(UA.iphone, 5);
    const synth = installFakeSpeechSynthesis([voice('en-GB', 'Daniel')]);
    const tts = await import('./tts');

    expect(tts.requiresGestureUnlock()).toBe(true);

    tts.primeSpeechOnFirstGesture();
    // 未交互前不能发声（否则又变成页面加载即拉起语音引擎）
    expect(synth.speak).toHaveBeenCalledTimes(0);

    dispatchPointerDown();

    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(synth.spoken[0]?.volume).toBe(0);
  });

  it('iPadOS 伪装成 macOS（Macintosh + maxTouchPoints > 1）仍走 Apple 解锁', async () => {
    setUserAgent(UA.macSafari, 5);
    const synth = installFakeSpeechSynthesis([voice('en-GB', 'Daniel')]);
    const tts = await import('./tts');

    expect(tts.requiresGestureUnlock()).toBe(true);

    tts.primeSpeechOnFirstGesture();
    dispatchPointerDown();

    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(synth.spoken[0]?.volume).toBe(0);
  });
});

describe('primeSpeechOnFirstGesture — 幂等（StudyPage effect 反复重跑）', () => {
  it('重复调用只绑定一次 pointerdown 监听，且只解锁一次', async () => {
    setUserAgent(UA.iphone, 5);
    const synth = installFakeSpeechSynthesis([voice('en-GB', 'Daniel')]);
    const tts = await import('./tts');

    const pointerDownHandlers: unknown[] = [];
    const originalAdd = document.addEventListener;
    const patchedAdd = ((
      type: string,
      handler: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void => {
      if (type === 'pointerdown') {
        pointerDownHandlers.push(handler);
      }
      originalAdd.call(document, type, handler, options);
    }) as typeof document.addEventListener;
    document.addEventListener = patchedAdd;

    try {
      tts.primeSpeechOnFirstGesture();
      tts.primeSpeechOnFirstGesture();
      tts.primeSpeechOnFirstGesture();

      expect(pointerDownHandlers).toHaveLength(1);

      dispatchPointerDown();
      expect(synth.speak).toHaveBeenCalledTimes(1);

      // 一次性监听：解锁后自移除，再点不会重复 speak
      dispatchPointerDown();
      expect(synth.speak).toHaveBeenCalledTimes(1);
    } finally {
      document.addEventListener = originalAdd;
    }
  });
});

describe('speakText — 不等待语音列表', () => {
  it('getVoices() 返回空数组时仍同步 speak，且不抛错', async () => {
    const synth = installFakeSpeechSynthesis([]);
    const tts = await import('./tts');

    const promise = tts.speakText('apple', { rate: 1, accent: 'uk' });

    // 关键：speak 在函数返回前已发生（没有 await loadVoices 的 3s 等待）
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(synth.spoken[0]?.lang).toBe('en-GB');
    expect(synth.spoken[0]?.voice).toBeNull();

    // 后台补齐列表后正常结束（不产生悬挂 3s 定时器）
    synth.setVoices([voice('en-GB', 'Daniel'), voice('en-US', 'Samantha')]);
    synth.emitVoicesChanged();

    await expect(promise).resolves.toBeUndefined();
  });

  it('有语音列表时同步按口音挑中 voice', async () => {
    const synth = installFakeSpeechSynthesis([
      voice('en-GB', 'Daniel'),
      voice('en-US', 'Samantha'),
      voice('zh-CN', 'Ting-Ting'),
    ]);
    const tts = await import('./tts');

    void tts.speakText('apple', { rate: 1, accent: 'us' });
    expect(synth.spoken[0]?.voice?.name).toBe('Samantha');

    void tts.speakText('apple', { rate: 1, accent: 'uk' });
    expect(synth.spoken[1]?.voice?.name).toBe('Daniel');
  });

  it('空文本不发任何 utterance', async () => {
    const synth = installFakeSpeechSynthesis([voice('en-US', 'Samantha')]);
    const tts = await import('./tts');

    await tts.speakText('   ', { rate: 1, accent: 'us' });

    expect(synth.speak).toHaveBeenCalledTimes(0);
    expect(synth.cancel).toHaveBeenCalledTimes(0);
  });
});
