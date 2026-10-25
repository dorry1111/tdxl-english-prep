/**
 * 全局搜索页的纯逻辑（查询归一化 / 防抖参数）。
 *
 * 抽出来的目的：防抖时长是产品约定（300ms），单独常量化后既能单测，
 * 也方便 SearchPage 与将来的试卷搜索共用同一口径。
 */
import { normalizeWord } from '@/lib/wordbookCache';

/** 输入防抖时长（ms）：移动端逐字母输入时避免每个按键都查一次 */
export const SEARCH_DEBOUNCE_MS = 300;

/** 单次搜索返回上限 */
export const SEARCH_LIMIT = 20;

/** 查询归一化：去首尾空格 + 多空格合一 + 小写（与词库 norm 口径一致） */
export function normalizeQuery(raw: string): string {
  return normalizeWord(raw);
}

/** 是否发起搜索（空查询直接清空结果，不发请求） */
export function shouldSearch(query: string): boolean {
  return normalizeQuery(query).length > 0;
}
