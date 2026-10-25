/**
 * 数据层冒烟测试（基础设施测试，不是业务逻辑测试）。
 *
 * 覆盖 T05 的四条验收项中可在 Node 环境验证的部分：
 * 1. 17 张表与 schema 定义一致；
 * 2. 自检链路（开库 → 写入 → 读回 → 删除）可跑通；
 * 3. `getDueWords` 按 dueAt 升序返回，且写操作后对应分片被标脏；
 * 4. `logRepo.prune()` 能按天数裁剪旧流水。
 *
 * 性能类验收（1 万条写入 < 1500ms）在真机/真实浏览器上测更有意义，
 * 单元测试环境下的耗时受 fake-indexeddb 影响，不作为门禁。
 */
import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, TABLE } from '@/constants';
import { db, getSyncMeta } from '@/db';
import { bulkUpsert, getDueWords, wordStateEntityOf } from '@/db/repos/stateRepo';
import { appendMany, prune } from '@/db/repos/logRepo';
import { runDbSelfTest } from '@/db/selfTest';
import { ensureSeeded } from '@/db/seed';
import { stateKeyOfNorm } from '@/lib/hash';
import { now } from '@/lib/time';
import type { ReviewLog, WordState } from '@/types';

function makeState(norm: string, dueAt: number, level = 1): WordState {
  const stamp = now();
  return {
    stateKey: stateKeyOfNorm(norm),
    wordId: `core:${norm}`,
    bookId: 'core',
    level,
    dueAt,
    lastRating: null,
    lastReviewAt: null,
    firstLearnedAt: stamp,
    reviewCount: 0,
    correctCount: 0,
    wrongCount: 0,
    lapseCount: 0,
    retryCountToday: 0,
    retryDay: '2026-10-24',
    unstable: false,
    isStarred: false,
    masteredAt: null,
    updatedAt: stamp,
    deletedAt: null,
  };
}

function makeLog(id: string, answeredAt: number): ReviewLog {
  return {
    id,
    wordId: 'core:alpha',
    stateKey: stateKeyOfNorm('alpha'),
    sessionId: 'sess_test',
    rating: 3,
    prevLevel: 0,
    newLevel: 1,
    prevDueAt: answeredAt,
    newDueAt: answeredAt,
    answeredAt,
    durationMs: 1200,
    isRetry: false,
    deviceId: 'dev_test',
  };
}

describe('Dexie schema', () => {
  it('21 张表全部创建，表名与 constants/storage 一致（v2 新增 wordNotes / wordHighlights，v3 新增 textHighlights，v4 新增 llmCache）', async () => {
    if (!db.isOpen()) {
      await db.open();
    }
    const tableNames = db.tables.map((table) => table.name).sort();
    const expected = Object.values(TABLE).sort();
    expect(tableNames).toEqual(expected);
    expect(expected).toHaveLength(21);
    expect(tableNames).toContain('wordNotes');
    expect(tableNames).toContain('wordHighlights');
    expect(tableNames).toContain('textHighlights');
    expect(tableNames).toContain('llmCache');
    expect(SCHEMA_VERSION).toBe(4);
  });

  it('wordNotes / wordHighlights 主键是 id，且带 [stateKey+kind] / [stateKey+scope] 复合索引', async () => {
    if (!db.isOpen()) {
      await db.open();
    }
    const notes = db.table(TABLE.wordNotes);
    const highlights = db.table(TABLE.wordHighlights);
    expect(notes.schema.primKey.keyPath).toBe('id');
    expect(highlights.schema.primKey.keyPath).toBe('id');
    const noteIndexNames = notes.schema.indexes.map((index) => index.name);
    expect(noteIndexNames).toContain('[stateKey+kind]');
    const hlIndexNames = highlights.schema.indexes.map((index) => index.name);
    expect(hlIndexNames).toContain('[stateKey+scope]');
  });

  it('wordStates 主键是 stateKey（不是 wordId）', async () => {
    if (!db.isOpen()) {
      await db.open();
    }
    const table = db.table(TABLE.wordStates);
    expect(table.schema.primKey.keyPath).toBe('stateKey');
  });
});

describe('数据层自检', () => {
  it('开库 → 写入 → 读回 → 删除 全链路通过', async () => {
    const result = await runDbSelfTest();
    expect(result.ok).toBe(true);
    expect(result.steps).toHaveLength(5);
  });
});

describe('seed 初始化', () => {
  it('首次初始化写入默认设置与两个内置词库，重复调用不重复写入', async () => {
    const first = await ensureSeeded();
    expect(first.settingsCreated).toBe(true);
    expect(first.builtinBookCreated).toBe(true);
    expect(first.notebookBookCreated).toBe(true);

    const second = await ensureSeeded();
    expect(second.settingsCreated).toBe(false);
    expect(second.builtinBookCreated).toBe(false);
    expect(second.notebookBookCreated).toBe(false);

    expect(await db.books.count()).toBe(2);
    expect(await db.settings.count()).toBe(1);
  });
});

describe('stateRepo', () => {
  it('bulkUpsert 后 getDueWords 按 dueAt 升序返回，并标记对应分片为脏', async () => {
    const base = now();
    const states = [
      makeState('alpha', base + 3000),
      makeState('bravo', base + 1000),
      makeState('charlie', base + 2000),
    ];
    await bulkUpsert(states);

    const due = await getDueWords(base + 5000, 10);
    expect(due.map((state) => state.stateKey)).toEqual([
      stateKeyOfNorm('bravo'),
      stateKeyOfNorm('charlie'),
      stateKeyOfNorm('alpha'),
    ]);

    // 每条记录都会落到某个分片，至少一个分片被标脏
    const shardNames = new Set(states.map((state) => wordStateEntityOf(state.stateKey)));
    const metas = await Promise.all([...shardNames].map((entity) => getSyncMeta(entity)));
    expect(metas.every((meta) => meta !== undefined && meta.dirtyAt !== null)).toBe(true);
    expect(metas.reduce((sum, meta) => sum + (meta?.pendingCount ?? 0), 0)).toBe(3);
  });

  it('firstLearnedAt 为空的记录不会被当成到期复习词', async () => {
    const base = now();
    const never = { ...makeState('delta', base), firstLearnedAt: null };
    await bulkUpsert([never]);
    expect(await getDueWords(base + 1000, 10)).toEqual([]);
  });
});

describe('logRepo.prune', () => {
  it('裁掉 90 天前的流水', async () => {
    const base = now();
    const day = 24 * 60 * 60 * 1000;
    await appendMany([
      makeLog('log_old_1', base - 100 * day),
      makeLog('log_old_2', base - 95 * day),
      makeLog('log_new_1', base - 10 * day),
      makeLog('log_new_2', base - 1 * day),
    ]);
    expect(await db.reviewLogs.count()).toBe(4);

    const result = await prune(base);
    expect(result.deletedByAge).toBe(2);
    expect(await db.reviewLogs.count()).toBe(2);
  });
});
