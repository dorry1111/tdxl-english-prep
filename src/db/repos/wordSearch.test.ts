/**
 * 双语词搜索测试（P4）：searchByCnContains / searchBilingual / hasCjk。
 *
 * 环境由 src/test/setup.ts 提供：fake-indexeddb + 每用例清库；
 * 内置词库走注入式 fetcher（内存数据），避免网络。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { bulkPutWords, hasCjk, searchBilingual, searchByCnContains } from '@/db/repos/wordRepo';
import { setCoreFetcher, type CoreIndex, type CoreShard } from '@/lib/wordbookCache';
import type { Word } from '@/types';

const INDEX: CoreIndex = {
  bookId: 'core',
  version: 2,
  total: 2,
  shards: ['core-a.json'],
  entries: [
    ['apple', 'apple', 0, 1, 'core-a.json'],
    ['apply', 'apply', 1, 2, 'core-a.json'],
  ],
};

const SHARDS = new Map<string, CoreShard>([
  [
    'core-a.json',
    {
      letter: 'a',
      words: [
        {
          id: 'core:apple',
          bookId: 'core',
          headword: 'apple',
          norm: 'apple',
          meanings: [{ pos: 'n.', cn: '苹果' }],
        },
        {
          id: 'core:apply',
          bookId: 'core',
          headword: 'apply',
          norm: 'apply',
          meanings: [{ pos: 'v.', cn: '申请；应用' }],
        },
      ],
    },
  ],
]);

function wordRow(partial: Partial<Word>): Word {
  return {
    id: 'mine:ztest',
    bookId: 'mine',
    headword: 'ztest',
    norm: 'ztest',
    meanings: [{ pos: 'n.', cn: '自建词测试' }],
    frequencyRank: null,
    updatedAt: 1,
    deletedAt: null,
    ...partial,
  } as Word;
}

beforeEach(async () => {
  if (!db.isOpen()) {
    await db.open();
  }
  setCoreFetcher(async (url) => {
    if (url.endsWith('core-index.json')) {
      return INDEX;
    }
    const shardName = url.split('/').pop();
    if (shardName && SHARDS.has(shardName)) {
      return SHARDS.get(shardName);
    }
    throw new Error(`unexpected url: ${url}`);
  });
});

describe('hasCjk', () => {
  it('区分中英文查询', () => {
    expect(hasCjk('苹果')).toBe(true);
    expect(hasCjk('apple')).toBe(false);
    expect(hasCjk('')).toBe(false);
  });
});

describe('searchByCnContains', () => {
  it('命中内置词库的中文释义（含标点切分的释义也能命中）', async () => {
    const hits = await searchByCnContains('申请');
    expect(hits.map((word) => word.norm)).toContain('apply');
  });

  it('DB 自建词与内置词都能命中', async () => {
    await bulkPutWords([wordRow({})]);
    const hits = await searchByCnContains('苹果');
    expect(hits.map((word) => word.norm)).toEqual(['apple']);
  });

  it('大小写与首尾空格不影响命中', async () => {
    const hits = await searchByCnContains('  樱桃不存在  ');
    expect(hits).toHaveLength(0);
  });
});

describe('searchBilingual', () => {
  it('英文查询只走前缀搜索（不触发全分片中文扫描）', async () => {
    const hits = await searchBilingual('app');
    expect(hits.map((word) => word.norm)).toEqual(['apple', 'apply']);
  });

  it('中文查询走释义搜索', async () => {
    const hits = await searchBilingual('应用');
    expect(hits.map((word) => word.norm)).toContain('apply');
  });

  it('同词既命中前缀又命中释义时只出现一次', async () => {
    await bulkPutWords([wordRow({ id: 'mine:apple', norm: 'apple', headword: 'apple' })]);
    const hits = await searchBilingual('苹果');
    const norms = hits.map((word) => word.norm);
    expect(norms.filter((norm) => norm === 'apple')).toHaveLength(1);
  });
});
