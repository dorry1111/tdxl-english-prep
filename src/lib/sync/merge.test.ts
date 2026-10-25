/**
 * 合并器纯函数单测（≥8 例，覆盖任务书验收项）：
 * - LWW 新者胜 / 相同时间戳本地胜；
 * - 墓碑不被旧数据复活（双向）；
 * - 双端各改一个 wordState，合并后两条都在；
 * - reviewLogs 按 id 去重并集；
 * - Settings 整条 LWW 且 deviceId / lastSyncAt 永不被覆盖；
 * - Settings 新字段（dailyStudyQuota / newWordLimitMode='quota'）随整条 LWW 生效。
 */
import { describe, expect, it } from 'vitest';

import { stateKeyOfNorm } from '@/lib/hash';
import type { NotebookEntry, ReviewLog, Settings, WordState } from '@/types';

import { lwwById, mergeAppendOnly, mergeRecords, mergeSettings, pickWinner } from './merge';

function makeState(norm: string, updatedAt: number, overrides?: Partial<WordState>): WordState {
  return {
    stateKey: stateKeyOfNorm(norm),
    wordId: `core:${norm}`,
    bookId: 'core',
    level: 1,
    dueAt: updatedAt + 86_400_000,
    lastRating: 3,
    lastReviewAt: updatedAt,
    firstLearnedAt: updatedAt,
    reviewCount: 1,
    correctCount: 1,
    wrongCount: 0,
    lapseCount: 0,
    retryCountToday: 0,
    retryDay: '2026-10-26',
    unstable: false,
    isStarred: false,
    masteredAt: null,
    updatedAt,
    deletedAt: null,
    ...overrides,
  };
}

function makeSettings(updatedAt: number, overrides?: Partial<Settings>): Settings {
  return {
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
    syncEnabled: true,
    webdavUrl: 'https://nas.example/tdxl-sync/',
    webdavUser: 'dorry',
    useProxy: false,
    proxyUrl: '',
    deviceId: 'dev_local',
    lastSyncAt: 1_000,
    lastExportAt: null,
    schemaVersion: 1,
    updatedAt,
    deletedAt: null,
    ...overrides,
  };
}

function makeLog(id: string, updatedAt: number): ReviewLog {
  return {
    id,
    wordId: 'core:alpha',
    stateKey: stateKeyOfNorm('alpha'),
    sessionId: 'sess_1',
    rating: 3,
    prevLevel: 0,
    newLevel: 1,
    prevDueAt: updatedAt,
    newDueAt: updatedAt + 60_000,
    answeredAt: updatedAt,
    durationMs: 1_200,
    isRetry: false,
    deviceId: 'dev_remote',
  };
}

describe('pickWinner', () => {
  it('updatedAt 大者胜出', () => {
    const oldRow = makeState('alpha', 100);
    const newRow = makeState('alpha', 200, { level: 5 });
    expect(pickWinner(oldRow, newRow)).toBe(newRow);
    expect(pickWinner(newRow, oldRow)).toBe(newRow);
  });

  it('updatedAt 相同时本地胜出（C3，避免抖动）', () => {
    const local = makeState('alpha', 100);
    const remote = makeState('alpha', 100, { level: 9 });
    expect(pickWinner(local, remote)).toBe(local);
  });
});

describe('mergeRecords', () => {
  it('双端各改一个 wordState：互不覆盖，合并后两条都在', () => {
    const localA = makeState('alpha', 300, { level: 4 }); // 本地改了 alpha
    const localB = makeState('beta', 100);
    const remoteA = makeState('alpha', 100);
    const remoteB = makeState('beta', 400, { level: 6 }); // 远端改了 beta

    const result = mergeRecords([localA, localB], [remoteA, remoteB], (s) => s.stateKey);
    const keys = result.merged.map((s) => s.stateKey).sort();
    expect(keys).toEqual([stateKeyOfNorm('alpha'), stateKeyOfNorm('beta')].sort());
    expect(result.merged.find((s) => s.stateKey === stateKeyOfNorm('alpha'))?.level).toBe(4);
    expect(result.merged.find((s) => s.stateKey === stateKeyOfNorm('beta'))?.level).toBe(6);
    expect(result.conflicts).toBe(2);
    expect(result.toApply.map((s) => s.stateKey)).toEqual([stateKeyOfNorm('beta')]);
  });

  it('本地墓碑（较新）不被远端旧活记录复活（C4）', () => {
    const tombstone = makeState('alpha', 500, { deletedAt: 500 });
    const remoteAlive = makeState('alpha', 100);
    const result = mergeRecords([tombstone], [remoteAlive], (s) => s.stateKey);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.deletedAt).toBe(500);
    expect(result.toApply).toHaveLength(0);
  });

  it('远端墓碑（较新）胜出：本地旧活记录被正确删除', () => {
    const localAlive = makeState('alpha', 100);
    const remoteTombstone = makeState('alpha', 600, { deletedAt: 600 });
    const result = mergeRecords([localAlive], [remoteTombstone], (s) => s.stateKey);
    expect(result.merged[0]?.deletedAt).toBe(600);
    expect(result.toApply).toHaveLength(1);
  });

  it('删除之后再次真实修改（远端活记录比墓碑新）允许复活', () => {
    const localTombstone = makeState('alpha', 100, { deletedAt: 100 });
    const remoteReborn = makeState('alpha', 900, { level: 2 });
    const result = mergeRecords([localTombstone], [remoteReborn], (s) => s.stateKey);
    expect(result.merged[0]?.deletedAt).toBeNull();
    expect(result.merged[0]?.level).toBe(2);
  });

  it('远端独有记录（含墓碑）直接并入', () => {
    const remoteNew = makeState('gamma', 700);
    const remoteTomb = makeState('delta', 800, { deletedAt: 800 });
    const result = mergeRecords([], [remoteNew, remoteTomb], (s) => s.stateKey);
    expect(result.merged).toHaveLength(2);
    expect(result.toApply).toHaveLength(2);
    expect(result.conflicts).toBe(0);
  });

  it('空输入返回空结果', () => {
    const result = mergeRecords([], [], (s: WordState) => s.stateKey);
    expect(result.merged).toEqual([]);
    expect(result.toApply).toEqual([]);
    expect(result.conflicts).toBe(0);
  });
});

describe('lwwById', () => {
  it('按 id 合并：新者胜', () => {
    const local = { id: 'x', updatedAt: 1, deletedAt: null, value: 'a' };
    const remote = { id: 'x', updatedAt: 2, deletedAt: null, value: 'b' };
    const result = lwwById([local], [remote]);
    expect(result.merged[0]?.updatedAt).toBe(2);
    expect(result.conflicts).toBe(1);
  });
});

describe('mergeAppendOnly', () => {
  it('reviewLogs 按 id 取去重并集', () => {
    const localLogs = [makeLog('log_1', 100), makeLog('log_2', 200)];
    const remoteLogs = [makeLog('log_2', 200), makeLog('log_3', 300)];
    const result = mergeAppendOnly(localLogs, remoteLogs);
    expect(result.merged.map((log) => log.id)).toEqual(['log_1', 'log_2', 'log_3']);
    expect(result.toApply.map((log) => log.id)).toEqual(['log_3']);
    expect(result.conflicts).toBe(0);
  });

  it('重复 id 只保留一份，不重复计数', () => {
    const log = makeLog('log_1', 100);
    const result = mergeAppendOnly([log, log], [log, log]);
    expect(result.merged).toHaveLength(1);
    expect(result.toApply).toHaveLength(0);
  });
});

describe('mergeSettings', () => {
  it('远端较新：整条采用远端，但 deviceId / lastSyncAt 保留本地（C6）', () => {
    const local = makeSettings(100);
    const remote = makeSettings(500, {
      deviceId: 'dev_remote',
      lastSyncAt: 9_999,
      newWordLimit: 30,
    });
    const result = mergeSettings(local, remote);
    expect(result.changed).toBe(true);
    expect(result.merged.newWordLimit).toBe(30);
    expect(result.merged.deviceId).toBe('dev_local');
    expect(result.merged.lastSyncAt).toBe(1_000);
  });

  it('本地较新：原样返回本地，不写回', () => {
    const local = makeSettings(500);
    const remote = makeSettings(100, { newWordLimit: 30 });
    const result = mergeSettings(local, remote);
    expect(result.changed).toBe(false);
    expect(result.merged).toBe(local);
  });

  it('updatedAt 相同：本地胜出（C3）', () => {
    const local = makeSettings(100);
    const remote = makeSettings(100, { theme: 'dark' });
    const result = mergeSettings(local, remote);
    expect(result.changed).toBe(false);
    expect(result.merged.theme).toBe('auto');
  });

  it('远端为 null：直接返回本地', () => {
    const local = makeSettings(100);
    const result = mergeSettings(local, null);
    expect(result.changed).toBe(false);
    expect(result.merged).toBe(local);
  });

  it('远端较新且带 quota 字段：dailyStudyQuota / newWordLimitMode 随整条 LWW 生效（C6 字段除外）', () => {
    // 每日学习量批次新增字段：Settings 整条 LWW，新字段无需字段级白名单即随远端胜出生效
    const local = makeSettings(100, { newWordLimitMode: 'manual', dailyStudyQuota: 30 });
    const remote = makeSettings(500, {
      newWordLimitMode: 'quota',
      dailyStudyQuota: 120,
      deviceId: 'dev_remote',
      lastSyncAt: 9_999,
    });
    const result = mergeSettings(local, remote);
    expect(result.changed).toBe(true);
    expect(result.merged.newWordLimitMode).toBe('quota');
    expect(result.merged.dailyStudyQuota).toBe(120);
    // 本机字段仍不被覆盖（C6）
    expect(result.merged.deviceId).toBe('dev_local');
    expect(result.merged.lastSyncAt).toBe(1_000);
  });

  it('本地较新：远端旧 quota 配置不覆盖本地', () => {
    const local = makeSettings(500, { newWordLimitMode: 'quota', dailyStudyQuota: 80 });
    const remote = makeSettings(100, { newWordLimitMode: 'manual', dailyStudyQuota: 15 });
    const result = mergeSettings(local, remote);
    expect(result.changed).toBe(false);
    expect(result.merged).toBe(local);
    expect(result.merged.dailyStudyQuota).toBe(80);
    expect(result.merged.newWordLimitMode).toBe('quota');
  });

  it('远端较新但缺 dailyStudyQuota（旧版本客户端）：字段为 undefined，读取侧回退默认值', () => {
    // 旧客户端没有该可选字段；整条 LWW 后merged 缺省，resolveDailyNewLimit / PlanPage
    // 走 `?? DEFAULT_DAILY_STUDY_QUOTA` 兜底，不产生 NaN 或崩溃
    const local = makeSettings(100, { dailyStudyQuota: 60 });
    const remote = makeSettings(500, { dailyStudyQuota: undefined });
    const result = mergeSettings(local, remote);
    expect(result.changed).toBe(true);
    expect(result.merged.dailyStudyQuota).toBeUndefined();
  });
});

describe('notebook 类型可参与 lwwById', () => {
  it('生词本条目按 id 新者胜', () => {
    const local: NotebookEntry = {
      id: 'note_1',
      wordId: 'core:alpha',
      headword: 'alpha',
      source: 'manual',
      sourceRef: null,
      note: '旧笔记',
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    };
    const remote: NotebookEntry = { ...local, note: '新笔记', updatedAt: 50 };
    const result = lwwById([local], [remote]);
    expect(result.merged[0]?.note).toBe('新笔记');
  });
});
