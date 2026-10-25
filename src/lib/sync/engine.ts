/**
 * 同步引擎：syncNow(settings, deps)（ARCHITECTURE 4.2 时序，per-device LWW 版）。
 *
 * 流程：
 *  ① syncEnabled=false → 短路返回 DISABLED；
 *  ② PROPFIND 列远端文件，收集全部设备清单；
 *  ③ 下载所有设备的 per-device 文件 + settings.json，按实体逐个「单事务合并入库」；
 *  ④ 打包本地数据，只上传「有脏实体」对应的本设备文件；
 *  ⑤ 写 meta.json（设备清单 + 各设备最后同步时间）；
 *  ⑥ 清除已上传实体的脏标记、记录 lastPulledAt、更新 lastSyncAt；
 *  ⑦ 返回 SyncReport（uploaded / downloaded / conflicts / error），错误不抛出。
 *
 * 【分层说明】本模块是数据层基础设施（与 db/repos 同层），
 * 允许直接 import db；页面只能通过 syncNow / maybeAutoSync 间接使用。
 * settings.lastSyncAt 的回写刻意绕过 patchSettings（不标脏、不 bump updatedAt），
 * 否则每次同步都会把 settings.json 标脏，造成无意义的上传循环。
 */
import type { Table } from 'dexie';

import { ERROR_MESSAGES } from '@/constants';
import { clearDirty, db } from '@/db';
import { getSecret } from '@/db/repos/settingsRepo';
import { dayjs } from '@/lib/dayjs';
import { now } from '@/lib/time';
import type {
  NotebookEntry,
  RemoteFileEntry,
  Settings,
  SyncErrorCode,
  SyncReport,
  StudyDay,
  StudySession,
  Syncable,
  TextHighlight,
  Word,
  WordBook,
  WordHighlight,
  WordNote,
  WordState,
  ReviewLog,
} from '@/types';

import {
  mergeAppendOnly,
  mergeRecords,
  mergeSettings,
  type MergeResult,
} from './merge';
import {
  localEntityToDeviceFiles,
  parseDeviceFileName,
  PER_DEVICE_FILES,
  resolveBaseUrl,
  type MetaFile,
  type WordbookPayload,
} from './remoteFiles';
import { DEFAULT_TIMEOUT_MS, SyncError, WebdavClient, type FetchLike } from './webdav';

/** SyncErrorCode → 用户可见中文文案（ERROR_MESSAGES 唯一真源） */
export const SYNC_ERROR_MESSAGES: Record<SyncErrorCode, string> = {
  NETWORK: ERROR_MESSAGES.SYNC_NETWORK,
  AUTH: ERROR_MESSAGES.SYNC_AUTH,
  PROXY: ERROR_MESSAGES.SYNC_PROXY,
  CONFLICT: ERROR_MESSAGES.SYNC_CONFLICT,
  PARSE: ERROR_MESSAGES.SYNC_PARSE,
  DISABLED: ERROR_MESSAGES.SYNC_DISABLED,
};

/** 引擎可注入依赖（测试注入 fetch 与时钟，不触网） */
export interface SyncDeps {
  fetchImpl?: FetchLike;
  nowTs?: () => number;
}

/** 单文件解析失败明细（PARS 跳过该文件但继续同步其余文件） */
interface ParseIssue {
  file: string;
  message: string;
}

/** 从远端收集到的各实体数据 */
interface PullPayloads {
  wordStates: WordState[];
  reviewLogs: ReviewLog[];
  sessions: StudySession[];
  studyDays: StudyDay[];
  books: WordBook[];
  words: Word[];
  notebook: NotebookEntry[];
  wordNotes: WordNote[];
  wordHighlights: WordHighlight[];
  textHighlights: TextHighlight[];
  settings: Settings | null;
  meta: MetaFile | null;
}

function emptyPayloads(): PullPayloads {
  return {
    wordStates: [],
    reviewLogs: [],
    sessions: [],
    studyDays: [],
    books: [],
    words: [],
    notebook: [],
    wordNotes: [],
    wordHighlights: [],
    textHighlights: [],
    settings: null,
    meta: null,
  };
}

/** 解析后的远端文件名（下载清单的中间产物） */
interface RemoteNames {
  deviceFiles: string[];
  reviewLogFiles: string[];
  hasSettings: boolean;
  hasMeta: boolean;
}

function collectRemoteNames(entries: RemoteFileEntry[]): RemoteNames {
  const names: RemoteNames = {
    deviceFiles: [],
    reviewLogFiles: [],
    hasSettings: false,
    hasMeta: false,
  };
  for (const entry of entries) {
    if (entry.name === PER_DEVICE_FILES.settings) {
      names.hasSettings = true;
      continue;
    }
    if (entry.name === PER_DEVICE_FILES.meta) {
      names.hasMeta = true;
      continue;
    }
    const parsed = parseDeviceFileName(entry.name);
    if (parsed === null) {
      continue;
    }
    if (parsed.kind === 'reviewLogs') {
      names.reviewLogFiles.push(entry.name);
    } else {
      names.deviceFiles.push(entry.name);
    }
  }
  return names;
}

function takeRows(rows: unknown[], file: string, guard: (row: unknown) => boolean): {
  rows: unknown[];
  issue: ParseIssue | null;
} {
  // guard 必须完整校验一条记录（主键 + updatedAt 等），任意一条不合法则整文件判损
  const invalid = rows.find((row) => !guard(row));
  if (invalid !== undefined) {
    return { rows: [], issue: { file, message: '记录缺少必要主键字段' } };
  }
  return { rows, issue: null };
}

/** Syncable 基本形状：updatedAt 为数字（ReviewLog 不含 updatedAt，另有 guard） */
function hasUpdatedAt(row: unknown): boolean {
  return typeof (row as Syncable).updatedAt === 'number';
}

function parseArray(raw: string, file: string): { rows?: unknown[]; issue?: ParseIssue } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { issue: { file, message: '期望数组' } };
    }
    return { rows: parsed };
  } catch (error) {
    return { issue: { file, message: error instanceof Error ? error.message : String(error) } };
  }
}

function parseObject(raw: string, file: string): { value?: Record<string, unknown>; issue?: ParseIssue } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { issue: { file, message: '期望对象' } };
    }
    return { value: parsed as Record<string, unknown> };
  } catch (error) {
    return { issue: { file, message: error instanceof Error ? error.message : String(error) } };
  }
}

/** 把一个远端文件的内容分发到 payloads 对应实体 */
function absorb(raw: string, name: string, payloads: PullPayloads, issues: ParseIssue[]): void {
  if (name === PER_DEVICE_FILES.settings) {
    const parsed = parseObject(raw, name);
    const value = parsed.value;
    if (!value || value.id !== 'global') {
      if (parsed.issue) {
        issues.push(parsed.issue);
      } else {
        issues.push({ file: name, message: 'settings 缺少 id=global' });
      }
      return;
    }
    payloads.settings = value as unknown as Settings;
    return;
  }

  if (name === PER_DEVICE_FILES.meta) {
    const parsed = parseObject(raw, name);
    if (parsed.issue || !parsed.value) {
      if (parsed.issue) {
        issues.push(parsed.issue);
      }
      return;
    }
    payloads.meta = parsed.value as unknown as MetaFile;
    return;
  }

  const parsedName = parseDeviceFileName(name);
  if (parsedName === null) {
    return; // 非本方案的文件（如别的应用的文件），忽略
  }

  if (parsedName.kind === 'wordStates') {
    const parsed = parseArray(raw, name);
    if (!parsed.rows) {
      if (parsed.issue) {
        issues.push(parsed.issue);
      }
      return;
    }
    const checked = takeRows(
      parsed.rows,
      name,
      (row) => typeof (row as WordState).stateKey === 'string' && hasUpdatedAt(row),
    );
    if (checked.issue) {
      issues.push(checked.issue);
      return;
    }
    payloads.wordStates.push(...(checked.rows as WordState[]));
    return;
  }

  if (parsedName.kind === 'reviewLogs') {
    const parsed = parseArray(raw, name);
    if (!parsed.rows) {
      if (parsed.issue) {
        issues.push(parsed.issue);
      }
      return;
    }
    const checked = takeRows(
      parsed.rows,
      name,
      (row) =>
        typeof (row as ReviewLog).id === 'string' &&
        typeof (row as ReviewLog).answeredAt === 'number',
    );
    if (checked.issue) {
      issues.push(checked.issue);
      return;
    }
    payloads.reviewLogs.push(...(checked.rows as ReviewLog[]));
    return;
  }

  if (parsedName.kind === 'sessions') {
    const parsed = parseArray(raw, name);
    if (!parsed.rows) {
      if (parsed.issue) {
        issues.push(parsed.issue);
      }
      return;
    }
    const checked = takeRows(
      parsed.rows,
      name,
      (row) => typeof (row as StudySession).id === 'string' && hasUpdatedAt(row),
    );
    if (checked.issue) {
      issues.push(checked.issue);
      return;
    }
    payloads.sessions.push(...(checked.rows as StudySession[]));
    return;
  }

  if (parsedName.kind === 'studyDays') {
    const parsed = parseArray(raw, name);
    if (!parsed.rows) {
      if (parsed.issue) {
        issues.push(parsed.issue);
      }
      return;
    }
    const checked = takeRows(
      parsed.rows,
      name,
      (row) => typeof (row as StudyDay).studyDay === 'string' && hasUpdatedAt(row),
    );
    if (checked.issue) {
      issues.push(checked.issue);
      return;
    }
    payloads.studyDays.push(...(checked.rows as StudyDay[]));
    return;
  }

  // wordbook：{ books, words, notebook }
  const parsed = parseObject(raw, name);
  if (parsed.issue || !parsed.value) {
    if (parsed.issue) {
      issues.push(parsed.issue);
    }
    return;
  }
  const value = parsed.value;
  const ok =
    absorbWordbookField(payloads.books, value.books, name, 'books', issues) &&
    absorbWordbookField(payloads.words, value.words, name, 'words', issues) &&
    absorbWordbookField(payloads.notebook, value.notebook, name, 'notebook', issues) &&
    absorbWordbookField(payloads.wordNotes, value.wordNotes, name, 'wordNotes', issues) &&
    absorbWordbookField(payloads.wordHighlights, value.wordHighlights, name, 'wordHighlights', issues) &&
    absorbWordbookField(payloads.textHighlights, value.textHighlights, name, 'textHighlights', issues);
  if (!ok) {
    return; // 部分并入的记录按记录级 LWW 合并无害，无需回滚
  }
}

/** 校验并并入 wordbook 的一个子字段；返回 false 表示该文件整体判定为损坏 */
function absorbWordbookField(
  target: unknown[],
  rows: unknown,
  file: string,
  field: string,
  issues: ParseIssue[],
): boolean {
  if (rows === undefined) {
    return true; // 旧版本文件允许缺字段
  }
  if (!Array.isArray(rows)) {
    issues.push({ file, message: `wordbook.${field} 期望数组` });
    return false;
  }
  const checked = takeRows(
    rows,
    file,
    (row) => typeof (row as Word).id === 'string' && hasUpdatedAt(row),
  );
  if (checked.issue) {
    issues.push(checked.issue);
    return false;
  }
  target.push(...checked.rows);
  return true;
}

function errorOf(code: SyncErrorCode, detail?: unknown): SyncReport['error'] {
  return { code, message: SYNC_ERROR_MESSAGES[code], detail };
}

function finishReport(report: SyncReport, finishedAt: number): SyncReport {
  report.finishedAt = finishedAt;
  return report;
}

function addCount(target: Record<string, number>, key: string, delta: number): void {
  target[key] = (target[key] ?? 0) + delta;
}

/** 批量写回一个实体（仅当有变化），返回写回条数 */
async function applyMerged<T>(result: MergeResult<T>, put: (rows: T[]) => Promise<void>): Promise<number> {
  if (result.toApply.length > 0) {
    await put(result.toApply);
  }
  return result.toApply.length;
}

/**
 * 执行一次完整同步。
 *
 * @param settings 调用方读出的最新 Settings（含 deviceId / webdavUrl / useProxy 等）
 * @param deps 可注入依赖
 * @returns SyncReport；除意外的数据库异常外不抛出
 */
export async function syncNow(settings: Settings, deps: SyncDeps = {}): Promise<SyncReport> {
  const clock = deps.nowTs ?? now;
  const startedAt = clock();
  const report: SyncReport = {
    startedAt,
    finishedAt: startedAt,
    uploaded: {},
    downloaded: {},
    conflicts: 0,
    error: null,
  };

  // ① 短路：未启用
  if (!settings.syncEnabled) {
    report.error = errorOf('DISABLED');
    return finishReport(report, clock());
  }

  // ② 凭据与客户端（致命配置缺失收敛为 AUTH 错误，不抛出）
  const webdavUrl = settings.webdavUrl.trim();
  const username = settings.webdavUser.trim();
  if (webdavUrl === '' || username === '') {
    report.error = errorOf('AUTH', { reason: 'missing webdavUrl/webdavUser' });
    return finishReport(report, clock());
  }
  const password = await getSecret();
  if (password === null) {
    report.error = errorOf('AUTH', { reason: 'missing webdav-pass secret' });
    return finishReport(report, clock());
  }

  const client = new WebdavClient(
    {
      baseUrl: resolveBaseUrl(settings),
      username,
      password,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    },
    deps.fetchImpl ?? ((url, init) => fetch(url, init)),
  );

  const deviceId = settings.deviceId;
  const issues: ParseIssue[] = [];

  try {
    // ③ PROPFIND 列目录
    const entries = await client.list();
    const names = collectRemoteNames(entries);

    // ④ 下载 + 解析
    const payloads = emptyPayloads();
    const downloadNames = [
      ...names.deviceFiles,
      ...names.reviewLogFiles,
      ...(names.hasSettings ? [PER_DEVICE_FILES.settings] : []),
      ...(names.hasMeta ? [PER_DEVICE_FILES.meta] : []),
    ];
    const pulledFiles: string[] = [];
    for (const name of downloadNames) {
      const raw = await client.getText(name);
      if (raw === null) {
        continue;
      }
      absorb(raw, name, payloads, issues);
      pulledFiles.push(name);
    }

    // ⑤ 合并入库：每实体一个事务，事务内不做任何异步 IO
    const localWordStates = await db.wordStates.toArray();
    const stateMerge = mergeRecords(localWordStates, payloads.wordStates, (state) => state.stateKey);
    addCount(
      report.downloaded,
      'wordStates',
      await applyMerged(stateMerge, async (rows) => {
        await db.transaction('rw', db.wordStates, async () => {
          await db.wordStates.bulkPut(rows);
        });
      }),
    );
    report.conflicts += stateMerge.conflicts;

    const localLogs = await db.reviewLogs.toArray();
    const logMerge = mergeAppendOnly(localLogs, payloads.reviewLogs);
    addCount(
      report.downloaded,
      'reviewLogs',
      await applyMerged(logMerge, async (rows) => {
        await db.transaction('rw', db.reviewLogs, async () => {
          await db.reviewLogs.bulkPut(rows);
        });
      }),
    );

    const localSessions = await db.sessions.toArray();
    const sessionMerge = mergeRecords(localSessions, payloads.sessions, (item) => item.id);
    addCount(
      report.downloaded,
      'sessions',
      await applyMerged(sessionMerge, async (rows) => {
        await db.transaction('rw', db.sessions, async () => {
          await db.sessions.bulkPut(rows);
        });
      }),
    );
    report.conflicts += sessionMerge.conflicts;

    const localDays = await db.studyDays.toArray();
    const dayMerge = mergeRecords(localDays, payloads.studyDays, (item) => item.studyDay);
    addCount(
      report.downloaded,
      'studyDays',
      await applyMerged(dayMerge, async (rows) => {
        await db.transaction('rw', db.studyDays, async () => {
          await db.studyDays.bulkPut(rows);
        });
      }),
    );
    report.conflicts += dayMerge.conflicts;

    // wordbook 六张表：books / words / notebook / wordNotes / wordHighlights / textHighlights
    await mergeIdTable('books', db.books, payloads.books, report);
    await mergeIdTable('words', db.words, payloads.words, report);
    await mergeIdTable('notebook', db.notebook, payloads.notebook, report);
    await mergeIdTable('wordNotes', db.wordNotes, payloads.wordNotes, report);
    await mergeIdTable('wordHighlights', db.wordHighlights, payloads.wordHighlights, report);
    await mergeIdTable('textHighlights', db.textHighlights, payloads.textHighlights, report);

    // settings：全局单文件 LWW
    const localSettings = (await db.settings.get('global')) ?? settings;
    const settingsMerge = mergeSettings(localSettings, payloads.settings);
    if (settingsMerge.changed) {
      await db.transaction('rw', db.settings, async () => {
        await db.settings.put(settingsMerge.merged);
      });
      addCount(report.downloaded, 'settings', 1);
    }

    // 记录拉取进度（与实体写入解耦，单独事务）
    if (pulledFiles.length > 0) {
      const pulledAt = clock();
      await db.transaction('rw', db.syncMeta, async () => {
        for (const name of pulledFiles) {
          await db.syncMeta.put({
            entity: name,
            dirtyAt: null,
            lastPulledAt: pulledAt,
            lastEtag: null,
            pendingCount: 0,
          });
        }
      });
    }

    if (issues.length > 0) {
      report.error = errorOf('PARSE', issues);
    }

    // ⑥ 上传：只传「有脏实体」对应的本设备文件；失败则不写 meta、不记 lastSyncAt
    const pushOk = await pushPhase(client, deviceId, report);
    if (!pushOk) {
      return finishReport(report, clock());
    }

    // ⑦ meta.json：登记设备清单
    await writeMeta(client, deviceId, payloads.meta, names, settings.schemaVersion, clock);

    // ⑧ 更新 lastSyncAt（直写，不标脏：避免 settings.json 每次同步都被标记为待上传）
    const finishedAt = clock();
    const current = await db.settings.get('global');
    if (current && current.lastSyncAt !== finishedAt) {
      await db.settings.put({ ...current, lastSyncAt: finishedAt });
    }
    return finishReport(report, finishedAt);
  } catch (error) {
    const syncError = error instanceof SyncError ? error : null;
    report.error = syncError
      ? { code: syncError.code, message: SYNC_ERROR_MESSAGES[syncError.code], detail: syncError.detail }
      : errorOf('NETWORK', error instanceof Error ? error.message : String(error));
    return finishReport(report, clock());
  }
}

/** 有 `id` 主键 + Syncable 字段的表做一次 LWW 合并入库（wordbook 的五张子表共用） */
async function mergeIdTable<T extends Syncable & { id: string }>(
  key: string,
  table: Table<T, string>,
  remoteRows: readonly unknown[],
  report: SyncReport,
): Promise<void> {
  const localRows = await table.toArray();
  const merge = mergeRecords(localRows, remoteRows as T[], (item) => item.id);
  const applied = await applyMerged(merge, async (rows) => {
    await db.transaction('rw', table, async () => {
      await table.bulkPut(rows);
    });
  });
  addCount(report.downloaded, key, applied);
  report.conflicts += merge.conflicts;
}

/** 上传阶段：脏实体 → 本设备文件，逐个 PUT；AUTH/网络错误中断并保留脏标记。返回是否全部成功 */
async function pushPhase(
  client: WebdavClient,
  deviceId: string,
  report: SyncReport,
): Promise<boolean> {
  const dirtyMetas = (await db.syncMeta.toArray()).filter((meta) => meta.dirtyAt !== null);

  // 分组：设备文件 → 需要在上传成功后清脏的旧实体名
  const groups = new Map<string, string[]>();
  for (const meta of dirtyMetas) {
    for (const file of localEntityToDeviceFiles(meta.entity, deviceId)) {
      const bucket = groups.get(file);
      if (bucket) {
        bucket.push(meta.entity);
      } else {
        groups.set(file, [meta.entity]);
      }
    }
  }

  for (const [file, oldEntities] of groups) {
    let countByKey: Array<[key: string, count: number]>;
    try {
      countByKey = await serializeAndPut(client, file);
    } catch (error) {
      // 保留脏标记，下次同步重传；中断后续上传
      if (report.error === null || report.error.code === 'PARSE') {
        const syncError = error instanceof SyncError ? error : null;
        report.error = syncError
          ? { code: syncError.code, message: SYNC_ERROR_MESSAGES[syncError.code], detail: syncError.detail }
          : errorOf('NETWORK', error instanceof Error ? error.message : String(error));
      }
      return false;
    }
    for (const [key, count] of countByKey) {
      addCount(report.uploaded, key, count);
    }
    for (const entity of oldEntities) {
      await clearDirty(entity, null);
    }
  }
  return true;
}

/** 序列化本设备文件并 PUT，返回 [报告键, 条数] 用于 SyncReport 统计 */
async function serializeAndPut(
  client: WebdavClient,
  file: string,
): Promise<Array<[key: string, count: number]>> {
  const parsed = parseDeviceFileName(file);

  if (file === PER_DEVICE_FILES.settings) {
    const row = await db.settings.get('global');
    if (!row) {
      return [];
    }
    await client.putText(file, JSON.stringify(row));
    return [['settings', 1]];
  }

  if (parsed === null) {
    return [];
  }

  if (parsed.kind === 'wordStates') {
    const rows = await db.wordStates.toArray();
    await client.putText(file, JSON.stringify(rows));
    return [['wordStates', rows.length]];
  }

  if (parsed.kind === 'reviewLogs') {
    const all = await db.reviewLogs.toArray();
    const rows = all.filter((log) => dayjs(log.answeredAt).format('YYYY-MM') === parsed.month);
    await client.putText(file, JSON.stringify(rows));
    return [['reviewLogs', rows.length]];
  }

  if (parsed.kind === 'sessions') {
    const rows = await db.sessions.toArray();
    await client.putText(file, JSON.stringify(rows));
    return [['sessions', rows.length]];
  }

  if (parsed.kind === 'studyDays') {
    const rows = await db.studyDays.toArray();
    await client.putText(file, JSON.stringify(rows));
    return [['studyDays', rows.length]];
  }

  // wordbook：词库 + 自定义词条 + 生词本/笔记 + 每词笔记 + 划词高亮 + 真题划词
  const [books, words, notebook, wordNotes, wordHighlights, textHighlights] = await Promise.all([
    db.books.toArray(),
    db.words.toArray(),
    db.notebook.toArray(),
    db.wordNotes.toArray(),
    db.wordHighlights.toArray(),
    db.textHighlights.toArray(),
  ]);
  const payload: WordbookPayload = {
    books,
    words,
    notebook,
    wordNotes,
    wordHighlights,
    textHighlights,
  };
  await client.putText(file, JSON.stringify(payload));
  return [
    [
      'wordbook',
      books.length +
        words.length +
        notebook.length +
        wordNotes.length +
        wordHighlights.length +
        textHighlights.length,
    ],
  ];
}

/** 写 meta.json：设备清单 = 本机 + 远端已知设备（保留其余设备的 lastSyncAt） */
async function writeMeta(
  client: WebdavClient,
  selfDeviceId: string,
  previousMeta: MetaFile | null,
  names: RemoteNames,
  schemaVersion: number,
  clock: () => number,
): Promise<void> {
  const stamp = clock();
  const lastSyncByDevice = new Map<string, number | null>();
  for (const device of previousMeta?.devices ?? []) {
    lastSyncByDevice.set(device.deviceId, device.lastSyncAt);
  }
  for (const name of [...names.deviceFiles, ...names.reviewLogFiles]) {
    const parsed = parseDeviceFileName(name);
    if (parsed && !lastSyncByDevice.has(parsed.deviceId)) {
      lastSyncByDevice.set(parsed.deviceId, null);
    }
  }
  lastSyncByDevice.set(selfDeviceId, stamp);

  const meta: MetaFile = {
    schemaVersion,
    updatedAt: stamp,
    devices: [...lastSyncByDevice.entries()].map(([deviceId, lastSyncAt]) => ({
      deviceId,
      lastSyncAt,
    })),
  };
  await client.putText(PER_DEVICE_FILES.meta, JSON.stringify(meta));
}
