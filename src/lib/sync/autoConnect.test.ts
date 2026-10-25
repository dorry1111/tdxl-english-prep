/**
 * autoConnect 单元测试（v1.9.0 一键连接 NAS）。
 *
 * fetch 全部内存 mock，不触网：
 * - 207 视为 NAS 反代命中；404/网络错误视为未命中；
 * - 管线顺序：上次地址 → 同源 →（原生 mDNS / 桌面子网扫描）；
 * - connectionPatchFor 按 web / direct 两种形态成形；
 * - originOf / subnetCandidates 纯函数边界。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectionPatchFor,
  connectNas,
  originOf,
  subnetCandidates,
  verifyNasOrigin,
} from './autoConnect';

/** 构造可编程 fetch：url → 状态码（未注册的路由一律抛网络错误） */
function makeFetch(routes: Record<string, number>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const status = routes[url];
    if (status === undefined) {
      throw new TypeError('Failed to fetch');
    }
    return new Response(null, { status });
  }) as unknown as typeof fetch;
}

describe('originOf', () => {
  it('提取 http/https origin；非法或非 http 返回 null', () => {
    expect(originOf('http://192.168.31.239:8100/dav/')).toBe('http://192.168.31.239:8100');
    expect(originOf('https://nas.example.com/')).toBe('https://nas.example.com');
    expect(originOf('')).toBeNull();
    expect(originOf('not a url')).toBeNull();
    expect(originOf('ftp://192.168.31.239/')).toBeNull();
  });
});

describe('subnetCandidates', () => {
  it('生成 /24 网段 1~254 的 8100 端口候选', () => {
    const candidates = subnetCandidates('192.168.31.100');
    expect(candidates).toHaveLength(254);
    expect(candidates[0]).toBe('http://192.168.31.1:8100');
    expect(candidates[253]).toBe('http://192.168.31.254:8100');
  });
  it('非 IPv4 点分格式返回空', () => {
    expect(subnetCandidates('fe80::1')).toEqual([]);
    expect(subnetCandidates('')).toEqual([]);
  });
});

describe('verifyNasOrigin', () => {
  it('PROPFIND 207 → true', async () => {
    const fetchImpl = makeFetch({ 'http://192.168.31.239:8100/dav/': 207 });
    await expect(verifyNasOrigin('http://192.168.31.239:8100', fetchImpl)).resolves.toBe(true);
  });
  it('404 / 网络错误 → false（不抛出）', async () => {
    const notFound = makeFetch({ 'http://10.0.0.1:8100/dav/': 404 });
    await expect(verifyNasOrigin('http://10.0.0.1:8100', notFound)).resolves.toBe(false);
    const broken = makeFetch({});
    await expect(verifyNasOrigin('http://10.0.0.2:8100', broken)).resolves.toBe(false);
  });
});

describe('connectionPatchFor', () => {
  it('web 形态：同源反代 useProxy + /dav/，webdavUrl 仅记录 origin', () => {
    expect(connectionPatchFor('http://192.168.31.239:8100', 'web')).toEqual({
      syncEnabled: true,
      webdavUrl: 'http://192.168.31.239:8100/',
      webdavUser: 'dorry',
      useProxy: true,
      proxyUrl: '/dav/',
    });
  });
  it('direct 形态（桌面/原生）：直连 {origin}/dav/', () => {
    expect(connectionPatchFor('http://192.168.31.239:8100', 'direct')).toEqual({
      syncEnabled: true,
      webdavUrl: 'http://192.168.31.239:8100/dav/',
      webdavUser: 'dorry',
      useProxy: false,
      proxyUrl: '',
    });
  });
});

describe('connectNas 管线', () => {
  const dav = (origin: string): string => `${origin}/dav/`;

  it('① 上次地址命中：不再探测后续阶段', async () => {
    const fetchImpl = makeFetch({ [dav('http://192.168.31.239:8100')]: 207 });
    const result = await connectNas({
      lastKnownUrl: 'http://192.168.31.239:8100/dav/',
      isWeb: false,
      isDesktop: true,
      getLanIps: async () => ['192.168.31.100'],
      fetchImpl,
    });
    expect(result).toEqual({ ok: true, origin: 'http://192.168.31.239:8100', source: 'last-known' });
  });

  it('② 网页形态同源命中（非 localhost）', async () => {
    const fetchImpl = makeFetch({ 'http://192.168.31.239:8100/dav/': 207 });
    vi.stubGlobal('window', {
      location: { protocol: 'http:', hostname: '192.168.31.239', origin: 'http://192.168.31.239:8100' },
      tdxl: undefined,
    });
    try {
      const result = await connectNas({ lastKnownUrl: '', isWeb: true, fetchImpl });
      expect(result).toEqual({
        ok: true,
        origin: 'http://192.168.31.239:8100',
        source: 'same-origin',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('② localhost 开发环境不把本机 dev server 当 NAS', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:5173' },
      tdxl: undefined,
    });
    try {
      const fetchImpl = makeFetch({}); // 全部网络错误
      const result = await connectNas({ lastKnownUrl: '', isWeb: true, fetchImpl });
      expect(result.ok).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('④ 桌面子网扫描命中（mDNS 不适用）', async () => {
    const hitOrigin = 'http://192.168.31.239:8100';
    const fetchImpl = makeFetch({ [dav(hitOrigin)]: 207 });
    const result = await connectNas({
      lastKnownUrl: '',
      isWeb: false,
      isDesktop: true,
      getLanIps: async () => ['192.168.31.100'],
      fetchImpl,
    });
    expect(result).toEqual({ ok: true, origin: hitOrigin, source: 'scan' });
  });

  it('全部阶段落空 → ok:false 且 stages 记录尝试轨迹', async () => {
    const fetchImpl = makeFetch({});
    const result = await connectNas({
      lastKnownUrl: '',
      isWeb: false,
      isDesktop: true,
      getLanIps: async () => ['192.168.31.100'],
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stages).toContain('上次地址');
      expect(result.stages).toContain('子网扫描');
    }
  });

  it('onProgress 逐步收到阶段文案', async () => {
    const stages: string[] = [];
    const fetchImpl = makeFetch({});
    await connectNas({
      lastKnownUrl: '',
      isWeb: false,
      isDesktop: true,
      getLanIps: async () => ['192.168.31.100'],
      fetchImpl,
      onProgress: (stage) => stages.push(stage),
    });
    expect(stages.length).toBeGreaterThanOrEqual(1);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
});
