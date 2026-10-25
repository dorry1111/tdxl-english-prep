/**
 * lib/tts 纯函数单测（T09 轻量测试）：口音挑选逻辑 + 平台判定。
 * jsdom 没有 speechSynthesis，isSpeechSupported() 应为 false 且不抛错。
 */
import { describe, expect, it } from 'vitest';

import {
  isAppleSpeechPlatform,
  isSpeechSupported,
  pickVoice,
  primeSpeechOnFirstGesture,
} from './tts';

/** 真实 UA（用于平台判定，避免在测试里 mock navigator） */
const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  winChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  winEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
} as const;

function voice(lang: string, name: string): SpeechSynthesisVoice {
  return {
    default: false,
    lang,
    localService: true,
    name,
    voiceURI: name,
  } as SpeechSynthesisVoice;
}

describe('pickVoice', () => {
  it('美音优先命中 en-US', () => {
    const voices = [voice('en-GB', 'Daniel'), voice('en-US', 'Samantha'), voice('zh-CN', 'Ting-Ting')];
    expect(pickVoice(voices, 'us')?.name).toBe('Samantha');
  });

  it('英音优先命中 en-GB（兼容 en_GB 下划线写法）', () => {
    expect(pickVoice([voice('en_GB', 'Daniel'), voice('en-US', 'Samantha')], 'uk')?.name).toBe('Daniel');
  });

  it('无精确口音时回退到任意 en 语音', () => {
    const voices = [voice('en-AU', 'Karen'), voice('zh-CN', 'Ting-Ting')];
    expect(pickVoice(voices, 'uk')?.name).toBe('Karen');
  });

  it('完全没有英语语音时返回 null（交给系统默认音）', () => {
    expect(pickVoice([voice('zh-CN', 'Ting-Ting')], 'us')).toBeNull();
  });
});

describe('isSpeechSupported（jsdom 环境）', () => {
  it('jsdom 无 speechSynthesis，返回 false 且不抛错', () => {
    expect(isSpeechSupported()).toBe(false);
  });
});

describe('isAppleSpeechPlatform（决定「要不要在手势里发声」）', () => {
  it('iPhone / iPad 需要手势解锁', () => {
    expect(isAppleSpeechPlatform(UA.iphone, 5)).toBe(true);
    expect(
      isAppleSpeechPlatform(
        'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        5,
      ),
    ).toBe(true);
  });

  it('iPadOS 13+ 伪装成 macOS（有多点触控）也要手势解锁', () => {
    expect(isAppleSpeechPlatform(UA.macSafari, 5)).toBe(true);
  });

  it('macOS Safari 桌面版也要手势解锁', () => {
    expect(isAppleSpeechPlatform(UA.macSafari, 0)).toBe(true);
  });

  it('Windows Chrome / Edge 不需要手势内发声（避免首次 speak 卡住点击）', () => {
    expect(isAppleSpeechPlatform(UA.winChrome, 0)).toBe(false);
    expect(isAppleSpeechPlatform(UA.winEdge, 0)).toBe(false);
  });

  it('Android Chrome 也不需要手势内发声', () => {
    expect(isAppleSpeechPlatform(UA.androidChrome, 5)).toBe(false);
  });
});

describe('primeSpeechOnFirstGesture', () => {
  it('无 speechSynthesis 环境（jsdom）下为 no-op，不绑定监听不抛错', () => {
    expect(() => primeSpeechOnFirstGesture()).not.toThrow();
    expect(() => primeSpeechOnFirstGesture()).not.toThrow(); // 幂等
  });
});
