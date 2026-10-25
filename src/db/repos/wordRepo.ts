/**
 * 词条仓库。
 *
 * getWord() 三级查找（T08）：words 表（用户导入词）→ 内置词库分片内存缓存 → fetch 分片。
 * 新词候选与前缀搜索：内置词库只读索引（wordbookCache），无需加载全部分片。
 */
import { REMOTE_FILES } from '@/constants';
import { db, markDirty, toDbError } from '@/db';
import { stateKeyOfNorm } from '@/lib/hash';
import {
  getAllCoreWords,
  getCoreShard,
  getCoreWord,
  getNewWordCandidates,
  loadCoreIndex,
  normalizeWord,
  searchCoreByNorm,
  type CoreIndexRow,
} from '@/lib/wordbookCache';
import { now } from '@/lib/time';
import { traceAsync } from '@/lib/perf';
import type { Word } from '@/types';

const ENTITY = REMOTE_FILES.wordbook;

/** 按词条 ID 取词（ID 规则：`${bookId}:${norm}`；内置词走分片缓存） */
export function getWord(id: string): Promise<Word | undefined> {
  // 打点：三级查找（DB → 分片内存 → fetch 分片）的首次耗时会直接体现在
  // 「打开词条页要等多久」上，带 ?perf=1 可看到真实数字
  return traceAsync('word:getWord', async () => {
    const fromDb = await db.words.get(id);
    if (fromDb) {
      return fromDb;
    }
    const fromCore = await getCoreWord(id);
    return (fromCore as Word | null) ?? undefined;
  });
}

/** 按「词库 + norm」取词 */
export async function getWordByNorm(bookId: string, norm: string): Promise<Word | undefined> {
  return db.words.where('[bookId+norm]').equals([bookId, normalizeWord(norm)]).first();
}

/** 批量写入/更新词条（导入词库、灌入内置词时使用） */
export async function bulkPutWords(words: Word[]): Promise<void> {
  if (words.length === 0) {
    return;
  }
  try {
    await db.transaction('rw', db.words, db.syncMeta, async () => {
      await db.words.bulkPut(words);
      await markDirty(ENTITY, words.length);
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 取某个词库下的词条（按词频序升序，无词频的排后面） */
export async function listWordsByBook(bookId: string, limit?: number): Promise<Word[]> {
  // 先取全量再按词频排序，最后才截断——避免 limit 作用在 index 顺序上导致返回的不是"最靠前的 N 个"
  const words = await db.words.where('bookId').equals(bookId).toArray();
  const sorted = words
    .filter((word) => word.deletedAt === null)
    .sort((left, right) => rankOf(left) - rankOf(right));
  return limit === undefined ? sorted : sorted.slice(0, limit);
}

/** 词频序归一化：缺失时排到最后 */
function rankOf(word: Word): number {
  return word.frequencyRank ?? Number.MAX_SAFE_INTEGER;
}

/** 统计某个词库的词条数（不含墓碑） */
export async function countWordsByBook(bookId: string): Promise<number> {
  const words = await db.words.where('bookId').equals(bookId).toArray();
  return words.filter((word) => word.deletedAt === null).length;
}

/**
 * 内置词库新词候选：索引排序（frequencyRank ?? sourceOrder）→ 跳过已学 →
 * 只加载命中词所在的分片，水合成完整词条（顺序与索引候选一致）。
 */
export async function getCoreNewWordCandidates(limit: number): Promise<Word[]> {
  const index = await loadCoreIndex();
  // 已学集合：WordState.firstLearnedAt 非空即「已开始学习」（含跨词库共享状态）
  const states = await db.wordStates.toArray();
  const learnedNorms = new Set<string>();
  if (states.some((state) => state.firstLearnedAt !== null && state.deletedAt === null)) {
    const normByKey = normByStateKey(index.entries);
    for (const state of states) {
      if (state.firstLearnedAt !== null && state.deletedAt === null) {
        const norm = normByKey.get(state.stateKey);
        if (norm) {
          learnedNorms.add(norm);
        }
      }
    }
  }
  const { items } = getNewWordCandidates(learnedNorms, limit);

  // 按 shard 分组取数，保持候选顺序水合
  const byShard = new Map<string, string[]>();
  for (const row of items) {
    const norms = byShard.get(row[4]) ?? [];
    norms.push(row[0]);
    byShard.set(row[4], norms);
  }
  const wordByNorm = new Map<string, Word>();
  await Promise.all(
    [...byShard.entries()].map(async ([shardName, norms]) => {
      const shard = await getCoreShard(shardName);
      for (const norm of norms) {
        const found = shard.words.find((w) => (w as Word).norm === norm);
        if (found) {
          wordByNorm.set(norm, found as Word);
        }
      }
    }),
  );
  return items
    .map((row) => wordByNorm.get(row[0]))
    .filter((word): word is Word => word !== undefined);
}

/** stateKey → norm 映射（fnv1a 不可逆，只能遍历索引；进程内缓存，数据不变） */
let cachedNormByKey: { indexEntries: unknown; map: Map<string, string> } | null = null;
function normByStateKey(entries: readonly CoreIndexRow[]): Map<string, string> {
  if (cachedNormByKey && cachedNormByKey.indexEntries === entries) {
    return cachedNormByKey.map;
  }
  const map = new Map<string, string>();
  for (const row of entries) {
    map.set(stateKeyOfNorm(row[0]), row[0]);
  }
  cachedNormByKey = { indexEntries: entries, map };
  return map;
}

/**
 * 按前缀搜索词条：用户导入词（DB）+ 内置词库索引合并，命中上限各占一半。
 */
export async function searchByNormPrefix(prefix: string, limit = 20): Promise<Word[]> {
  const normalized = normalizeWord(prefix);
  if (normalized.length === 0) {
    return [];
  }
  // 索引搜索读的是内存缓存：搜索页可能被直开（桌面弹窗），必须先确保索引已加载
  await loadCoreIndex();
  const dbHits = await db.words
    .where('norm')
    .startsWith(normalized)
    .limit(limit)
    .toArray();

  const coreRows = searchCoreByNorm(normalized, Math.max(limit - dbHits.length, 0));
  const coreWords: Word[] = [];
  if (coreRows.length > 0) {
    const byShard = new Map<string, string[]>();
    for (const row of coreRows) {
      const norms = byShard.get(row[4]) ?? [];
      norms.push(row[0]);
      byShard.set(row[4], norms);
    }
    await Promise.all(
      [...byShard.entries()].map(async ([shardName, norms]) => {
        const shard = await getCoreShard(shardName);
        for (const norm of norms) {
          const found = shard.words.find((w) => (w as Word).norm === norm);
          if (found) {
            coreWords.push(found as Word);
          }
        }
      }),
    );
  }
  // DB 命中在前，索引命中按索引顺序在后
  const seen = new Set(dbHits.map((w) => w.norm));
  return [...dbHits, ...coreWords.filter((w) => !seen.has(w.norm))].slice(0, limit);
}

/** 查询词是否含 CJK（中文释义搜索只在含汉字时才做，避免英文查询白白拉全量分片） */
export function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

/** 释义命中判定：任一释义的中文含查询词（大小写不敏感） */
function meaningsInclude(word: { meanings: ReadonlyArray<{ cn: string }> }, needle: string): boolean {
  return word.meanings.some((meaning) => meaning.cn.toLowerCase().includes(needle));
}

/**
 * 按中文释义子串搜索：用户导入词（DB 扫描）+ 内置词库（全分片水合扫描）。
 * 仅在查询词含汉字时值得调用；英文查询请走 searchByNormPrefix。
 */
export async function searchByCnContains(text: string, limit = 20): Promise<Word[]> {
  const needle = text.trim().toLowerCase();
  if (needle.length === 0) {
    return [];
  }
  const dbRows = await db.words.toArray();
  const dbHits = dbRows
    .filter((word) => word.deletedAt === null && meaningsInclude(word, needle))
    .slice(0, limit);
  if (dbHits.length >= limit) {
    return dbHits;
  }
  const coreWords = await getAllCoreWords();
  const seen = new Set(dbHits.map((word) => word.norm));
  const coreHits: Word[] = [];
  for (const core of coreWords) {
    if (seen.has(core.norm)) {
      continue;
    }
    if (meaningsInclude(core, needle)) {
      coreHits.push(core);
      if (dbHits.length + coreHits.length >= limit) {
        break;
      }
    }
  }
  return [...dbHits, ...coreHits];
}

/**
 * 双语合并搜索（P4）：英文前缀命中在前（更精确），中文释义命中去重后补位。
 * 查询词不含汉字时跳过中文搜索（省一次全分片水合）。
 */
export async function searchBilingual(query: string, limit = 20): Promise<Word[]> {
  const normalized = normalizeWord(query);
  if (normalized.length === 0) {
    return [];
  }
  const byPrefix = await searchByNormPrefix(normalized, limit);
  if (!hasCjk(query)) {
    return byPrefix;
  }
  const byCn = await searchByCnContains(normalized, limit);
  const seen = new Set(byPrefix.map((word) => word.norm));
  return [...byPrefix, ...byCn.filter((word) => !seen.has(word.norm))].slice(0, limit);
}

/** 软删除一个词条 */
export async function softDeleteWord(id: string): Promise<void> {
  try {
    await db.transaction('rw', db.words, db.syncMeta, async () => {
      const existing = await db.words.get(id);
      if (!existing) {
        return;
      }
      const stamp = now();
      await db.words.put({ ...existing, deletedAt: stamp, updatedAt: stamp });
      await markDirty(ENTITY, 1);
    });
  } catch (error) {
    throw toDbError(error);
  }
}
