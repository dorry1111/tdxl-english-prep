/**
 * 发音 hook（T09）：包装 lib/tts，按全局设置决定是否发音。
 *
 * - `speak(text)`：喇叭按钮等用户手势触发（ttsEnabled 开启时朗读）；
 * - `speak(text, { auto: true })`：出卡自动发音，只有 ttsAutoPlay 也开启时才朗读；
 *   浏览器要求首次朗读由用户手势解锁，自动发音在未解锁时会被系统忽略，属预期行为；
 * - `supported`：speechSynthesis 不可用时调用方把喇叭置灰并提示。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getSettings } from '@/db/repos/settingsRepo';
import { isSpeechSupported, speakText } from '@/lib/tts';

/** useSpeak 返回值 */
export interface UseSpeakResult {
  speak: (text: string, options?: { auto?: boolean }) => void;
  supported: boolean;
}

/** 只保留 TTS 相关字段，避免设置对象变化引发无谓重渲染 */
interface TtsSettings {
  ttsEnabled: boolean;
  ttsAutoPlay: boolean;
  ttsRate: number;
  ttsAccent: 'us' | 'uk';
}

export function useSpeak(): UseSpeakResult {
  const supported = useMemo(() => isSpeechSupported(), []);
  const [tts, setTts] = useState<TtsSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSettings().then((settings) => {
      if (cancelled) {
        return;
      }
      setTts(
        settings
          ? {
              ttsEnabled: settings.ttsEnabled,
              ttsAutoPlay: settings.ttsAutoPlay,
              ttsRate: settings.ttsRate,
              ttsAccent: settings.ttsAccent,
            }
          : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const speak = useCallback(
    (text: string, options?: { auto?: boolean }) => {
      if (!tts || !tts.ttsEnabled) {
        return;
      }
      if (options?.auto === true && !tts.ttsAutoPlay) {
        return;
      }
      void speakText(text, { rate: tts.ttsRate, accent: tts.ttsAccent });
    },
    [tts],
  );

  return { speak, supported };
}
