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
 * 所以 Apple 平台必须在 pointerdown 里用「真实短文本 + 极低音量」完成一次发声
 * （空白/零音量会被 WebKit 跳过，见 8.1 与 primeSpeechOnFirstGesture 注释）。
 * 但桌面 Chromium（Windows Chrome/Edge）没有任何手势限制，反过来它的
 * `speechSynthesis.speak()`/`getVoices()` 首次调用会拉起系统语音引擎
 * （Windows SAPI / OneCore voices），这一步可能占用主线程数百毫秒到数秒——
 * 把这次调用放进 pointerdown 处理栈里，就等于「用户点下去先卡住，再处理点击」。
 * 这正是「重启电脑后第一次点单词要等很久」的直接原因：重启后语音服务进程被重置，
 * 解锁逻辑又是会话内一次性（`primed`），所以只有第一次必现。
 * 结论：桌面端不在手势里 speak，改为首屏之后空闲时段预热语音列表（`warmupTts`）。
 */
import { whenIdle } from './idle';
import { isNativePluginAvailable } from './nativePlugins';
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
 * ≤1KB 内联静音 wav（44 字节 RIFF 头 + 0 数据）。
 * 解锁时先用 <audio> 播一次，激活 WKWebView 的媒体会话——
 * 部分iOS 版本上 speechSynthesis 与媒体会话绑定，会话未激活时首段语音会被丢弃。
 */
const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

/** Apple PWA 未解锁期间最多缓存的自动播请求数（防内存无限增长，超出丢最旧） */
const PENDING_SPEAK_MAX = 8;

/** 「TtsBridge 不可用回落」只警告一次（避免每次朗读刷日志） */
let ttsBridgeMissingWarned = false;

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
 * - 任何异常（静音模式、权限、磁盘无语音包）都吞掉，不向上抛；
 * - iOS 原生壳且 TtsBridge 已注册 → 走 AVSpeechSynthesizer（媒体路径，忽略静音键）；
 *   插件不可用（旧 IPA / 未注册）→ 警告一次并回落 Web speechSynthesis；
 * - Apple PWA（非原生壳）且尚未手势解锁时，本次播报入队，解锁后自动补播
 *   （WebKit 会丢弃解锁前的 speak，直接调用等于无声）。
 */
export function speakText(text: string, options: SpeakOptions): Promise<void> {
  if (text.trim().length === 0) {
    return Promise.resolve();
  }
  // iOS 原生壳：走 AVSpeechSynthesizer（媒体路径，忽略静音键），绕过 WKWebView speechSynthesis
  if (IS_IOS) {
    if (isNativePluginAvailable('TtsBridge')) {
      const lang = options.accent === 'us' ? 'en-US' : 'en-GB';
      void TtsBridge.speak({ text, lang, rate: options.rate }).catch((error: unknown) => {
        // 不抛出（保持吞错语义），但留排查痕迹：桥接层异常在这里现形
        console.warn('[tts] TtsBridge.speak 失败：', error);
      });
      return Promise.resolve();
    }
    // 防御性回落：旧 IPA / 插件未注册时 Capacitor 会抛 not implemented，
    // 回落到 Web speechSynthesis（受静音键控制，但有声总比无声好）
    if (!ttsBridgeMissingWarned) {
      ttsBridgeMissingWarned = true;
      console.warn('[tts] TtsBridge 原生插件不可用，回落 Web speechSynthesis');
    }
    // 继续走下方通用 speechSynthesis 路径
  }
  if (!isSpeechSupported()) {
    return Promise.resolve();
  }
  // Apple PWA 且未手势解锁：入队，等解锁后在手势栈内补播（详见 primeSpeechOnFirstGesture）
  if (requiresGestureUnlock() && !primed) {
    enqueuePendingSpeak(text, options);
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

/** Apple PWA 未解锁期间的自动播请求队列（解锁后补播） */
const pendingAutoSpeak: Array<() => void> = [];

/** 把一次播报请求放入解锁队列（超出上限丢最旧的，防自动播刷屏撑爆内存） */
function enqueuePendingSpeak(text: string, options: SpeakOptions): void {
  if (pendingAutoSpeak.length >= PENDING_SPEAK_MAX) {
    pendingAutoSpeak.shift();
  }
  pendingAutoSpeak.push(() => {
    void speakText(text, options);
  });
}

/** 解锁后补播全部入队请求（同步调用，仍处于手势调用栈内，满足 iOS 要求） */
function flushPendingSpeak(): void {
  const queued = pendingAutoSpeak.splice(0, pendingAutoSpeak.length);
  for (const speak of queued) {
    speak();
  }
}

/** 停止当前朗读（切卡、退出会话时调用） */
export function cancelSpeech(): void {
  if (IS_IOS) {
    if (isNativePluginAvailable('TtsBridge')) {
      try {
        void TtsBridge.stop().catch(() => undefined);
      } catch {
        // 忽略
      }
      return;
    }
    // 插件不可用：与 speakText 同口径，回落 Web speechSynthesis
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
 * 首次交互时的语音准备（App 根挂载时调用一次；StudyPage 既有调用保留，幂等）。
 *
 * 分平台处理，行为差异是有意为之：
 * - **Apple 平台（iOS/Safari）**：监听 pointerdown + touchend（capture，一次性），
 *   在首次手势调用栈内完成三件事（ARCHITECTURE 8.1）：
 *   ① 播一个 ≤1KB 的内联静音 wav，激活 WKWebView 媒体会话；
 *   ② 朗读一个真实短文本（'a'，volume 0.01 / rate 0.5）完成 WebKit 的
 *     「首次发声必须在手势栈内」解锁——旧实现的 `' ' + volume=0` 会被
 *     WebKit 视为空白/零音量 utterance 直接跳过，解锁失效、后续 speak 全静默；
 *   ③ 立即补播解锁前入队的自动播请求（speakText 队列）。
 *   顺手 `loadVoices()` 预热列表。监听器一次性、只绑一次、触发即自移除。
 * - **桌面端（Chromium/Firefox）**：绝不在手势栈里 speak（见文件头注释），
 *   只调度空闲预热 `warmupTts()`。
 *
 * 幂等：重复调用不会重复绑定监听。
 */
export function primeSpeechOnFirstGesture(): void {
  if (!isSpeechSupported() || typeof document === 'undefined' || primed) {
    return;
  }
  if (IS_IOS) {
    // 原生 iOS 且 TtsBridge 已注册：走 AVSpeechSynthesizer（媒体路径，无需手势解锁）
    if (isNativePluginAvailable('TtsBridge')) {
      primed = true;
      return;
    }
    // 插件不可用（旧 IPA / 未注册）：speakText 会回落 Web speechSynthesis，
    // 因此必须保留 WKWebView 的手势解锁——不置 primed，继续落入下方
    // requiresGestureUnlock 分支（iOS 的 UA 天然满足 isAppleSpeechPlatform）
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
    document.removeEventListener('touchend', unlock, true);
    try {
      // ① 内联静音 wav：激活 WKWebView 媒体会话（无数据块，不产生可闻声音）
      const silent = new Audio(SILENT_WAV_DATA_URI);
      const played = silent.play();
      if (played && typeof played.catch === 'function') {
        played.catch(() => undefined);
      }
    } catch {
      // jsdom / 不支持 Audio：忽略，wav 激活只是尽力而为
    }
    try {
      void loadVoices();
      // ② 真实短文本解锁：空白/零音量 utterance 会被 WebKit 跳过导致解锁失效，
      //    必须用可发声的字符 + 极低音量（几乎不可闻，但 WebKit 认定「发过声」）
      const utterance = new SpeechSynthesisUtterance('a');
      utterance.volume = 0.01;
      utterance.rate = 0.5;
      utterance.lang = 'en-GB';
      window.speechSynthesis.speak(utterance);
      perfMark('perf:tts:gesture-unlock');
    } catch {
      // 忽略：解锁失败不影响后续手动发音
    }
    // ③ 解锁后立即补播入队的自动播请求（仍处于手势调用栈内）
    flushPendingSpeak();
  };
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('touchend', unlock, true);
}
