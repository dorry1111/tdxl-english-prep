/**
 * 本批次专用的远端文件名常量与 URL 解析（per-device LWW 方案，docs/NAS-SYNC.md）。
 *
 * 【为什么不复用 constants/storage.ts 的 REMOTE_FILES】
 * REMOTE_FILES 是旧的分片方案（wordstate-0..7.json / reviewlog-YYYY-MM.json 全局共享），
 * per-device LWW 方案改为「每设备写独立文件、读取时合并」，文件名规则完全不同。
 * 为避免与并行批次冲突，这里独立定义，不动 constants/storage.ts。
 *
 * 仓库层 markDirty 仍按旧实体名（wordstate-3.json 等）标脏，
 * engine 通过 localEntityToDeviceFiles 把旧实体名映射到本设备的新文件。
 */
import { REMOTE_FILES } from '@/constants';
import type { Settings, Timestamp } from '@/types';

/** 每设备独立的远端文件名（写入永不冲突） */
export const PER_DEVICE_FILES = {
  /** 单文件：WordBook[] + 自定义 Word[] + NotebookEntry[] + WordNote[] + WordHighlight[] */
  wordbook: (deviceId: string): string => `wordbook.${deviceId}.json`,
  wordStates: (deviceId: string): string => `wordStates.${deviceId}.json`,
  reviewLogs: (deviceId: string, month: string): string => `reviewLogs.${deviceId}.${month}.json`,
  sessions: (deviceId: string): string => `sessions.${deviceId}.json`,
  studyDays: (deviceId: string): string => `studyDays.${deviceId}.json`,
  /** 全局单文件，LWW */
  settings: 'settings.json',
  /** 设备清单 + 各设备最后同步时间 */
  meta: 'meta.json',
} as const;

/** wordbook 文件的内容结构（wordNotes / wordHighlights / textHighlights 为可选：旧版本文件允许缺字段） */
export interface WordbookPayload {
  books: unknown[];
  words: unknown[];
  notebook: unknown[];
  /** 每词笔记（BUG-1 修复：随 wordbook 文件同步） */
  wordNotes?: unknown[];
  /** 划词高亮（BUG-1 修复：随 wordbook 文件同步） */
  wordHighlights?: unknown[];
  /** 真题划词高亮与笔记（P3：随 wordbook 文件同步） */
  textHighlights?: unknown[];
}

/** meta.json 的内容结构 */
export interface MetaDeviceInfo {
  deviceId: string;
  lastSyncAt: Timestamp | null;
}

export interface MetaFile {
  schemaVersion: number;
  updatedAt: Timestamp;
  devices: MetaDeviceInfo[];
}

/** 非流水的设备文件（wordStates / sessions / studyDays / wordbook） */
export interface ParsedDeviceFile {
  kind: 'wordStates' | 'sessions' | 'studyDays' | 'wordbook';
  deviceId: string;
}

/** 按月分片的流水设备文件 */
export interface ParsedReviewLogFile {
  kind: 'reviewLogs';
  deviceId: string;
  month: string;
}

export type ParsedRemoteFile = ParsedDeviceFile | ParsedReviewLogFile;

/**
 * 解析 per-device 文件名；不属于本方案的文件返回 null。
 * deviceId 内部不含 `.` 与空格（newId 生成的小写字母数字下划线）。
 */
export function parseDeviceFileName(name: string): ParsedRemoteFile | null {
  const reviewLog = /^reviewLogs\.([^.]+)\.(\d{4}-\d{2})\.json$/.exec(name);
  if (reviewLog) {
    const deviceId = reviewLog[1];
    const month = reviewLog[2];
    if (deviceId && month) {
      return { kind: 'reviewLogs', deviceId, month };
    }
  }
  const plain = /^(wordStates|sessions|studyDays|wordbook)\.([^.]+)\.json$/.exec(name);
  if (plain) {
    const kind = plain[1];
    const deviceId = plain[2];
    if (
      deviceId &&
      (kind === 'wordStates' || kind === 'sessions' || kind === 'studyDays' || kind === 'wordbook')
    ) {
      return { kind, deviceId };
    }
  }
  return null;
}

/**
 * 把仓库层标脏的旧实体名映射为本设备需要上传的 per-device 文件名。
 *
 * - `wordstate-{n}.json`（任意分片）→ wordStates.{deviceId}.json（上传全量表）
 * - `reviewlog-{MM}.json` → reviewLogs.{deviceId}.{MM}.json
 * - `study.json` → sessions.{deviceId}.json + studyDays.{deviceId}.json
 * - `wordbook.json` → wordbook.{deviceId}.json
 * - `settings.json` → settings.json
 */
export function localEntityToDeviceFiles(entity: string, deviceId: string): string[] {
  if (entity === REMOTE_FILES.settings) {
    return [PER_DEVICE_FILES.settings];
  }
  if (entity === REMOTE_FILES.wordbook) {
    return [PER_DEVICE_FILES.wordbook(deviceId)];
  }
  if (entity === REMOTE_FILES.study) {
    return [PER_DEVICE_FILES.sessions(deviceId), PER_DEVICE_FILES.studyDays(deviceId)];
  }
  if (/^wordstate-\d+\.json$/.test(entity)) {
    return [PER_DEVICE_FILES.wordStates(deviceId)];
  }
  const reviewLog = /^reviewlog-(\d{4}-\d{2})\.json$/.exec(entity);
  if (reviewLog) {
    const month = reviewLog[1];
    if (month) {
      return [PER_DEVICE_FILES.reviewLogs(deviceId, month)];
    }
  }
  return [];
}

/** 取 base URL 的 pathname 部分（解码回原文，URL 构造器会把非 ASCII 编成百分号）；非法 URL 原样返回 */
function pathnameOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return url;
  }
}

/** 以 `/` 正确拼接两段路径 */
function joinPath(left: string, right: string): string {
  const trimmedRight = right.replace(/^\/+/, '');
  return left.endsWith('/') ? left + trimmedRight : `${left}/${trimmedRight}`;
}

/** 保证末尾带 `/`，便于后续直接拼文件名 */
export function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * 解析最终的请求 base URL（ARCHITECTURE 4.2.1 唯一拼装规则）：
 *
 * - 直连：base = webdavUrl（含用户自己的子目录）
 * - 代理：base = proxyUrl + pathnameOf(webdavUrl)
 *   proxyUrl 支持绝对地址（SCF 代理），也支持同源相对路径（如 `/dav/` 反代）
 */
export function resolveBaseUrl(
  settings: Pick<Settings, 'webdavUrl' | 'useProxy' | 'proxyUrl'>,
): string {
  const webdavUrl = settings.webdavUrl.trim();
  if (settings.useProxy && settings.proxyUrl.trim() !== '') {
    return normalizeBaseUrl(joinPath(settings.proxyUrl.trim(), pathnameOf(webdavUrl)));
  }
  return normalizeBaseUrl(webdavUrl);
}
