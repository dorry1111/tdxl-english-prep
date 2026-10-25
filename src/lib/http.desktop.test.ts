/**
 * http.ts 桌面网络桥分支测试（v1.9.1）。
 *
 * 场景：桌面（Electron）页面跑在 tdxl:// 安全源上，渲染进程 fetch 局域网
 * http:// 会被 CORS 预检与混合内容策略拦截，因此桌面分支必须把请求路由到
 * 主进程网络桥（window.tdxl.httpRequest），并保持与全局 fetch 一致的对外语义：
 * - 返回标准 Response（status/headers/text() 可用）；
 * - signal abort 抛 name === 'AbortError' 的 DOMException（webdav.isAbortError 依赖）；
 * - 底层失败抛 TypeError（webdav 映射为 NETWORK）。
 *
 * IS_DESKTOP 是模块级绑定：用 getter mock + 每个用例 resetModules + 动态
 * import 拿到干净模块实例（与 tts.native.test.ts 同一套路）。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { FetchLike } from '@/lib/sync/webdav';

/** 桌面形态标志与桥 API 的测试内可控状态 */
const desktopState = vi.hoisted(() => ({
  isDesktop: false,
  api: undefined as { isDesktop: true; httpRequest: Mock } | undefined,
}));

vi.mock('@/lib/desktop', () => ({
  get IS_DESKTOP() {
    return desktopState.isDesktop;
  },
  desktopApi: () => desktopState.api,
}));

/** httpRequest 桥替身（每次用例自行安排返回值） */
const httpRequest = vi.hoisted(() => vi.fn());

beforeEach(() => {
  desktopState.isDesktop = false;
  desktopState.api = undefined;
  httpRequest.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

/** 装配桌面环境并动态加载被测模块 */
async function loadHttp(): Promise<{ nativeAwareFetch: FetchLike }> {
  desktopState.isDesktop = true;
  desktopState.api = { isDesktop: true, httpRequest };
  return (await import('./http')) as { nativeAwareFetch: FetchLike };
}

describe('nativeAwareFetch 桌面网络桥分支', () => {
  it('桌面分支调用 httpRequest 且参数映射正确（method 大写、headers record、string body 透传）', async () => {
    httpRequest.mockResolvedValue({
      status: 207,
      headers: { 'content-type': 'application/xml; charset=utf-8' },
      body: '<?xml version="1.0"?><D:multistatus/>',
    });
    const { nativeAwareFetch } = await loadHttp();

    await nativeAwareFetch('http://192.168.31.2:8100/dav/', {
      method: 'propfind',
      headers: { Depth: '0', Authorization: 'Basic ZG9yeTpkdXJ1aTA5Mjg=' },
      body: '<propfind/>',
    });

    expect(httpRequest).toHaveBeenCalledTimes(1);
    expect(httpRequest).toHaveBeenCalledWith({
      url: 'http://192.168.31.2:8100/dav/',
      method: 'PROPFIND',
      headers: { Depth: '0', Authorization: 'Basic ZG9yeTpkdXJ1aTA5Mjg=' },
      body: '<propfind/>',
      timeoutMs: 15_000,
    });
  });

  it('无 method 时默认 GET，无 body 时不透传 body 字段', async () => {
    httpRequest.mockResolvedValue({ status: 200, headers: {}, body: 'ok' });
    const { nativeAwareFetch } = await loadHttp();

    await nativeAwareFetch('http://192.168.31.2:8100/api/health', {});

    expect(httpRequest).toHaveBeenCalledWith({
      url: 'http://192.168.31.2:8100/api/health',
      method: 'GET',
      headers: {},
      body: undefined,
      timeoutMs: 15_000,
    });
  });

  it('桥返回值包装成标准 Response（status/headers/text() 可读）', async () => {
    httpRequest.mockResolvedValue({
      status: 207,
      headers: { 'content-type': 'application/xml; charset=utf-8', dav: '1' },
      body: '<multistatus/>',
    });
    const { nativeAwareFetch } = await loadHttp();

    const res = await nativeAwareFetch('http://nas:8100/dav/', { method: 'PROPFIND' });

    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(207);
    expect(res.headers.get('dav')).toBe('1');
    await expect(res.text()).resolves.toBe('<multistatus/>');
  });

  it('signal 已 abort 时立即抛 AbortError 的 DOMException，且不触发底层请求', async () => {
    const { nativeAwareFetch } = await loadHttp();
    const controller = new AbortController();
    controller.abort();

    await expect(
      nativeAwareFetch('http://nas:8100/dav/', { method: 'PROPFIND', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      nativeAwareFetch('http://nas:8100/dav/', { method: 'PROPFIND', signal: controller.signal }),
    ).rejects.toBeInstanceOf(DOMException);
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('请求进行中 signal abort 时立即 reject（底层 IPC 结果被丢弃）', async () => {
    httpRequest.mockReturnValue(new Promise(() => {})); // 永不 resolve
    const { nativeAwareFetch } = await loadHttp();
    const controller = new AbortController();

    const pending = nativeAwareFetch('http://nas:8100/dav/', {
      method: 'PROPFIND',
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('204 等 null-body 状态码：Response body 为 null，text() 为空且不抛 TypeError', async () => {
    httpRequest.mockResolvedValue({ status: 204, headers: { dav: '1' }, body: '' });
    const { nativeAwareFetch } = await loadHttp();

    const res = await nativeAwareFetch('http://nas:8100/dav/', { method: 'PUT' });

    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    await expect(res.text()).resolves.toBe('');
  });

  it('非 string body（FormData/Blob 等）传入时抛 TypeError 且不触发底层请求', async () => {
    const { nativeAwareFetch } = await loadHttp();

    await expect(
      nativeAwareFetch('http://nas:8100/api', {
        method: 'POST',
        body: new Blob(['binary'], { type: 'application/octet-stream' }),
      }),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      nativeAwareFetch('http://nas:8100/api', { method: 'POST', body: new FormData() }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('httpRequest 拒绝（主进程网络失败）时抛 TypeError', async () => {
    httpRequest.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));
    const { nativeAwareFetch } = await loadHttp();

    await expect(
      nativeAwareFetch('http://nas:8100/dav/', { method: 'PROPFIND' }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('非桌面且非原生走全局 fetch', async () => {
    desktopState.isDesktop = false;
    desktopState.api = undefined;
    const fetchMock = vi.fn(async () => new Response('web', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { nativeAwareFetch } = await import('./http');

    const res = await nativeAwareFetch('https://example.com/api', { method: 'GET' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/api', { method: 'GET' });
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('web');
  });
});
