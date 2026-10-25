/**
 * WebDAV 客户端单测：fetch 全部注入内存 mock，不触网。
 *
 * 覆盖：
 * - Basic 认证头与路径拼接（直连 URL / 同源 /dav/ 反代两种 base 形态）；
 * - PROPFIND XML 解析（目录条目过滤、字段提取）；
 * - 错误码映射：401→AUTH、5xx→PROXY、超时→NETWORK、XML 解析失败→PARSE；
 * - GET 404 → null（远端为空是正常路径）。
 */
import { describe, expect, it } from 'vitest';

import {
  authHeader,
  parseMultistatus,
  SyncError,
  WebdavClient,
  type FetchLike,
} from './webdav';
import { resolveBaseUrl } from './remoteFiles';

const CONFIG = {
  baseUrl: 'https://nas.example:5005/tdxl-sync/',
  username: 'dorry',
  password: 'p@ss 中文',
  timeoutMs: 200,
};

function makeClient(fetchImpl: FetchLike): WebdavClient {
  return new WebdavClient(CONFIG, fetchImpl);
}

function jsonResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

describe('authHeader', () => {
  it('Basic 头可正确编码非 ASCII 凭据', () => {
    const header = authHeader('dorry', 'p@ss 中文');
    expect(header.startsWith('Basic ')).toBe(true);
    const decoded = decodeURIComponent(escape(atob(header.slice(6))));
    expect(decoded).toBe('dorry:p@ss 中文');
  });
});

describe('WebdavClient', () => {
  it('GET 附加 Basic 认证头并返回内容', async () => {
    const seen: Array<{ url: string; auth: string | undefined }> = [];
    const client = makeClient(async (url, init) => {
      seen.push({ url, auth: new Headers(init.headers).get('Authorization') ?? undefined });
      return jsonResponse(200, 'hello');
    });
    const text = await client.getText('wordStates.devA.json');
    expect(text).toBe('hello');
    expect(seen[0]?.auth).toBe(authHeader('dorry', 'p@ss 中文'));
    expect(seen[0]?.url).toBe('https://nas.example:5005/tdxl-sync/wordStates.devA.json');
  });

  it('GET 404 返回 null（远端为空是正常路径）', async () => {
    const client = makeClient(async () => jsonResponse(404, 'not found'));
    await expect(client.getText('settings.json')).resolves.toBeNull();
  });

  it('PUT 成功（201 也视为成功）', async () => {
    const client = makeClient(async () => jsonResponse(201, ''));
    await expect(client.putText('meta.json', '{}')).resolves.toBeUndefined();
  });

  it('401 映射为 AUTH', async () => {
    const client = makeClient(async () => jsonResponse(401, 'unauthorized'));
    await expect(client.list()).rejects.toMatchObject({ code: 'AUTH' });
  });

  it('500 映射为 PROXY', async () => {
    const client = makeClient(async () => jsonResponse(500, 'oops'));
    await expect(client.getText('settings.json')).rejects.toMatchObject({ code: 'PROXY' });
  });

  it('连接失败映射为 NETWORK', async () => {
    const client = makeClient(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(client.putText('a.json', 'x')).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('超时映射为 NETWORK（AbortError）', async () => {
    const client = makeClient((_url, init) => {
      const signal = init.signal;
      if (signal === undefined || signal === null) {
        return Promise.reject(new TypeError('missing signal'));
      }
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    await expect(client.getText('slow.json')).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('PUT 抛出的 SyncError 原样透传（不被二次包装）', async () => {
    const client = makeClient(async () => jsonResponse(403, 'forbidden'));
    const error = await client.putText('a.json', 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncError);
    expect((error as SyncError).code).toBe('AUTH');
  });
});

describe('PROPFIND 解析', () => {
  const XML = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/tdxl-sync/wordStates.devA.json</D:href>
    <D:propstat>
      <D:prop>
        <D:getlastmodified>Mon, 26 Oct 2026 10:00:00 GMT</D:getlastmodified>
        <D:getcontentlength>123</D:getcontentlength>
        <D:getetag>"abc-1"</D:getetag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/tdxl-sync/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

  it('提取文件条目并标记目录（不过滤，由 list() 过滤）', () => {
    const entries = parseMultistatus(XML);
    expect(entries).toHaveLength(2);
    const file = entries[0];
    expect(file?.name).toBe('wordStates.devA.json');
    expect(file?.isDirectory).toBe(false);
    expect(file?.contentLength).toBe(123);
    expect(file?.etag).toBe('"abc-1"');
    expect(entries[1]?.name).toBe('tdxl-sync');
    expect(entries[1]?.isDirectory).toBe(true);
  });

  it('client.list() 会过滤目录条目', async () => {
    const client = makeClient(async () => jsonResponse(207, XML));
    const entries = await client.list();
    expect(entries.map((entry) => entry.name)).toEqual(['wordStates.devA.json']);
  });

  it('PROPFIND 返回非 XML 时抛 PARSE', async () => {
    const client = makeClient(async () => jsonResponse(207, '<html>not xml'));
    await expect(client.list()).rejects.toMatchObject({ code: 'PARSE' });
  });
});

describe('resolveBaseUrl（直连 / 反代两种 base 形态）', () => {
  const base = { webdavUrl: '', useProxy: false, proxyUrl: '' };

  it('直连：原样使用 webdavUrl 并补末尾斜杠', () => {
    expect(resolveBaseUrl({ ...base, webdavUrl: 'https://nas:5005/tdxl-sync' })).toBe(
      'https://nas:5005/tdxl-sync/',
    );
  });

  it('代理：proxyUrl（绝对地址）+ webdavUrl 的 pathname', () => {
    expect(
      resolveBaseUrl({
        ...base,
        webdavUrl: 'https://nas:5005/业务/tdxl-sync/',
        useProxy: true,
        proxyUrl: 'https://scf.example.com',
      }),
    ).toBe('https://scf.example.com/业务/tdxl-sync/');
  });

  it('同源反代：proxyUrl 为相对路径 /dav/ 时也按路径拼接', () => {
    expect(
      resolveBaseUrl({
        ...base,
        webdavUrl: 'https://nas:5005/业务/tdxl-sync/',
        useProxy: true,
        proxyUrl: '/dav/',
      }),
    ).toBe('/dav/业务/tdxl-sync/');
  });

  it('useProxy=true 但 proxyUrl 为空：回退直连', () => {
    expect(
      resolveBaseUrl({ ...base, webdavUrl: 'https://nas:5005/tdxl-sync/', useProxy: true, proxyUrl: ' ' }),
    ).toBe('https://nas:5005/tdxl-sync/');
  });
});
