/**
 * QA 二层验证：Dexie v1 → v2 迁移实测（笔记与高亮批次必查项 1）。
 *
 * 用 fake-indexeddb 先构造一个「只声明 version(1) 的旧库」并写入旧数据，
 * 关闭后再用 TdxlDB（version 1+2）打开，验证：
 * - 升级路径可走通（不抛异常、19 张表齐全）；
 * - 旧数据完好（wordStates / words / reviewLogs / settings 逐字段比对）；
 * - 两张新表（wordNotes / wordHighlights）立即可读写，
 *   且 [stateKey+kind] / [stateKey+scope] 复合索引可用。
 */
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';

import { TABLE } from '@/constants';
import { SCHEMA_V1, TdxlDB } from './schema';
import { stateKeyOfNorm } from '@/lib/hash';
import { now } from '@/lib/time';
import type { Settings, Word, WordState } from '@/types';

const DB_NAME = 'qa-migration-v1-to-v2';

/** 与 v1 结构一致的旧词条 / 旧学习状态（updatedAt 等字段沿用现类型） */
function makeLegacyWord(norm: string): Word {
  const stamp = now();
  return {
    id: `core:${norm}`,
    bookId: 'core',
    headword: norm,
    norm,
    meanings: [{ pos: 'n.', cn: `${norm} 的旧释义` }],
    frequencyRank: 1,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  };
}

function makeLegacyState(norm: string): WordState {
  const stamp = now();
  return {
    stateKey: stateKeyOfNorm(norm),
    wordId: `core:${norm}`,
    bookId: 'core',
    level: 2,
    dueAt: stamp + 60_000,
    lastRating: 3,
    lastReviewAt: stamp,
    firstLearnedAt: stamp,
    reviewCount: 3,
    correctCount: 2,
    wrongCount: 1,
    lapseCount: 1,
    retryCountToday: 0,
    retryDay: '2026-01-01',
    unstable: false,
    isStarred: false,
    masteredAt: null,
    updatedAt: stamp,
    deletedAt: null,
  };
}

const LEGACY_SETTINGS: Settings = {
  id: 'global',
  examDate: '2027-05-16',
  activeBookIds: ['core'],
  bookMode: 'single',
  newWordLimit: 20,
  newWordLimitMode: 'auto',
  retryGapMin: 3,
  retryGapMax: 5,
  maxRetry: 5,
  dayStartHour: 4,
  sessionBatchSize: 200,
  ttsEnabled: true,
  ttsAutoPlay: false,
  ttsRate: 1,
  ttsAccent: 'us',
  theme: 'auto',
  fontScale: 1,
  syncEnabled: false,
  webdavUrl: '',
  webdavUser: '',
  useProxy: false,
  proxyUrl: '',
  deviceId: 'legacy-device',
  lastSyncAt: null,
  lastExportAt: null,
  schemaVersion: 1,
  updatedAt: 1_000,
  deletedAt: null,
};

/** 打开一个只声明 version(1) 的旧库并写入旧数据（模拟老版本 App 留下的库） */
async function createLegacyV1Database(): Promise<void> {
  const legacy = new Dexie(DB_NAME);
  legacy.version(1).stores(SCHEMA_V1);
  await legacy.open();
  await legacy.transaction(
    'rw',
    [legacy.table(TABLE.words), legacy.table(TABLE.wordStates), legacy.table(TABLE.settings)],
    async () => {
      await legacy.table(TABLE.words).bulkPut([makeLegacyWord('alpha'), makeLegacyWord('bravo')]);
      await legacy.table(TABLE.wordStates).bulkPut([makeLegacyState('alpha')]);
      await legacy.table(TABLE.settings).put(LEGACY_SETTINGS);
    },
  );
  legacy.close();
}

describe('Dexie v1 → v2 → v3 → v4 迁移（SCHEMA_VERSION=4）', () => {
  it('旧库（仅 version(1)）打开后升级到当前版本：21 张表齐全、旧数据完好、新表可用', async () => {
    await createLegacyV1Database();

    // 用与生产完全相同的子类打开同一份数据库文件（触发 v1 → v2 升级）
    const upgraded = new TdxlDB(DB_NAME);
    try {
      await upgraded.open();

      // ① 表数量与名字：v1 的 17 张 + v2 的 wordNotes/wordHighlights + v3 的 textHighlights + v4 的 llmCache
      const tableNames = upgraded.tables.map((table) => table.name).sort();
      expect(tableNames).toHaveLength(21);
      expect(tableNames).toContain('wordNotes');
      expect(tableNames).toContain('wordHighlights');
      expect(tableNames).toContain('textHighlights');
      expect(tableNames).toContain('llmCache');

      // ② 旧数据完好：逐字段比对
      const alpha = await upgraded.table(TABLE.words).get('core:alpha');
      expect(alpha?.norm).toBe('alpha');
      expect(alpha?.meanings[0]?.cn).toBe('alpha 的旧释义');
      expect(await upgraded.table(TABLE.words).count()).toBe(2);

      const state = await upgraded.table(TABLE.wordStates).get(stateKeyOfNorm('alpha'));
      expect(state?.level).toBe(2);
      expect(state?.reviewCount).toBe(3);
      expect(state?.lapseCount).toBe(1);

      const settings = await upgraded.table(TABLE.settings).get('global');
      expect(settings?.deviceId).toBe('legacy-device');
      expect(settings?.schemaVersion).toBe(1);

      // ③ 新表立即可写可读（走复合索引查询验证索引真的建出来了）
      const stamp = now();
      await upgraded.table(TABLE.wordNotes).put({
        id: 'wnote_mig1',
        stateKey: stateKeyOfNorm('alpha'),
        wordId: 'core:alpha',
        kind: 'chunk',
        content: '迁移后写入的串记',
        zh: null,
        createdAt: stamp,
        updatedAt: stamp,
        deletedAt: null,
      });
      await upgraded.table(TABLE.wordHighlights).put({
        id: 'whl_mig1',
        stateKey: stateKeyOfNorm('alpha'),
        wordId: 'core:alpha',
        scope: 'meaning',
        exampleIndex: null,
        text: '旧释义',
        color: 2,
        createdAt: stamp,
        updatedAt: stamp,
        deletedAt: null,
      });

      const noteByIndex = await upgraded
        .table(TABLE.wordNotes)
        .where('[stateKey+kind]')
        .equals([stateKeyOfNorm('alpha'), 'chunk'])
        .first();
      expect(noteByIndex?.content).toBe('迁移后写入的串记');

      const highlightByIndex = await upgraded
        .table(TABLE.wordHighlights)
        .where('[stateKey+scope]')
        .equals([stateKeyOfNorm('alpha'), 'meaning'])
        .toArray();
      expect(highlightByIndex).toHaveLength(1);
      expect(highlightByIndex[0]?.text).toBe('旧释义');
    } finally {
      upgraded.close();
    }
  });
});
