/**
 * 系统 TTS 封装（speechSynthesis，零依赖，ARCHITECTURE 8.1）。
 *
 * 要点：
 * - 不引第三方语音库，只用系统 speechSynthesis；
 * - voiceschanged 异步加载：Chrome 首次 getVoices() 常返回空数组，必须等事件；
 * - 美/英音按 lang 前缀挑选，找不到精确口音时回退到任意 en 语音；
 * - 所有入口都做了不可用兜底（静音模式 / 无声卡不崩溃，只静默失败）。
 *
 * 【重要：手势解锁只在 Apple 平台做】
 * iOS/Safari 要求「首次发声发生在用户手势调用栈内」，否则后续 speak() 全部静默；
 * 所以 Apple 平台必须在 pointerdown 里朗读一个静音 utterance（见 8.1）。
 * 但桌面 Chromium（Windows Chrome/Edge）没有任何手势限制，反过来它的
 * `speechSynthesis.speak()`/`getVoices()` 首次调用会拉起系统语音引擎
 * （Windows SAPI / OneCore voices），这一步可能占用主线程数百毫秒到数秒——
 * 把这次调用放进 pointerdown 处理栈里，就等于「用户点下去先卡住，再处理点击」。
 * 这正是「重启电脑后第一次点单词要等很久」的直接原因：重启后语音服务进程被重置，
 * 解锁逻辑又是会话内一次性（`primed`），所以只有第一次必现。
 * 结论：桌面端不在手势里 speak，改为首屏之后空闲时段预热语音列表（`warmupTts`）。
 */
import { whenIdle } from './idle';
import { perfLog, perfMark } from './perf';
import { IS_IOS } from './platform';
import { TtsBridge } from './nativeTts';

/** 发音参数（来自 Settings 的 TTS 字段子集） */
export interface SpeakOptions {
  /** 语速 0.5 ~ 1.5 */
  rate: number;
  /** 口音：美音 / 英音 */
  accent: 'us' | 'uk';
}

/** speechSynthesis 是否可用（jsdom / 老浏览器为 false） */
export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * 从语音列表里挑一个最匹配口音的语音（纯函数，可测）。
 *
 * 匹配优先级：精确 lang（en-US / en-GB，兼容 `en_US` 下划线写法）
 * → 任意 en 开头 → null（调用方不设 voice，交给系统默认）。
 */
export function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  accent: 'us' | 'uk',
): SpeechSynthesisVoice | null {
  const preferred = accent === 'us' ? 'en-us' : 'en-gb';
  const exact = voices.find(
    (voice) => voice.lang.toLowerCase().replace('_', '-') === preferred,
  );
  if (exact) {
    return exact;
  }
  const anyEnglish = voices.find((voice) => voice.lang.toLowerCase().startsWith('en'));
  return anyEnglish ?? null;
}

/** voiceschanged 等待超时：超时后用当前列表兜底（可能为空，即用系统默认音） */
const VOICES_TIMEOUT_MS = 3000;

/**
 * 语音列表进程内缓存。
 *
 * 为什么要缓存：`getVoices()` 在 Windows Chromium 上首次调用需要拉起系统语音引擎，
 * 可能很慢；缓存非空结果后，后续朗读可以同步拿到列表并在手势调用栈内直接 speak
 * （iOS 的解锁要求也依赖这种「同步发声」）。
 */
let voicesCache: SpeechSynthesisVoice[] | null = null;

/** 已缓存的语音列表（未就绪返回 null，不触发枚举） */
export function peekVoices(): readonly SpeechSynthesisVoice[] | null {
  return voicesCache;
}

/**
 * 加载可用语音列表。
 * 首次调用 getVoices() 为空时挂 voiceschanged 监听；已非空直接返回。
 */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!isSpeechSupported()) {
    return Promise.resolve([]);
  }
  const synth = window.speechSynthesis;
  const existing = synth.getVoices();
  if (existing.length > 0) {
    voicesCache = existing;
    perfMark('perf:tts:voices-ready');
    return Promise.resolve(existing);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      synth.removeEventListener('voiceschanged', onVoicesChanged);
      const voices = synth.getVoices();
      if (voices.length > 0) {
        voicesCache = voices;
      }
      perfMark('perf:tts:voices-ready');
      perfLog(`TTS voices 就绪 ${voices.length} 个`);
      resolve(voices);
    };
    const onVoicesChanged = (): void => {
      if (synth.getVoices().length > 0) {
        finish();
      }
    };
    const timer = window.setTimeout(finish, VOICES_TIMEOUT_MS);
    synth.addEventListener('voiceschanged', onVoicesChanged);
  });
}

/** 语速边界（与 Settings.ttsRate 的 0.5 ~ 1.5 一致，越界收敛） */
const RATE_MIN = 0.5;
const RATE_MAX = 1.5;

/**
 * 朗读一段文本。
 *
 * - 每次朗读前 cancel 上一段，避免排队连读；
 * - **不等待语音列表**：旧实现 `await loadVoices()`（超时 3s）会把「点喇叭出声」
 *   硬生生拖慢最多 3 秒，也让 iOS 的「手势内发声」失效（await 之后已不在手势栈里）。
 *   现在改为：列表已就绪 → 同步挑口音后立即 speak；列表未就绪 → 先用「只设 lang」
 *   的 utterance 让系统按语言选默认音发声（听得清，只是口音可能是默认那个），
 *   同时后台把列表补进缓存，下一次朗读就能命中口音；
 * - voice 加载失败时只设 lang，由系统按 lang 选默认音；
 * - 任何异常（静音模式、权限、磁盘无语音包）都吞掉，不向上抛。
 */
export function speakText(text: string, options: SpeakOptions): Promise<void> {
  if (text.trim().length === 0) {
    return Promise.resolve();
  }
  // iOS 原生壳：走 AVSpeechSynthesizer（媒体路径，忽略静音键），绕过 WKWebView speechSynthesis
  if (IS_IOS) {
    const lang = options.accent === 'us' ? 'en-US' : 'en-GB';
    void TtsBridge.speak({ text, lang, rate: options.rate }).catch(() => undefined);
    return Promise.resolve();
  }
  if (!isSpeechSupported()) {
    return Promise.resolve();
  }
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.accent === 'us' ? 'en-US' : 'en-GB';
    utterance.rate = Math.min(Math.max(options.rate, RATE_MIN), RATE_MAX);

    const voices = voicesCache ?? synth.getVoices();
    if (voices.length > 0) {
      voicesCache = voices;
      const voice = pickVoice(voices, options.accent);
      if (voice) {
        utterance.voice = voice;
      }
    } else {
      // 后台补列表（不阻塞本次发声）：拿到后下次朗读即可按口音挑选
      void loadVoices();
    }

    synth.speak(utterance);
  } catch {
    // 静音模式 / 设备不支持：静默失败（喇叭按钮由调用方按 supported 置灰）
  }
  return Promise.resolve();
}

/** 停止当前朗读（切卡、退出会话时调用） */
export function cancelSpeech(): void {
  if (IS_IOS) {
    try {
      void TtsBridge.stop().catch(() => undefined);
    } catch {
      // 忽略
    }
    return;
  }
  if (!isSpeechSupported()) {
    return;
  }
  try {
    window.speechSynthesis.cancel();
  } catch {
    // 忽略
  }
}

/** 首次手势解锁标记（模块级，页面生命周期内只解一次） */
let primed = false;

/** 手势监听是否已绑定（防止 effect 重跑时重复绑定） */
let gestureBound = false;

/** 桌面端语音预热是否已调度 */
let warmupScheduled = false;

/**
 * 判断是否为「必须在用户手势调用栈内发声」的 Apple 平台（纯函数，可测）。
 *
 * 覆盖三种情况：
 * 1. iPhone / iPad / iPod：UA 里直接带设备名；
 * 2. iPadOS 13+ 伪装成 macOS：UA 是 Macintosh，但有多点触控（maxTouchPoints > 1）；
 * 3. macOS Safari 桌面版：UA 自称 Safari 且不是 Chrome/Edge/Firefox 伪装的。
 *
 * Windows / Android 上的 Chromium 与 Firefox 不需要手势解锁，返回 false——
 * 这正是「桌面端不要在手势里 speak」的判定依据。
 */
export function isAppleSpeechPlatform(ua: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/i.test(ua)) {
    return true;
  }
  if (!/Macintosh|Mac OS X/i.test(ua)) {
    return false;
  }
  if (maxTouchPoints > 1) {
    return true; // iPadOS 13+ 桌面模式
  }
  const isSafari = /Safari/i.test(ua);
  const isOtherChromium = /Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/i.test(ua);
  return isSafari && !isOtherChromium;
}

/** 当前运行环境是否要求「手势内发声」（读 navigator，纯逻辑在同名纯函数里） */
export function requiresGestureUnlock(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return isAppleSpeechPlatform(navigator.userAgent ?? '', navigator.maxTouchPoints ?? 0);
}

/**
 * 桌面端语音预热（幂等、空闲执行）。
 *
 * 桌面 Chromium 首次枚举/首次 speak 会把系统语音引擎拉起来（Windows 上尤其明显），
 * 这一步耗时与「用户什么时候点」无关，所以提前到首屏之后的空闲时段做掉，
 * 用户点卡片揭示答案时就不会再撞上这段初始化。
 *
 * 只做 voices 枚举，**不发声**：真正发声留给第一次真实发音（自动发音 / 喇叭按钮）。
 */
export function warmupTts(): void {
  if (!isSpeechSupported() || warmupScheduled) {
    return;
  }
  warmupScheduled = true;
  whenIdle(() => {
    void loadVoices().catch(() => undefined);
  }, 2500);
}

/**
 * 首次交互时的语音准备（StudyPage 挂载时调用）。
 *
 * 分平台处理，行为差异是有意为之：
 * - **Apple 平台（iOS/Safari）**：在首次 pointerdown 的手势调用栈内朗读一个
 *   volume=0 的单空格 utterance。这不是为了「预热」，而是 iOS 的硬性要求：
 *   首次发声必须在手势栈内，否则后续 speak() 全部静默（ARCHITECTURE 8.1）。
 *   顺手 `loadVoices()` 预热列表。监听器一次性、只绑一次、触发即自移除。
 * - **桌面端（Chromium/Firefox）**：绝不在手势栈里 speak（见文件头注释），
 *   只调度空闲预热 `warmupTts()`。
 *
 * 幂等：重复调用不会重复绑定监听（此前每次 effect 重跑都会新增一个 pointerdown
 * 监听器，虽然功能上无碍，但属于明确的重复绑定缺陷）。
 */
export function primeSpeechOnFirstGesture(): void {
  if (!isSpeechSupported() || typeof document === 'undefined' || primed) {
    return;
  }
  if (IS_IOS) {
    // 原生 iOS 走 AVSpeechSynthesizer（媒体路径，无需用户手势解锁），无需 WKWebView 解锁逻辑
    primed = true;
    return;
  }
  if (!requiresGestureUnlock()) {
    // 桌面端：不做手势内发声，只安排空闲预热
    primed = true;
    warmupTts();
    return;
  }
  if (gestureBound) {
    return;
  }
  gestureBound = true;
  const unlock = (): void => {
    if (primed) {
      return;
    }
    primed = true;
    document.removeEventListener('pointerdown', unlock, true);
    try {
      void loadVoices();
      const utterance = new SpeechSynthesisUtterance(' ');
      utterance.volume = 0;
      utterance.lang = 'en-GB';
      window.speechSynthesis.speak(utterance);
      perfMark('perf:tts:gesture-unlock');
    } catch {
      // 忽略：解锁失败不影响后续手动发音
    }
  };
  document.addEventListener('pointerdown', unlock, true);
}
