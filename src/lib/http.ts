/**
 * 原生感知的 fetch 封装。
 *
 * - 原生平台（iOS/Android）：走 CapacitorHttp（底层 NSURLSession / okHttp），
 *   不受 WKWebView 的 CORS 限制，可直连局域网 NAS 的 WebDAV 与大模型 API；
 * - 桌面（Electron）：走主进程 net 网络桥（tdxl:http-request），
 *   主进程请求无 CORS / 无混合内容限制，可直连局域网 http://；
 * - Web / PWA：回落到全局 fetch（仍走同源或反代逻辑）。
 *
 * 统一返回标准 `Response`，因此 WebDAV 客户端与 llm.ts 的 chat 都能直接复用，
 * 无需感知底层差异。
 */
import { Capacitor } from '@capacitor/core';
import { CapacitorHttp } from '@capacitor/core';
import { desktopApi, IS_DESKTOP } from '@/lib/desktop';
import type { FetchLike } from '@/lib/sync/webdav';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PROPFIND' | 'OPTIONS' | 'HEAD' | 'PATCH';

/** null-body 状态码：Response 构造器不允许携带 body，否则抛 TypeError */
const NULL_BODY_STATUS = new Set([204, 205, 304]);

/** 与全局 fetch abort 行为一致的异常（webdav.isAbortError 依赖 name === 'AbortError'） */
function toAbortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

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

/** RequestInit.body → 桥载荷的 string body；非 string 类型显式拒绝（防静默损坏） */
function toBodyString(init: RequestInit): string | undefined {
  if (typeof init.body === 'string') {
    return init.body;
  }
  if (init.body !== undefined && init.body !== null) {
    const kind = init.body instanceof Blob ? 'Blob' : (init.body.constructor?.name ?? typeof init.body);
    throw new TypeError(`桌面网络桥不支持 ${kind} 类型的请求 body`);
  }
  return undefined;
}

/**
 * 桌面分支：主进程网络桥。
 * signal abort 只在渲染侧竞速 reject（底层 IPC 请求不强制取消，结果被丢弃），
 * 抛出的 AbortError 由 webdav.isAbortError 映射为 NETWORK 超时。
 */
async function desktopFetch(url: string, init: RequestInit): Promise<Response> {
  const api = desktopApi();
  if (!api) {
    // 防御：声明为桌面但桥不可用时回落全局 fetch
    return fetch(url, init);
  }
  if (init.signal?.aborted) {
    return Promise.reject(toAbortError());
  }
  const pending = api
    .httpRequest({
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers: toHeadersRecord(init),
      body: toBodyString(init),
      timeoutMs: 15_000,
    })
    .then(
      (result) =>
        new Response(NULL_BODY_STATUS.has(result.status) ? null : result.body, {
          status: result.status,
          headers: result.headers,
        }),
    )
    .catch((error: unknown) => {
      // 与 fetch 网络失败行为一致：抛 TypeError，webdav.ts 映射为 NETWORK
      if (error instanceof TypeError) {
        throw error;
      }
      throw new TypeError(`桌面网络桥请求失败: ${error instanceof Error ? error.message : String(error)}`);
    });
  const signal = init.signal;
  if (!signal) {
    return pending;
  }
  return new Promise<Response>((resolve, reject) => {
    const onAbort = (): void => {
      reject(toAbortError());
    };
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
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
    return new Response(NULL_BODY_STATUS.has(res.status) ? null : body, {
      status: res.status,
      headers: res.headers as Record<string, string>,
    });
  }
  if (IS_DESKTOP) {
    return desktopFetch(url, init);
  }
  return fetch(url, init);
};
