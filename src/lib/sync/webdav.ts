/**
 * WebDAV 客户端（PROPFIND / GET / PUT / DELETE + Basic 认证）。
 *
 * 实测结论（docs/NAS-SYNC.md）：
 * - 服务端无 ETag → 不做 If-Match 乐观锁，走 per-device LWW；
 * - 直连无 CORS → 同时支持「直连 URL」与「同源 /dav/ 反代」两种 base（resolveBaseUrl）。
 *
 * 错误处理：所有失败统一抛 SyncError（code ∈ SyncErrorCode），
 * 由 engine 捕获后写入 SyncReport，本模块不与 UI 直接交互。
 */
import type { RemoteFileEntry, SyncErrorCode } from '@/types';

/** 可注入的 fetch 签名（测试用内存 mock，不再触网） */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** 同步域错误：code 直接映射到 SyncReport.error.code */
export class SyncError extends Error {
  readonly code: SyncErrorCode;

  readonly detail: unknown;

  constructor(code: SyncErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.detail = detail;
    Object.setPrototypeOf(this, SyncError.prototype);
  }
}

export interface WebdavConfig {
  /** 已解析好的请求 base，末尾必须带 `/`（见 remoteFiles.resolveBaseUrl） */
  baseUrl: string;
  username: string;
  password: string;
  /** 单请求超时毫秒数 */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 15_000;

/** Basic 认证头（TextEncoder 处理非 ASCII 用户名，避免 btoa 直接抛错） */
export function authHeader(username: string, password: string): string {
  const raw = `${username}:${password}`;
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `Basic ${btoa(binary)}`;
}

/** 从 XML 元素里按 localName 找第一个直接/后代子节点的文本 */
function firstText(element: Element, localName: string): string | null {
  const first = element.getElementsByTagNameNS('*', localName).item(0);
  if (first === null) {
    return null;
  }
  const text = first.textContent;
  return text === null || text.trim() === '' ? null : text.trim();
}

/** PROPFIND 的 multistatus 解析。命名空间无关，只看 localName。 */
export function parseMultistatus(xml: string): RemoteFileEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new SyncError('PARSE', 'PROPFIND 返回内容不是合法 XML', xml.slice(0, 200));
  }
  const entries: RemoteFileEntry[] = [];
  const responses = doc.getElementsByTagNameNS('*', 'response');
  for (let index = 0; index < responses.length; index += 1) {
    const response = responses.item(index);
    if (response === null) {
      continue;
    }
    const href = firstText(response, 'href') ?? '';
    const name = decodeURIComponent(href.split('/').filter((part) => part !== '').pop() ?? '');
    if (name === '') {
      continue;
    }
    const isDirectory = response.getElementsByTagNameNS('*', 'collection').length > 0;
    const lengthText = firstText(response, 'getcontentlength');
    entries.push({
      name,
      etag: firstText(response, 'getetag'),
      lastModified: firstText(response, 'getlastmodified'),
      contentLength: lengthText === null ? null : Number(lengthText),
      isDirectory,
    });
  }
  return entries;
}

/** 默认 fetch（保留独立函数便于注入测试） */
function defaultFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init);
}

export class WebdavClient {
  private readonly config: Required<WebdavConfig>;

  private readonly fetchImpl: FetchLike;

  constructor(config: WebdavConfig, fetchImpl: FetchLike = defaultFetch) {
    this.config = {
      baseUrl: config.baseUrl,
      username: config.username,
      password: config.password,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
    this.fetchImpl = fetchImpl;
  }

  /** 拼出完整请求 URL；文件名逐段 encodeURIComponent（兼容中文目录） */
  private urlOf(name: string): string {
    const encoded = name.split('/').map((part) => encodeURIComponent(part)).join('/');
    return this.config.baseUrl + encoded;
  }

  /**
   * 统一请求入口：超时、错误码映射。
   * 401/403 → AUTH；5xx 与其余 4xx → PROXY；超时/连接失败 → NETWORK。
   */
  private async request(
    method: string,
    name: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(this.urlOf(name), {
        ...init,
        method,
        signal: controller.signal,
        headers: {
          Authorization: authHeader(this.config.username, this.config.password),
          ...asHeaderRecord(init.headers),
        },
      });
      if (response.status === 401 || response.status === 403) {
        throw new SyncError('AUTH', 'WebDAV 认证失败', { status: response.status, name });
      }
      // 404 不算错误：GET（远端无文件）与 DELETE（本就无此文件）都是正常路径
      if (response.status >= 400 && response.status !== 404) {
        throw new SyncError(
          'PROXY',
          'WebDAV 请求失败',
          { status: response.status, name, method },
        );
      }
      return response;
    } catch (error) {
      if (error instanceof SyncError) {
        throw error;
      }
      if (isAbortError(error)) {
        throw new SyncError('NETWORK', 'WebDAV 请求超时', { name, method });
      }
      throw new SyncError('NETWORK', 'WebDAV 连接失败', {
        name,
        method,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** PROPFIND Depth:1，列出根目录下的文件（目录条目已过滤） */
  async list(): Promise<RemoteFileEntry[]> {
    const response = await this.request('PROPFIND', '', {
      headers: { Depth: '1' },
    });
    const xml = await response.text();
    return parseMultistatus(xml).filter((entry) => !entry.isDirectory);
  }

  /** GET 文本内容；404 返回 null（首次同步远端为空是正常路径） */
  async getText(name: string): Promise<string | null> {
    const response = await this.request('GET', name);
    if (response.status === 404) {
      return null;
    }
    return response.text();
  }

  /** PUT 覆盖写（无 ETag 服务端下不带 If-Match） */
  async putText(name: string, body: string): Promise<void> {
    await this.request('PUT', name, {
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  }

  /** DELETE；404 视为已删除，不报错 */
  async delete(name: string): Promise<void> {
    const response = await this.request('DELETE', name);
    if (response.status === 404) {
      return;
    }
    await response.arrayBuffer();
  }
}

function asHeaderRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (headers === undefined) {
    return {};
  }
  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}
