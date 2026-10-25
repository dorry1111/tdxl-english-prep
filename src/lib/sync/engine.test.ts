/**
 * 同步引擎集成测试：注入 fetch + fake-indexeddb，跑完整同步往返，全程不触网。
 *
 * 覆盖：
 * - 完整往返：本地写入 → syncNow 上传 → 清库 → 再 syncNow → 数据还原；
 * - 双端合并：设备 B 的较新 wordState / 追加流水并入；墓碑不被复活；
 * - DISABLED 短路；401 → AUTH；远端内容损坏 → PARSE 且跳过该文件继续同步；
 * - 成功后清脏（再次同步不重复上传）；上传失败保留脏标记。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { dayjs } from '@/lib/dayjs';
import { stateKeyOfNorm } from '@/lib/hash';
import {
  appendMany,
  reviewLogEntityOf,
} from '@/db/repos/logRepo';
import { ensureSettings, setSecret } from '@/db/repos/settingsRepo';
import { addTextHighlight } from '@/db/repos/textHighlightRepo';
import { add as addNote } from '@/db/repos/notebookRepo';
import { putDay } from '@/db/repos/dayRepo';
import { bulkUpsert } from '@/db/repos/stateRepo';
import { createSession } from '@/db/repos/sessionRepo';
import { buildDefaultSettings } from '@/db/seed';
import { db, listSyncMeta, markDirty } from '@/db';
import type { FetchLike } from '@/lib/sync/webdav';
import type { ReviewLog, Settings, StudyDay, StudySession, WordState } from '@/types';

import { syncNow } from './engine';

const NOW_TS = 1_792_000_000_000; // 固定时钟，避免用例间抖动

interface StubOptions {
  authFail?: boolean;
  failPutFor?: (name: string) => boolean;
}

interface RecordedRequest {
  method: string;
  name: string;
  status: number;
}

/** 内存 WebDAV 服务端：Map 存文件 + PROPFIND/GET/PUT/DELETE 最小实现 */
function createWebdavStub(options: StubOptions = {}) {
  const files = new Map<string, string>();
  const requests: RecordedRequest[] = [];

  const fetchImpl: FetchLike = async (url, init) => {
    const method = init.method ?? 'GET';
    const name =
      decodeURIComponent(String(url).split('/').filter((part) => part !== '').pop() ?? '') || '';
    if (options.authFail) {
      requests.push({ method, name, status: 401 });
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
      const xml = `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${items}</D:multistatus>`;
      requests.push({ method, name, status: 207 });
      return new Response(xml, { status: 207 });
    }
    if (method === 'GET') {
      const body = files.get(name);
      requests.push({ method, name, status: body === undefined ? 404 : 200 });
      if (body === undefined) {
        return new Response(null, { status: 404 });
      }
      return new Response(body, { status: 200 });
    }
    if (method === 'PUT') {
      if (options.failPutFor?.(name)) {
        requests.push({ method, name, status: 500 });
        return new Response(null, { status: 500 });
      }
      files.set(name, typeof init.body === 'string' ? init.body : '');
      requests.push({ method, name, status: 200 });
      return new Response(null, { status: 200 });
    }
    if (method === 'DELETE') {
      files.delete(name);
      requests.push({ method, name, status: 204 });
      return new Response(null, { status: 204 });
    }
    requests.push({ method, name, status: 400 });
    return new Response(null, { status: 400 });
  };

  return { files, requests, fetchImpl };
}

function makeSettings(overrides?: Partial<Settings>): Settings {
  return {
    ...buildDefaultSettings(NOW_TS),
    syncEnabled: true,
    webdavUrl: 'https://nas.example:5005/tdxl-sync/',
    webdavUser: 'dorry',
    deviceId: 'devA',
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

function makeSession(id: string, updatedAt: number, deviceId: string): StudySession {
  return {
    id,
    studyDay: '2026-10-26',
    startedAt: updatedAt - 60_000,
    endedAt: updatedAt,
    newCount: 1,
    reviewCount: 0,
    answerCount: 1,
    correctCount: 1,
    ratingCounts: { '1': 0, '2': 0, '3': 1, '4': 0 },
    durationSec: 60,
    unstableWordIds: [],
    deviceId,
    updatedAt,
    deletedAt: null,
  };
}

function makeDay(studyDay: string, updatedAt: number): StudyDay {
  return {
    studyDay,
    newLearned: 1,
    reviewed: 0,
    answerCount: 1,
    correctCount: 1,
    durationSec: 60,
    retryAnswers: 0,
    updatedAt,
    deletedAt: null,
  };
}

async function seedLocalData(): Promise<void> {
  await bulkUpsert([makeState('alpha', NOW_TS - 1_000)]);
  await appendMany([makeLog('log_A', NOW_TS - 500, 'devA')]);
  await createSession(makeSession('sess_A', NOW_TS - 400, 'devA'));
  await putDay(makeDay('2026-10-26', NOW_TS - 300));
  await addNote({ wordId: 'core:alpha', headword: 'alpha', source: 'manual' });
}

/** 清空并重建基础数据（settings + 密钥），用于「换设备恢复」场景 */
async function resetButKeepRemoteSettingsLike(): Promise<void> {
  await Promise.all(db.tables.map((table) => table.clear()));
}

describe('syncNow 完整往返', () => {
  beforeEach(async () => {
    const settings = makeSettings();
    await ensureSettings(settings);
    await setSecret('pass');
  });

  it('本地写入 → 同步上传 → 清库 → 再同步 → 数据还原', async () => {
    const stub = createWebdavStub();
    const settings = makeSettings();
    await seedLocalData();

    const report = await syncNow(settings, { fetchImpl: stub.fetchImpl, nowTs: () => NOW_TS });
    expect(report.error).toBeNull();
    expect(report.uploaded.wordStates).toBe(1);
    expect(report.uploaded.reviewLogs).toBe(1);
    expect(report.uploaded.sessions).toBe(1);
    expect(report.uploaded.studyDays).toBe(1);
    expect(report.uploaded.settings).toBe(1);
    expect(stub.files.has('wordStates.devA.json')).toBe(true);
    expect(stub.files.has(`reviewLogs.devA.${dayjs(NOW_TS).format('YYYY-MM')}.json`)).toBe(true);
    expect(stub.files.has('sessions.devA.json')).toBe(true);
    expect(stub.files.has('studyDays.devA.json')).toBe(true);
    expect(stub.files.has('wordbook.devA.json')).toBe(true);
    expect(stub.files.has('settings.json')).toBe(true);
    // meta.json 登记了本设备
    const meta = JSON.parse(stub.files.get('meta.json') ?? '{}') as {
      devices: Array<{ deviceId: string }>;
    };
    expect(meta.devices.some((device) => device.deviceId === 'devA')).toBe(true);
    // 上传成功后所有脏标记清零
    const metas = await listSyncMeta();
    expect(metas.length).toBeGreaterThan(0);
    expect(metas.every((metaRow) => metaRow.dirtyAt === null)).toBe(true);
    // lastSyncAt 已写回
    const syncedSettings = await db.settings.get('global');
    expect(syncedSettings?.lastSyncAt).toBe(NOW_TS);

    // ---- 模拟换设备：清库后重新初始化，再同步 ----
    await resetButKeepRemoteSettingsLike();
    await ensureSettings(makeSettings({ lastSyncAt: null }));
    await setSecret('pass');
    const restore = await syncNow(makeSettings({ lastSyncAt: null }), {
      fetchImpl: stub.fetchImpl,
      nowTs: () => NOW_TS,
    });
    expect(restore.error).toBeNull();

    const states = await db.wordStates.toArray();
    expect(states).toHaveLength(1);
    expect(states[0]?.stateKey).toBe(stateKeyOfNorm('alpha'));
    expect(states[0]?.level).toBe(1);
    expect((await db.reviewLogs.toArray()).map((log) => log.id)).toContain('log_A');
    expect(await db.sessions.get('sess_A')).toBeDefined();
    expect(await db.studyDays.get('2026-10-26')).toBeDefined();
    expect(await db.notebook.count()).toBe(1);
    expect(restore.downloaded.wordStates).toBe(1);
  });

  it('真题划词高亮随 wordbook 文件同步往返（P3）', async () => {
    const stub = createWebdavStub();
    const settings = makeSettings();
    await addTextHighlight({
      anchorKind: 'passage',
      anchorId: 'draft-p-reading-1',
      blockKey: 'p:0',
      text: 'global warming',
      start: 12,
      color: 2,
      note: '高频考点词',
      wordNorm: null,
    });

    const report = await syncNow(settings, { fetchImpl: stub.fetchImpl, nowTs: () => NOW_TS });
    expect(report.error).toBeNull();
    const remote = JSON.parse(stub.files.get('wordbook.devA.json') ?? '{}') as {
      textHighlights?: unknown[];
    };
    expect(remote.textHighlights).toHaveLength(1);

    // 换设备恢复
    await resetButKeepRemoteSettingsLike();
    await ensureSettings(makeSettings({ lastSyncAt: null }));
    await setSecret('pass');
    const restore = await syncNow(makeSettings({ lastSyncAt: null }), {
      fetchImpl: stub.fetchImpl,
      nowTs: () => NOW_TS,
    });
    expect(restore.error).toBeNull();
    const rows = await db.textHighlights.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe('global warming');
    expect(rows[0]?.note).toBe('高频考点词');
  });

  it('无脏数据时再次同步不重复上传（PROPFIND+GET 幂等）', async () => {
    const stub = createWebdavStub();
    const settings = makeSettings();
    await seedLocalData();
    await syncNow(settings, { fetchImpl: stub.fetchImpl, nowTs: () => NOW_TS });
    const putsAfterFirst = stub.requests.filter((r) => r.method === 'PUT').length;
    expect(putsAfterFirst).toBeGreaterThan(0);

    const second = await syncNow(settings, { fetchImpl: stub.fetchImpl, nowTs: () => NOW_TS });
    expect(second.error).toBeNull();
    const wordStatePuts = stub.requests.filter(
      (r) => r.method === 'PUT' && r.name === 'wordStates.devA.json',
    );
    expect(wordStatePuts).toHaveLength(1); // 只有第一轮上传过
  });
});

describe('syncNow 双端合并', () => {
  beforeEach(async () => {
    await ensureSettings(makeSettings());
    await setSecret('pass');
  });

  it('设备 B 的较新记录与流水并入；墓碑不被复活；本设备文件回写合并结果', async () => {
    const stub = createWebdavStub();
    await bulkUpsert([
      makeState('alpha', 100), // 将被 B 的墓碑覆盖
      makeState('beta', 100), // 本地旧版本，B 上有较新版本
    ]);
    await markDirty('wordstate-0.json', 2);
    await appendMany([makeLog('log_A', 100, 'devA')]);

    // 设备 B 的远端文件
    stub.files.set(
      'wordStates.devB.json',
      JSON.stringify([
        makeState('beta', 400, { level: 7 }),
        makeState('alpha', 500, { deletedAt: 500 }),
      ]),
    );
    stub.files.set(
      `reviewLogs.devB.${dayjs(NOW_TS).format('YYYY-MM')}.json`,
      JSON.stringify([makeLog('log_B', 200, 'devB')]),
    );

    const report = await syncNow(makeSettings(), {
      fetchImpl: stub.fetchImpl,
      nowTs: () => NOW_TS,
    });
    expect(report.error).toBeNull();
    expect(report.conflicts).toBeGreaterThanOrEqual(2);
    expect(report.downloaded.reviewLogs).toBe(1);

    const states = await db.wordStates.toArray();
    const alpha = states.find((state) => state.stateKey === stateKeyOfNorm('alpha'));
    const beta = states.find((state) => state.stateKey === stateKeyOfNorm('beta'));
    expect(beta?.level).toBe(7); // 新者胜
    expect(alpha?.deletedAt).toBe(500); // 墓碑不被旧活记录复活

    const logIds = (await db.reviewLogs.toArray()).map((log) => log.id).sort();
    expect(logIds).toEqual(['log_A', 'log_B']); // 追加型去重并集

    // 本设备文件上传后包含合并结果（B 的设备下次拉取即得）
    const ownFile = JSON.parse(stub.files.get('wordStates.devA.json') ?? '[]') as WordState[];
    expect(ownFile.find((state) => state.stateKey === stateKeyOfNorm('beta'))?.level).toBe(7);
    expect(ownFile.find((state) => state.stateKey === stateKeyOfNorm('alpha'))?.deletedAt).toBe(500);
  });
});

describe('syncNow 错误码映射', () => {
  beforeEach(async () => {
    await ensureSettings(makeSettings());
    await setSecret('pass');
  });

  it('syncEnabled=false：DISABLED 短路，不发出任何请求', async () => {
    const stub = createWebdavStub();
    const report = await syncNow(makeSettings({ syncEnabled: false }), {
      fetchImpl: stub.fetchImpl,
      nowTs: () => NOW_TS,
    });
    expect(report.error?.code).toBe('DISABLED');
    expect(stub.requests).toHaveLength(0);
  });

  it('401 → AUTH，中断同步', async () => {
    const stub = createWebdavStub({ authFail: true });
    await seedLocalData();
    const report = await syncNow(makeSettings(), {
      fetchImpl: stub.fetchImpl,
      nowTs: () => NOW_TS,
    });
    expect(report.error?.code).toBe('AUTH');
    expect(stub.files.size).toBe(0);
    // 脏标记保留，下次同步重传
    expect((await listSyncMeta()).some((meta) => meta.dirtyAt !== null)).toBe(true);
  });

  it('缺少应用密码 → AUTH（致命配置缺失不抛出，收敛为报告）', async () => {
    const stub = createWebdavStub();
    await db.secrets.clear();
    const report = await syncNow(makeSettings(), {
      fetchImpl: stub.fetchImpl,
      nowTs: () => NOW_TS,
    });
    expect(report.error?.code).toBe('AUTH');
    expect(stub.requests).toHaveLength(0);
  });

  it('远端内容损坏 → PARSE：跳过该文件，其余实体照常同步', async () => {
    const stub = createWebdavStub();
    stub.files.set('settings.json', 'not-json');
    await seedLocalData();
    const report = await syncNow(makeSettings(), {
      fetchImpl: stub.fetchImpl,
      nowTs: () => NOW_TS,
    });
    expect(report.error?.code).toBe('PARSE');
    // 坏文件被跳过：本地 settings 未被破坏，wordStates 照常上传
    expect((await db.settings.get('global'))?.syncEnabled).toBe(true);
    expect(report.uploaded.wordStates).toBe(1);
  });

  it('上传失败 → PROXY：保留脏标记，中断后续上传', async () => {
    const stub = createWebdavStub({ failPutFor: (name) => name === 'wordStates.devA.json' });
    await seedLocalData();
    const report = await syncNow(makeSettings(), {
      fetchImpl: stub.fetchImpl,
      nowTs: () => NOW_TS,
    });
    expect(report.error?.code).toBe('PROXY');
    expect(stub.files.has('wordStates.devA.json')).toBe(false);
    expect((await listSyncMeta()).some((meta) => meta.dirtyAt !== null)).toBe(true);
  });
});

describe('reviewLog 月分片与旧实体名映射', () => {
  beforeEach(async () => {
    await ensureSettings(makeSettings());
    await setSecret('pass');
  });

  it('两个月份的流水分片分别上传，脏标记按旧实体名清除', async () => {
    const stub = createWebdavStub();
    const monthOfNow = dayjs(NOW_TS).format('YYYY-MM');
    const monthOfOld = dayjs(NOW_TS - 90 * 86_400_000).format('YYYY-MM');
    await appendMany([
      makeLog('log_now', NOW_TS, 'devA'),
      makeLog('log_old', NOW_TS - 90 * 86_400_000, 'devA'),
    ]);
    expect(reviewLogEntityOf(NOW_TS)).toBe(`reviewlog-${monthOfNow}.json`);

    const report = await syncNow(makeSettings(), {
      fetchImpl: stub.fetchImpl,
      nowTs: () => NOW_TS,
    });
    expect(report.error).toBeNull();
    expect(report.uploaded.reviewLogs).toBe(2);
    expect(stub.files.has(`reviewLogs.devA.${monthOfNow}.json`)).toBe(true);
    expect(stub.files.has(`reviewLogs.devA.${monthOfOld}.json`)).toBe(true);
    const nowFile = JSON.parse(
      stub.files.get(`reviewLogs.devA.${monthOfNow}.json`) ?? '[]',
    ) as ReviewLog[];
    expect(nowFile.map((log) => log.id)).toEqual(['log_now']);
    expect((await listSyncMeta()).every((meta) => meta.dirtyAt === null)).toBe(true);
  });
});
