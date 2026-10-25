/**
 * AI 生成 Runner：配置加载 + 缓存读写 + 统一错误文案。
 *
 * 三个 AI 功能（讲解 / 诊断 / 评估）共用：
 * - 配置来自 Settings（AiCard 已配好）+ secrets 表 llm-key；
 * - 结果写 llmCache 表（本地、不同步），命中缓存不重复计费；
 * - promptVersion 变化（提示词升级）时缓存自动失效。
 */
import { getLlmKey, getSettings } from '@/db/repos/settingsRepo';
import { getCached, putCached } from '@/db/repos/llmCacheRepo';
import type { LlmConfig } from '@/lib/llm';
import { resolveLlmConfig } from '@/lib/llm';
import type { LlmCacheRecord } from '@/types';

/** 提示词版本：改动任一系统提示词时必须 +1，旧缓存自动失效 */
export const LLM_PROMPT_VERSION = 1;

export type AiFeature = LlmCacheRecord['feature'];

/** 未配置时的统一提示（调用方用来置灰按钮或弹 Toast） */
export const AI_NOT_CONFIGURED = '请先在「我的 → 大模型」里配置并保存 API Key。';

/** 加载 LLM 配置；未配置或没存 Key 时返回 null */
export async function loadAiConfig(): Promise<LlmConfig | null> {
  const [settings, apiKey] = await Promise.all([getSettings(), getLlmKey()]);
  if (!settings) {
    return null;
  }
  const config = resolveLlmConfig(settings, apiKey);
  if (!config || config.apiKey === '') {
    return null;
  }
  return config;
}

export interface AiRunResult {
  content: string;
  /** true = 来自缓存（未调用接口，未计费） */
  fromCache: boolean;
}

/**
 * 带缓存的生成：命中缓存直接返回；否则调 generate 并落库。
 * 任何错误原样抛出（llm.ts 的 message 已是用户可读中文）。
 */
export async function runAi(
  feature: AiFeature,
  refId: string,
  generate: (config: LlmConfig) => Promise<string>,
): Promise<AiRunResult> {
  const cached = await getCached(feature, refId, LLM_PROMPT_VERSION);
  if (cached) {
    return { content: cached.content, fromCache: true };
  }
  const config = await loadAiConfig();
  if (!config) {
    throw new Error(AI_NOT_CONFIGURED);
  }
  const content = await generate(config);
  await putCached(feature, refId, LLM_PROMPT_VERSION, content, config.model);
  return { content, fromCache: false };
}
