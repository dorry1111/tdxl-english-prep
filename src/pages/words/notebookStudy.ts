/**
 * 生词本「学习生词」的一次性会话启动。
 *
 * 【临时方案，有更干净的解法时请删掉本文件】
 * sessionStore.start() 目前只支持 `{ resume }`，不支持「按指定词集启动」，
 * 而 NewWordProvider 是全局单例注入。因此这里：
 * 1. armNotebookSession(words)：装好待用词条并注入 provider；
 * 2. start() 内部取新词时会调用 provider 一次 → 拿到生词并**立即换回默认口径**；
 * 3. 页面卸载时再兜底恢复一次，避免 provider 泄漏到后续普通会话。
 *
 * 建议后续在 sessionStore 增加 `start({ words })` 覆盖入口，
 * 到时本文件可整体删除（NotebookPage 直接调 start({ words })）。
 */
import { BUILTIN_BOOK_ID } from '@/constants';
import { getCoreNewWordCandidates, listWordsByBook } from '@/db/repos/wordRepo';
import { stateKeyOfNorm } from '@/lib/hash';
import { setNewWordProvider, type NewWordProvider } from '@/store/sessionStore';
import type { Settings, Word } from '@/types';

/**
 * 与 sessionStore 内部默认 provider 等价的实现（用于「用完即恢复」）。
 * 口径：按 activeBookIds 顺序取候选，内置词库走索引候选、导入词库走 DB，按 stateKey 去重。
 */
const defaultLikeProvider: NewWordProvider = async (settings: Settings, limit: number) => {
  if (limit <= 0) {
    return [];
  }
  const collected: Word[] = [];
  const seen = new Set<string>();
  for (const bookId of settings.activeBookIds) {
    const candidates =
      bookId === BUILTIN_BOOK_ID
        ? await getCoreNewWordCandidates(limit * 2)
        : await listWordsByBook(bookId, limit * 2);
    for (const word of candidates) {
      const key = stateKeyOfNorm(word.norm);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      collected.push(word);
      if (collected.length >= limit) {
        return collected;
      }
    }
  }
  return collected;
};

/** 待下一次 start() 取用的词条 */
let pendingWords: Word[] | null = null;

/** 注入的 provider：取用一次后自动换回默认口径 */
const injectedProvider: NewWordProvider = async (settings, limit) => {
  const words = pendingWords;
  pendingWords = null;
  setNewWordProvider(defaultLikeProvider);
  if (words && words.length > 0) {
    return words.slice(0, Math.max(0, limit));
  }
  return defaultLikeProvider(settings, limit);
};

/**
 * 装填生词本词条，使下一次 `start()` 的新词部分取用这份词表。
 *
 * 注意：取用后（或调用 restoreDefaultNewWords）自动恢复默认口径，
 * 不会影响后续从首页发起的普通会话。
 */
export function armNotebookSession(words: Word[]): void {
  pendingWords = words;
  setNewWordProvider(injectedProvider);
}

/** 恢复默认新词口径（页面卸载 / 启动失败兜底） */
export function restoreDefaultNewWords(): void {
  pendingWords = null;
  setNewWordProvider(defaultLikeProvider);
}
