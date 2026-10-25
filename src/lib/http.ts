/**
 * 原生感知的 fetch 封装。
 *
 * - 原生平台（iOS/Android）：走 CapacitorHttp（底层 NSURLSession / okHttp），
 *   不受 WKWebView 的 CORS 限制，可直连局域网 NAS 的 WebDAV 与大模型 API；
 * - Web / PWA / Electron：回落到全局 fetch（仍走同源或反代逻辑）。
 *
 * 统一返回标准 `Response`，因此 WebDAV 客户端与 llm.ts 的 chat 都能直接复用，
 * 无需感知底层差异。
 */
import { Capacitor } from '@capacitor/core';
import { CapacitorHttp } from '@capacitor/core';
import type { FetchLike } from '@/lib/sync/webdav';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PROPFIND' | 'OPTIONS' | 'HEAD' | 'PATCH';

function toHeadersRecord(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const h = init?.headers;
  if (!h) {
    return out;
  }
  if (h instanceof Headers) {
    h.forEach((value, key) => {
      out[key] = value;
    });
  } else if (Array.isArray(h)) {
    for (const [key, value] of h as [string, string][]) {
      out[key] = value;
    }
  } else {
    for (const [key, value] of Object.entries(h)) {
      if (typeof value === 'string') {
        out[key] = value;
      }
    }
  }
  return out;
}

export const nativeAwareFetch: FetchLike = async (url, init = {}) => {
  if (Capacitor.isNativePlatform()) {
    const method = (init.method ?? 'GET').toUpperCase() as HttpMethod;
    const res = await CapacitorHttp.request({
      url,
      method,
      headers: toHeadersRecord(init),
      data: init.body as string | Record<string, unknown> | undefined,
      // 始终以文本返回，由调用方自行 JSON.parse（WebDAV XML / 大模型 JSON  alike）
      responseType: 'text',
      connectTimeout: 15_000,
      readTimeout: 30_000,
    });
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '');
    return new Response(body, {
      status: res.status,
      headers: res.headers as Record<string, string>,
    });
  }
  return fetch(url, init);
};
