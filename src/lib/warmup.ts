/**
 * 冷启动空闲预热（首屏渲染之后执行，绝不阻塞交互）。
 *
 * 为什么需要：
 * 用户「重启电脑后第一次点单词要等很久」，其中一个来源是首次点击才走到的冷路径——
 * `loadCoreIndex()`（253KB JSON）与首次语音列表枚举。这两件事都是「只做一次」的成本，
 * 但工作量和用户什么时候点没关系，所以可以提前到闲暇时段做掉。
 *
 * 约束（不许违反）：
 * - 不得阻塞首屏：一律走 `whenIdle()`，浏览器空闲或超时后才执行；
 * - 不得弹 Toast：预热失败静默（断网首启、SW 未就绪都属正常，页面自己有兜底）；
 * - 幂等：重复调用只调度一次。
 */
import { whenIdle } from './idle';
import { warmupTts } from './tts';
import { loadCoreIndex } from './wordbookCache';

/** 预热调度超时：首屏之后 2s 内即使不空闲也执行 */
const WARMUP_TIMEOUT_MS = 2000;

/** 是否已调度过（模块级幂等标记） */
let scheduled = false;

/**
 * 调度一次冷启动预热：
 * 1. 词库索引 core-index.json —— 首页统计、新词候选、`getWord()` 三级查找都依赖它；
 * 2. 系统语音列表 —— 桌面 Chromium 首次枚举会拉起系统语音引擎（Windows SAPI/OneCore），
 *    这一步可能占用主线程数百毫秒到数秒，放到空闲时段做掉最划算。
 */
export function scheduleWarmup(): void {
  if (scheduled) {
    return;
  }
  scheduled = true;
  whenIdle(() => {
    // 失败静默：索引缺失时各页面已有「—」占位与兜底文案
    void loadCoreIndex().catch(() => undefined);
    warmupTts();
  }, WARMUP_TIMEOUT_MS);
}
