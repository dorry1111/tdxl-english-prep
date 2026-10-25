/**
 * QA 二层验证（WebDAV 同步批次，per-device LWW）：独立复核工程师侧测试未覆盖的缺口。
 *
 * 必查项：
 * 1. 完整往返实测复核：本地造数据 → syncNow → 注入另一设备文件 → 再 syncNow →
 *    断言合并结果与 conflicts 计数；
 * 2. LWW 边界：updatedAt 完全相同（本地胜、不计数）；
 * 3. Settings 合并 C6 端到端：deviceId / lastSyncAt / lastExportAt 不被对端覆盖；
 * 4. 错误路径：单文件 PARSE 跳过其余实体继续；上传失败 dirtyAt 保留且 lastSyncAt 不更新；
 * 5. 安全：密码（getSecret 的值）不出现在任何 fetch URL、PUT 载荷、错误报告里；
 * 6. BUG-1 证据：笔记/高亮（wordNotes / wordHighlights）按批次说明应随 wordbook.json
 *    同步，但引擎序列化/解析/合并均未包含这两张表 —— 本文件以失败用例固定证据。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { dayjs } from '@/lib/dayjs';
import { stateKeyOfNorm } from '@/lib/hash';
import { appendMany } from '@/db/repos/logRepo';
import { ensureSettings, setSecret } from '@/db/repos/settingsRepo';
import { addExample, addHighlight, upsertNote } from '@/db/repos/noteRepo';
import { bulkUpsert } from '@/db/repos/stateRepo';
import { buildDefaultSettings } from '@/db/seed';
import { db, listSyncMeta } from '@/db';
import type { FetchLike } from '@/lib/sync/webdav';
import type { ReviewLog, Settings, WordHighlight, WordNote, WordState } from '@/types';

import { syncNow } from './engine';
import { PER_DEVICE_FILES } from './remoteFiles';

const NOW_TS = 1_792_000_000_000;
const MONTH = dayjs(NOW_TS).format('YYYY-MM');
const PASSWORD = 'S3cr3t-密码PASS';

interface StubOptions {
  authFail?: boolean;
  failPutFor?: (name: string) => boolean;
}

/** 内存 WebDAV：记录全部请求 URL + PUT 载荷（安全审计用） */
function createWebdavStub(options: StubOptions = {}) {
  const files = new Map<string, string>();
  const urls: string[] = [];
  const bodies: Array<{ name: string; body: string }> = [];

  const fetchImpl: FetchLike = async (url, init) => {
    const method = init.method ?? 'GET';
    const urlString = String(url);
    urls.push(urlString);
    const name =
      decodeURIComponent(urlString.split('/').filter((part) => part !== '').pop() ?? '') || '';
    if (options.authFail) {
      return new Response(null, { status: 401 });
    }
    if (method === 'PROPFIND') {
      const items = [...files.keys()]
        .map(
          (fileName) =>
            `<D:response><D:href>/dav/${fileName}</D:href><D:propstat><D:prop></D:prop>` +
            '<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>',
        )
        .join('');
      return new Response(
        `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${items}</D:multistatus>`,
        { status: 207 },
      );
    }
    if (method === 'GET') {
      const body = files.get(name);
      if (body === undefined) {
        return new Response(null, { status: 404 });
      }
      return new Response(body, { status: 200 });
    }
    if (method === 'PUT') {
      if (options.failPutFor?.(name)) {
        return new Response(null, { status: 500 });
      }
      const body = typeof init.body === 'string' ? init.body : '';
      files.set(name, body);
      bodies.push({ name, body });
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 204 });
  };

  return { files, urls, bodies, fetchImpl };
}

function makeSettings(overrides?: Partial<Settings>): Settings {
  return {
    ...buildDefaultSettings(NOW_TS),
    syncEnabled: true,
    webdavUrl: 'https://nas.example:5005/tdxl-sync/',
    webdavUser: 'dorry',
    deviceId: 'devA',
    lastSyncAt: null,
    ...overrides,
  };
}

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

function makeLog(id: string, answeredAt: number, deviceId: string): ReviewLog {
  return {
    id,
    wordId: 'core:alpha',
    stateKey: stateKeyOfNorm('alpha'),
    sessionId: 'sess_A',
    rating: 3,
    prevLevel: 0,
    newLevel: 1,
    prevDueAt: answeredAt,
    newDueAt: answeredAt + 60_000,
    answeredAt,
    durationMs: 1_200,
    isRetry: false,
    deviceId,
  };
}

beforeEach(async () => {
  await ensureSettings(makeSettings());
  await setSecret(PASSWORD);
});

describe('双设备往返与 conflicts 计数', () => {
  it('A 上传 → 注入设备 B 文件 → A 再同步：新者胜、同时间戳本地胜、流水并集、conflicts 精确为 1', async () => {
    const stub = createWebdavStub();
    await bulkUpsert([makeState('alpha', 100), makeState('beta', 100)]);
    await appendMany([makeLog('log_A', 100, 'devA')]);

    // 第一轮：A 上传自己的设备文件
    const first = await syncNow(makeSettings(), { fetchImpl: stub.fetchImpl, nowTs: () => NOW_TS });
    expect(first.error).toBeNull();
    expect(stub.files.has(PER_DEVICE_FILES.wordStates('devA'))).toBe(true);

    // 注入设备 B 的文件：alpha 被 B 改新（level 5）、beta 时间戳与本地完全相同
    stub.files.set(
      PER_DEVICE_FILES.wordStates('devB'),
      JSON.stringify([
        makeState('alpha', 300, { level: 5 }),
        makeState('beta', 100), // 与本地 updatedAt 完全相同
      ]),
    );
    stub.files.set(
      PER_DEVICE_FILES.reviewLogs('devB', MONTH),
      JSON.stringify([makeLog('log_B', 200, 'devB')]),
    );

    // 第二轮：A 拉取合并
    const second = await syncNow(makeSettings(), { fetchImpl: stub.fetchImpl, nowTs: () => NOW_TS });
    expect(second.error).toBeNull();

    // LWW：B 的 alpha 较新 → 胜出；beta 时间戳相同 → 本地胜（level 不变）
    const states = await db.wordStates.toArray();
    expect(states.find((s) => s.stateKey === stateKeyOfNorm('alpha'))?.level).toBe(5);
    expect(states.find((s) => s.stateKey === stateKeyOfNorm('beta'))?.level).toBe(1);

    // conflicts 精确为 1：只有 alpha 一次真冲突（beta 同时间戳不计数）
    expect(second.conflicts).toBe(1);

    // 流水并集：log_A 与 log_B 都在，同 id 去重
    const logIds = (await db.reviewLogs.toArray()).map((log) => log.id).sort();
    expect(logIds).toEqual(['log_A', 'log_B']);
    expect(second.downloaded.reviewLogs).toBe(1);
  });
});

describe('错误路径补强', () => {
  it('单文件记录损坏 → PARSE：该文件跳过、其余实体照常合并、上传照常进行', async () => {
    const stub = createWebdavStub();
    // wordStates.devB.json 里混入一条缺 stateKey 的坏记录 → 整文件判损
    stub.files.set(
      PER_DEVICE_FILES.wordStates('devB'),
      JSON.stringify([makeState('alpha', 100), { updatedAt: 1 }]),
    );
    // reviewLogs.devB.json 正常
    stub.files.set(
      PER_DEVICE_FILES.reviewLogs('devB', MONTH),
      JSON.stringify([makeLog('log_B', 200, 'devB')]),
    );
    await appendMany([makeLog('log_A', 100, 'devA')]);

    const report = await syncNow(makeSettings(), { fetchImpl: stub.fetchImpl, nowTs: () => NOW_TS });
    expect(report.error?.code).toBe('PARSE');
    // 坏文件跳过：alpha 未被并入；好文件照常：log_B 已并入
    expect(await db.wordStates.count()).toBe(0);
    expect((await db.reviewLogs.toArray()).map((log) => log.id)).toContain('log_B');
    // PARSE 不阻断上传：本地流水照常上传。
    // log_A/log_B 的 answeredAt=100/200（1970-01），设备文件按月分片 → 上传 1970-01 全量快照 2 条
    expect(report.uploaded.reviewLogs).toBe(2);
    const logMonth = dayjs(100).format('YYYY-MM');
    expect(stub.files.has(PER_DEVICE_FILES.reviewLogs('devA', logMonth))).toBe(true);
  });

  it('上传失败 → PROXY：dirtyAt 保留、lastSyncAt 不更新、meta.json 不写', async () => {
    const stub = createWebdavStub({
      failPutFor: (name) => name === PER_DEVICE_FILES.wordStates('devA'),
    });
    await bulkUpsert([makeState('alpha', 100)]);

    const report = await syncNow(makeSettings(), { fetchImpl: stub.fetchImpl, nowTs: () => NOW_TS });
    expect(report.error?.code).toBe('PROXY');
    // 脏标记保留（按旧实体名 wordstate-*.json）
    const dirty = (await listSyncMeta()).filter((meta) => meta.dirtyAt !== null);
    expect(dirty.length).toBeGreaterThan(0);
    expect(dirty.every((meta) => meta.entity.startsWith('wordstate-'))).toBe(true);
    // lastSyncAt 不更新
    expect((await db.settings.get('global'))?.lastSyncAt).toBeNull();
    // meta.json 不写（推送失败即中止收尾）
    expect(stub.files.has(PER_DEVICE_FILES.meta)).toBe(false);
  });
});

describe('Settings 合并 C6（端到端）', () => {
  it('远端 settings 较新：采纳对端业务字段，但 deviceId / lastExportAt 保留本地，lastSyncAt 为本机同步时刻', async () => {
    const stub = createWebdavStub();
    stub.files.set(
      PER_DEVICE_FILES.settings,
      JSON.stringify(
        makeSettings({
          updatedAt: NOW_TS + 5_000,
          deviceId: 'devB',
          lastSyncAt: 7_777,
          lastExportAt: 8_888,
          newWordLimit: 30,
          theme: 'dark',
        }),
      ),
    );

    const report = await syncNow(makeSettings(), { fetchImpl: stub.fetchImpl, nowTs: () => NOW_TS });
    expect(report.error).toBeNull();
    expect(report.downloaded.settings).toBe(1);

    const merged = await db.settings.get('global');
    expect(merged?.newWordLimit).toBe(30);
    expect(merged?.theme).toBe('dark');
    // C6：本机字段不被对端覆盖
    expect(merged?.deviceId).toBe('devA');
    expect(merged?.lastExportAt).toBeNull();
    expect(merged?.lastSyncAt).toBe(NOW_TS); // 本机同步完成时刻，不是对端的 7777
  });
});

describe('安全审计：密码不出现在 URL / 载荷 / 错误报告', () => {
  it('成功同步：所有请求 URL 与所有 PUT 载荷均不含密码（明文或编码形态）', async () => {
    const stub = createWebdavStub();
    await bulkUpsert([makeState('alpha', 100)]);
    await addExample({ stateKey: stateKeyOfNorm('alpha'), wordId: 'core:alpha', en: 'pwd test', zh: null });

    const report = await syncNow(makeSettings(), { fetchImpl: stub.fetchImpl, nowTs: () => NOW_TS });
    expect(report.error).toBeNull();

    const encoded = encodeURIComponent(PASSWORD);
    for (const url of stub.urls) {
      expect(url).not.toContain(PASSWORD);
      expect(url).not.toContain(encoded);
      expect(url).not.toContain('Basic ');
    }
    for (const { body } of stub.bodies) {
      expect(body).not.toContain(PASSWORD);
      // settings.json 载荷里也不含密码（密码只存 secrets 表）
      expect(body).not.toContain('webdavPass');
    }
  });

  it('认证失败：SyncReport 整体序列化不含密码（message / detail 均安全）', async () => {
    const stub = createWebdavStub({ authFail: true });
    await bulkUpsert([makeState('alpha', 100)]);

    const report = await syncNow(makeSettings(), { fetchImpl: stub.fetchImpl, nowTs: () => NOW_TS });
    expect(report.error?.code).toBe('AUTH');
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(encodeURIComponent(PASSWORD));
  });
});

describe('BUG-1 证据：wordNotes / wordHighlights 未参与同步（预期失败，修复后启用）', () => {
  it('本机笔记与高亮应随 wordbook.{deviceId}.json 上传', async () => {
    const stub = createWebdavStub();
    const stateKey = stateKeyOfNorm('alpha');
    await upsertNote({ stateKey, wordId: 'core:alpha', kind: 'chunk', content: 'QA 串记' });
    await addHighlight({
      stateKey,
      wordId: 'core:alpha',
      scope: 'headword',
      exampleIndex: null,
      text: 'alpha',
      color: 2,
    });

    const report = await syncNow(makeSettings(), { fetchImpl: stub.fetchImpl, nowTs: () => NOW_TS });
    expect(report.error).toBeNull();

    const payload = JSON.parse(stub.files.get(PER_DEVICE_FILES.wordbook('devA')) ?? '{}') as {
      wordNotes?: WordNote[];
      wordHighlights?: WordHighlight[];
    };
    expect(payload.wordNotes).toHaveLength(1);
    expect(payload.wordNotes?.[0]?.content).toBe('QA 串记');
    expect(payload.wordHighlights).toHaveLength(1);
    expect(payload.wordHighlights?.[0]?.text).toBe('alpha');
  });

  it('远端其他设备的笔记/高亮应被拉取合并入库', async () => {
    const stub = createWebdavStub();
    const stamp = NOW_TS - 1_000;
    const remoteNote: WordNote = {
      id: 'wnote_remote',
      stateKey: stateKeyOfNorm('alpha'),
      wordId: 'core:alpha',
      kind: 'assoc',
      content: '设备 B 的联想',
      zh: null,
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
    };
    const remoteHighlight: WordHighlight = {
      id: 'whl_remote',
      stateKey: stateKeyOfNorm('alpha'),
      wordId: 'core:alpha',
      scope: 'meaning',
      exampleIndex: null,
      text: '测试释义',
      color: 1,
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
    };
    stub.files.set(
      PER_DEVICE_FILES.wordbook('devB'),
      JSON.stringify({ books: [], words: [], notebook: [], wordNotes: [remoteNote], wordHighlights: [remoteHighlight] }),
    );

    const report = await syncNow(makeSettings(), { fetchImpl: stub.fetchImpl, nowTs: () => NOW_TS });
    expect(report.error).toBeNull();

    expect(await db.wordNotes.get('wnote_remote')).toBeDefined();
    expect(await db.wordHighlights.get('whl_remote')).toBeDefined();
  });
});
