/**
 * 单词归一化 —— `norm` 规则与 `stateKey` 的唯一来源（ARCHITECTURE 3.2.1）。
 *
 * ⚠️ 这里的规则一旦上线就必须冻结：`stateKey = fnv1a(norm)`，
 * 规则变了会导致所有学习状态「漂移」（同一单词算不出原来的 stateKey）。
 * 若必须改，必须同时提供迁移脚本，把老 stateKey 的数据搬到新 stateKey 下。
 *
 * 本文件在 T08 会继续扩充「内置词库索引 + 字母分片的内存缓存」；
 * 批次 1 只保留归一化与 ID 拼装这两个最基础、且被多处依赖的函数。
 */
import { stateKeyOfNorm } from './hash';
import { traceAsync } from './perf';
import type { Word, WordMemo } from '../types/word';

/**
 * 归一化单词：去重音符号 → 小写 → 去首尾空白 → 多空格合一。
 *
 * @example
 * normalizeWord(' Deteriorate ') === 'deteriorate'
 * normalizeWord('a  lot') === 'a lot'
 * normalizeWord('café') === 'cafe'
 */
export function normalizeWord(raw: string): string {
  return raw
    .normalize('NFD') // 分解重音符号
    .replace(/[\u0300-\u036f]/g, '') // 去掉组合用变音符号
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * 词条 ID 规则：`${bookId}:${norm}`（ARCHITECTURE 7.6）。
 * 天然去重：同一词库里的同一个单词只会有一条词条。
 */
export function wordIdOf(bookId: string, norm: string): string {
  return `${bookId}:${norm}`;
}

/**
 * 由「原始单词」直接算出学习身份键。
 * 调用方如果已经有 norm，请直接用 `stateKeyOfNorm(norm)` 避免重复归一化。
 */
export function stateKeyOfWord(raw: string): string {
  return stateKeyOfNorm(normalizeWord(raw));
}

// ============================================================================
// 内置词库索引 + 字母分片的内存缓存（T08）
//
// - 索引（core-index.json）启动后加载一次，常驻内存；候选排序与前缀搜索只读索引；
// - 分片按需 fetch，进内存缓存且【不淘汰】（26 片全量约 6~8MB 堆，可接受；
//   分片已被 SW 预缓存，断网可取）；
// - fetch 实现可注入（测试用内存数据替换网络）。
// ============================================================================

/** 索引行（紧凑数组）：[norm, headword, sourceOrder, frequencyRank|null, shard 文件名] */
export type CoreIndexRow = readonly [string, string, number, number | null, string];

/** core-index.json 结构（v2，scripts/build_word_shards.py 产出） */
export interface CoreIndex {
  bookId: string;
  version: number;
  total: number;
  /** 分片文件名清单，运行时只信这个清单，不硬编码 26 片 */
  shards: string[];
  entries: CoreIndexRow[];
}

/** 字母分片结构 */
export interface CoreShard {
  letter: string;
  words: unknown[];
}

/** memo 分片结构（public/data/words/memo-<letter>.json，scripts/merge_memos.py 产出） */
export interface MemoShard {
  letter: string;
  version: number;
  /** key = norm，value = 该词的四类记忆内容（全部可选） */
  memos: Record<string, WordMemo>;
}

/** 候选词选取结果（W2/W3：必须暴露词频序是否可用，禁止用字母序冒充词频序） */
export interface CoreCandidates {
  items: CoreIndexRow[];
  frequencyOrderAvailable: boolean;
}

// ---------- 注入式 fetch ----------

type CoreFetcher = (url: string) => Promise<unknown>;

let coreFetcher: CoreFetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`加载词库数据失败 ${url}: ${response.status}`);
  }
  return response.json();
};

/** 注入自定义 fetcher（测试用）；传 undefined 恢复默认并清空缓存 */
export function setCoreFetcher(fetcher?: CoreFetcher): void {
  coreFetcher = fetcher ?? (async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`加载词库数据失败 ${url}: ${response.status}`);
    }
    return response.json();
  });
  indexCache = null;
  shardCache.clear();
  allCoreWordsPromise = null;
  memoCache.clear();
}

// ---------- 缓存（不淘汰） ----------

let indexCache: CoreIndex | null = null;
let indexLoading: Promise<CoreIndex> | null = null;
const shardCache = new Map<string, Promise<CoreShard>>();
/** memo 分片缓存（按首字母，同 core 分片策略：按需 fetch、不淘汰） */
const memoCache = new Map<string, Promise<MemoShard>>();

/**
 * 数据 URL 统一走 BASE_URL：桌面 tdxl:// 协议与 NAS 子路径部署都依赖它。
 * （曾硬编码 '/data/words/'，NAS 换子路径部署时词库全部 404。）
 */
const BASE = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;
const INDEX_URL = `${BASE}data/words/core-index.json`;
const SHARD_URL_PREFIX = `${BASE}data/words/`;
const MEMO_URL_PREFIX = `${BASE}data/words/memo-`;

/** 加载索引（单例；已加载直接返回） */
export function loadCoreIndex(): Promise<CoreIndex> {
  if (indexCache) {
    return Promise.resolve(indexCache);
  }
  // 打点：冷启动首次加载是 253KB 的 fetch + JSON.parse，是「第一次点单词慢」的嫌疑之一
  indexLoading ??= traceAsync('wordbook:core-index', () => coreFetcher(INDEX_URL))
    .then((data) => {
      const index = data as CoreIndex;
      if (!Array.isArray(index.entries) || !Array.isArray(index.shards)) {
        throw new Error('core-index.json 格式非法（缺少 entries/shards）');
      }
      indexCache = index;
      indexLoading = null;
      return index;
    })
    .catch((error) => {
      indexLoading = null;
      throw error;
    });
  return indexLoading;
}

/** 已缓存的索引（未加载返回 null，不触发网络） */
export function peekCoreIndex(): CoreIndex | null {
  return indexCache;
}

/** 取分片（带缓存；同一分片只 fetch 一次） */
export function getCoreShard(name: string): Promise<CoreShard> {
  const cached = shardCache.get(name);
  if (cached) {
    return cached;
  }
  // 打点：分片最大 153KB，冷启动首次取词会在这里等网络 + 解析
  const loading = traceAsync(`wordbook:shard:${name}`, () =>
    coreFetcher(`${SHARD_URL_PREFIX}${name}`),
  ).then((data) => {
    const shard = data as CoreShard;
    if (!Array.isArray(shard.words)) {
      throw new Error(`分片 ${name} 格式非法（缺少 words）`);
    }
    return shard;
  });
  shardCache.set(name, loading);
  return loading;
}

/** 已缓存的分片（不触发网络） */
export function peekCoreShard(name: string): Promise<CoreShard> | undefined {
  return shardCache.get(name);
}

// ---------- memo 分片（记忆内容：助记/词根/易混/考纲义项/词形） ----------

/**
 * 取 memo 分片（带缓存；同一首字母只 fetch 一次）。
 * 分片缺失时返回空 memos 而不是抛错——低频词没有 memo 数据是正常态。
 */
export function getMemoShard(letter: string): Promise<MemoShard> {
  const key = letter.toLowerCase();
  const cached = memoCache.get(key);
  if (cached) {
    return cached;
  }
  const loading = traceAsync(`wordbook:memo:${key}`, () =>
    coreFetcher(`${MEMO_URL_PREFIX}${key}.json`),
  )
    .then((data) => {
      const shard = data as MemoShard;
      if (!shard || typeof shard.memos !== 'object') {
        throw new Error(`memo 分片 ${key} 格式非法（缺少 memos）`);
      }
      return shard;
    })
    .catch(() => ({ letter: key, version: 0, memos: {} }) as MemoShard);
  memoCache.set(key, loading);
  return loading;
}

/** 已缓存的 memo 分片（不触发网络） */
export function peekMemoShard(letter: string): Promise<MemoShard> | undefined {
  return memoCache.get(letter.toLowerCase());
}

/** norm 的 memo 分片首字母（非 a-z 归一为 'misc'，合并脚本同规则） */
export function memoLetterOf(norm: string): string {
  const first = norm.trim().toLowerCase()[0] ?? '';
  return first >= 'a' && first <= 'z' ? first : 'misc';
}

/**
 * 取单词的 memo 内容（无则返回 null）。
 * 调用方应只在「答案态/详情页」使用——memo 可能含词义，禁止在作答面前加载。
 */
export async function getWordMemo(norm: string): Promise<WordMemo | null> {
  const shard = await getMemoShard(memoLetterOf(norm));
  return shard.memos[norm.toLowerCase()] ?? null;
}

/**
 * 预取一批 norm 所需的 memo 分片（背单词会话开始时调用）。
 * 只发去重后的分片请求；已缓存的分片零成本。
 */
export function prefetchMemos(norms: readonly string[]): Promise<MemoShard[]> {
  const letters = new Set(norms.map((norm) => memoLetterOf(norm)));
  return Promise.all([...letters].map((letter) => getMemoShard(letter)));
}

// ---------- 索引查询 ----------

/** 索引行 → 学习身份键（索引里没有 stateKey，按 3.2.1 现算） */
export function rowStateKey(row: CoreIndexRow): string {
  return stateKeyOfNorm(row[0]);
}

/**
 * 排序键（W1）：frequencyRank 优先；无词频的词排在全部有词频词之后（按 sourceOrder）。
 *
 * 【真实数据语义】frequencyRank（1 起的排名）与 sourceOrder（大纲原序下标）是
 * 两个不同量纲，不能用 `rank ?? sourceOrder` 直接混排——否则 20 个无词频词会凭
 * 靠前的 sourceOrder 浮到全部高频词之前。因此无词频统一加 UNRANKED_BASE 偏移。
 */
const UNRANKED_BASE = 1_000_000_000;
export function coreOrderKey(row: CoreIndexRow): number {
  return row[3] ?? UNRANKED_BASE + row[2];
}

/**
 * 新词候选：只读索引，跳过已学 norm。
 *
 * - 排序 = `frequencyRank ?? sourceOrder` 升序（同键并列时 sourceOrder 小者在前）；
 * - `frequencyOrderAvailable` = 索引中任一词有真实词频。
 *   【注意】内置大纲词库（ECDICT 词频已就位）该值为 true；
 *   全部无词频的数据源下才为 false，此时顺序 = 词库原序（sourceOrder）。
 */
export function getNewWordCandidates(
  learnedNorms: ReadonlySet<string>,
  limit: number,
): CoreCandidates {
  const index = indexCache;
  if (!index || limit <= 0) {
    return { items: [], frequencyOrderAvailable: false };
  }
  const items = index.entries
    .filter((row) => !learnedNorms.has(row[0]))
    .sort((left, right) => coreOrderKey(left) - coreOrderKey(right) || left[2] - right[2])
    .slice(0, limit);
  return {
    items,
    frequencyOrderAvailable: index.entries.some((row) => row[3] !== null),
  };
}

/** 索引前缀搜索（norm 已小写归一化，2 字符即出结果） */
export function searchCoreByNorm(prefix: string, limit = 20): CoreIndexRow[] {
  const index = indexCache;
  const normalized = normalizeWord(prefix);
  if (!index || normalized.length === 0) {
    return [];
  }
  const hits: CoreIndexRow[] = [];
  for (const row of index.entries) {
    if (row[0].startsWith(normalized)) {
      hits.push(row);
      if (hits.length >= limit) {
        break;
      }
    }
  }
  return hits;
}

/**
 * 按 wordId 取内置词条（三级查找的第 2/3 级：分片缓存 → fetch 分片）。
 * wordId 规则 `${bookId}:${norm}`；只处理 core: 前缀，其它返回 null。
 */
export async function getCoreWord(wordId: string): Promise<unknown | null> {
  const separator = wordId.indexOf(':');
  if (separator < 0 || wordId.slice(0, separator) !== 'core') {
    return null;
  }
  const norm = wordId.slice(separator + 1);
  const index = indexCache ?? (await loadCoreIndex());
  const row = index.entries.find((entry) => entry[0] === norm);
  if (!row) {
    return null;
  }
  const shard = await getCoreShard(row[4]);
  return shard.words.find((word) => (word as { norm?: string }).norm === norm) ?? null;
}

// ---------- 全量词水合（P4 中文释义搜索用） ----------

let allCoreWordsPromise: Promise<Word[]> | null = null;

/**
 * 全量内置词条（26 片全部水合，约 6~8MB 堆——wordbookCache 既有约定可接受）。
 * 单例 Promise：首次调用拉全部分片，之后进程内直读；setCoreFetcher 会重置。
 *
 * 【必须返回完整词条】（含 id / bookId）：搜索页拿到结果后要按 word.id 跳详情页。
 * 曾投影成 { norm, headword, meanings } 瘦身对象，导致中文释义搜索的命中词
 * id 为 undefined → /word/undefined → 「没有找到这个单词」。
 */
export function getAllCoreWords(): Promise<Word[]> {
  allCoreWordsPromise ??= (async () => {
    const index = await loadCoreIndex();
    const shards = await Promise.all(index.shards.map((name) => getCoreShard(name)));
    const out: Word[] = [];
    for (const shard of shards) {
      for (const raw of shard.words) {
        const word = raw as Word;
        if (typeof word.norm === 'string' && Array.isArray(word.meanings)) {
          out.push(word);
        }
      }
    }
    return out;
  })();
  return allCoreWordsPromise;
}
