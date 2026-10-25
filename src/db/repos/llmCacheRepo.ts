/**
 * LLM 结果缓存仓库（v4）。
 *
 * 缓存 AI 讲解 / AI 诊断 / AI 评估的生成结果：
 * - 主键 `llm:<feature>:<refId>` 由调用方拼装（cacheKeyOf）；
 * - promptVersion 不匹配时调用方应视为未命中并重新生成（本仓库不管失效策略）；
 * - 本表仅本地，不标脏、不进同步（sync 表清单不含 llmCache）。
 */
import { db, toDbError } from '@/db';
import type { LlmCacheRecord } from '@/types';

/** 拼装缓存主键 */
export function cacheKeyOf(feature: LlmCacheRecord['feature'], refId: string): string {
  return `llm:${feature}:${refId}`;
}

/**
 * 读缓存。promptVersion 不匹配视为未命中（返回 null，由调用方重新生成）。
 */
export async function getCached(
  feature: LlmCacheRecord['feature'],
  refId: string,
  promptVersion: number,
): Promise<LlmCacheRecord | null> {
  const record = await db.llmCache.get(cacheKeyOf(feature, refId));
  if (!record || record.promptVersion !== promptVersion) {
    return null;
  }
  return record;
}

/** 写缓存（同键覆盖） */
export async function putCached(
  feature: LlmCacheRecord['feature'],
  refId: string,
  promptVersion: number,
  content: string,
  model: string,
): Promise<void> {
  try {
    const record: LlmCacheRecord = {
      id: cacheKeyOf(feature, refId),
      feature,
      promptVersion,
      content,
      model,
      createdAt: Date.now(),
    };
    await db.llmCache.put(record);
  } catch (error) {
    throw toDbError(error);
  }
}

/** 按功能列历史（新的在前；诊断报告回看用） */
export async function listByFeature(
  feature: LlmCacheRecord['feature'],
  limit = 20,
): Promise<LlmCacheRecord[]> {
  const rows = await db.llmCache.where('feature').equals(feature).toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

/** 删单条缓存（「重新生成」由调用方先删再生成） */
export async function removeCached(
  feature: LlmCacheRecord['feature'],
  refId: string,
): Promise<void> {
  await db.llmCache.delete(cacheKeyOf(feature, refId));
}
