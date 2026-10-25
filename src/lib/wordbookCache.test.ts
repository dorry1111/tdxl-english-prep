/**
 * T08 验收测试：内置词库索引加载 / 分片缓存 / 新词候选 / 前缀搜索。
 *
 * fetcher 全部注入内存数据，不触网。真实数据校验（5709 词 / v2 索引）
 * 由 scripts/build_word_shards.py 输出断言保证，这里测运行时行为。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  getCoreShard,
  getCoreWord,
  getNewWordCandidates,
  loadCoreIndex,
  peekCoreIndex,
  rowStateKey,
  searchCoreByNorm,
  setCoreFetcher,
  type CoreIndex,
  type CoreShard,
} from './wordbookCache';

function makeIndex(overrides?: Partial<CoreIndex>): CoreIndex {
  return {
    bookId: 'core',
    version: 2,
    total: 6,
    shards: ['core-a.json', 'core-b.json'],
    entries: [
      // [norm, headword, sourceOrder, frequencyRank|null, shard]
      ['apple', 'apple', 0, 3, 'core-a.json'],
      ['banana', 'banana', 1, 1, 'core-b.json'],
      ['cherry', 'cherry', 2, 2, 'core-a.json'],
      ['date', 'date', 3, null, 'core-b.json'],
      ['elder', 'elder', 4, null, 'core-a.json'],
      ['fig', 'fig', 5, null, 'core-b.json'],
    ],
    ...overrides,
  };
}

function makeShards(): Map<string, CoreShard> {
  return new Map([
    [
      'core-a.json',
      {
        letter: 'a',
        words: [
          { id: 'core:apple', bookId: 'core', headword: 'apple', norm: 'apple', meanings: [{ pos: 'n.', cn: '苹果' }] },
          { id: 'core:cherry', bookId: 'core', headword: 'cherry', norm: 'cherry', meanings: [{ pos: 'n.', cn: '樱桃' }] },
          { id: 'core:elder', bookId: 'core', headword: 'elder', norm: 'elder', meanings: [{ pos: 'n.', cn: '长者' }] },
        ],
      },
    ],
    [
      'core-b.json',
      {
        letter: 'b',
        words: [
          { id: 'core:banana', bookId: 'core', headword: 'banana', norm: 'banana', meanings: [{ pos: 'n.', cn: '香蕉' }] },
          { id: 'core:date', bookId: 'core', headword: 'date', norm: 'date', meanings: [{ pos: 'n.', cn: '日期' }] },
          { id: 'core:fig', bookId: 'core', headword: 'fig', norm: 'fig', meanings: [{ pos: 'n.', cn: '无花果' }] },
        ],
      },
    ],
  ]);
}

/** 注入内存数据并统计每个 URL 的 fetch 次数 */
function injectData(index: CoreIndex, shards: Map<string, CoreShard>) {
  const counts = new Map<string, number>();
  setCoreFetcher(async (url) => {
    counts.set(url, (counts.get(url) ?? 0) + 1);
    const shardName = url.split('/').pop();
    if (url.endsWith('core-index.json')) {
      return index;
    }
    if (shardName && shards.has(shardName)) {
      return shards.get(shardName);
    }
    throw new Error(`unexpected url: ${url}`);
  });
  return counts;
}

beforeEach(() => {
  // 恢复默认 fetcher 并清缓存，避免用例间污染
  setCoreFetcher(undefined);
});

describe('loadCoreIndex', () => {
  it('索引只加载一次（单例缓存）', async () => {
    const counts = injectData(makeIndex(), makeShards());
    await loadCoreIndex();
    await loadCoreIndex();
    await loadCoreIndex();
    expect(counts.get('/data/words/core-index.json')).toBe(1);
    expect(peekCoreIndex()?.total).toBe(6);
  });

  it('索引格式非法时抛错且可重试', async () => {
    setCoreFetcher(async () => ({ foo: 1 }));
    await expect(loadCoreIndex()).rejects.toThrow('core-index.json');
    const counts = injectData(makeIndex(), makeShards());
    await expect(loadCoreIndex()).resolves.toBeDefined();
    expect(counts.get('/data/words/core-index.json')).toBe(1);
  });
});

describe('getCoreShard（不淘汰缓存）', () => {
  it('同一分片只 fetch 一次，后续命中内存', async () => {
    const counts = injectData(makeIndex(), makeShards());
    await getCoreShard('core-a.json');
    await getCoreShard('core-a.json');
    await getCoreShard('core-a.json');
    expect(counts.get('/data/words/core-a.json')).toBe(1);
  });

  it('并发请求同一分片只发一次网络', async () => {
    const counts = injectData(makeIndex(), makeShards());
    await Promise.all([
      getCoreShard('core-a.json'),
      getCoreShard('core-a.json'),
      getCoreShard('core-b.json'),
      getCoreShard('core-a.json'),
    ]);
    expect(counts.get('/data/words/core-a.json')).toBe(1);
    expect(counts.get('/data/words/core-b.json')).toBe(1);
  });
});

describe('getCoreWord', () => {
  it('按索引定位分片并返回词条', async () => {
    injectData(makeIndex(), makeShards());
    await loadCoreIndex();
    const word = (await getCoreWord('core:cherry')) as { norm: string; headword: string };
    expect(word.norm).toBe('cherry');
    expect(word.headword).toBe('cherry');
  });

  it('非 core 前缀与未知 norm 返回 null', async () => {
    injectData(makeIndex(), makeShards());
    await loadCoreIndex();
    expect(await getCoreWord('user:apple')).toBeNull();
    expect(await getCoreWord('core:notexist')).toBeNull();
  });
});

describe('getNewWordCandidates（W1/W2/W3 排序口径）', () => {
  beforeEach(() => {
    injectData(makeIndex(), makeShards());
    return loadCoreIndex();
  });

  it('有词频 → 按 frequencyRank 升序，frequencyOrderAvailable=true', () => {
    const { items, frequencyOrderAvailable } = getNewWordCandidates(new Set(), 10);
    expect(frequencyOrderAvailable).toBe(true);
    // banana(1) → cherry(2) → apple(3) → 无词频组按 sourceOrder: date, elder, fig
    expect(items.map((row) => row[0])).toEqual(['banana', 'cherry', 'apple', 'date', 'elder', 'fig']);
  });

  it('跳过已学 norm', () => {
    const { items } = getNewWordCandidates(new Set(['banana', 'cherry']), 10);
    expect(items.map((row) => row[0])).toEqual(['apple', 'date', 'elder', 'fig']);
  });

  it('limit 截断生效', () => {
    const { items } = getNewWordCandidates(new Set(), 2);
    expect(items.map((row) => row[0])).toEqual(['banana', 'cherry']);
  });

  it('全部无词频 → 回退 sourceOrder（词库原序），frequencyOrderAvailable=false', () => {
    const noFreq = makeIndex();
    noFreq.entries = noFreq.entries.map(
      (row) => [row[0], row[1], row[2], null, row[4]] as const,
    );
    injectData(noFreq, makeShards());
    return loadCoreIndex().then(() => {
      const { items, frequencyOrderAvailable } = getNewWordCandidates(new Set(), 10);
      expect(frequencyOrderAvailable).toBe(false);
      expect(items.map((row) => row[0])).toEqual(['apple', 'banana', 'cherry', 'date', 'elder', 'fig']);
    });
  });

  it('【反例测试】改小某词 sourceOrder 后它必须排到无词频组更前面（证明读的是 sourceOrder 而非数组位置）', () => {
    const tampered = makeIndex();
    // fig 原 sourceOrder=5 排在无词频组最后；改成 0 后必须成为无词频组第一个
    tampered.entries = tampered.entries.map((row) =>
      row[0] === 'fig' ? (['fig', 'fig', 0, null, row[4]] as const) : row,
    );
    injectData(tampered, makeShards());
    return loadCoreIndex().then(() => {
      const { items } = getNewWordCandidates(new Set(), 10);
      const noFreqGroup = items.filter((row) => row[3] === null).map((row) => row[0]);
      expect(noFreqGroup[0]).toBe('fig');
      // 且整体位置：无词频组仍在有词频组之后，但组内 fig 跳到最前
      expect(items[3]?.[0]).toBe('fig');
    });
  });
});

describe('searchCoreByNorm', () => {
  beforeEach(() => {
    injectData(makeIndex(), makeShards());
    return loadCoreIndex();
  });

  it('前缀命中并受 limit 限制', () => {
    expect(searchCoreByNorm('a', 10).map((row) => row[0])).toEqual(['apple']);
    expect(searchCoreByNorm('', 10)).toEqual([]);
    expect(searchCoreByNorm('zzz', 10)).toEqual([]);
    expect(searchCoreByNorm('d', 10).map((row) => row[0])).toEqual(['date']);
  });

  it('大写入参自动归一化（normalizeWord）', () => {
    expect(searchCoreByNorm('APPLE', 10).map((row) => row[0])).toEqual(['apple']);
  });
});

describe('rowStateKey', () => {
  it('与 fnv1a(norm) 一致（学习状态按 norm 共享，WRD-11）', () => {
    const index = makeIndex();
    const key = rowStateKey(index.entries[0]!);
    expect(key).toBe(rowStateKey(['apple', 'other-headword', 99, null, 'core-z.json']));
    expect(key).not.toBe(rowStateKey(['banana', 'banana', 1, 1, 'core-b.json']));
  });
});
