/**
 * 「连接 NAS」自动探测（v1.9.0）。
 *
 * 目标：用户点一个按钮即完成同步配置——不填地址、不填账号密码。
 *
 * 探测管线（按成本从低到高，任一步命中即止）：
 * 1. 上次成功地址（settings.webdavUrl 的 origin，重装/换网后先试它）；
 * 2. 同源（仅 PWA：页面本身就跑在 NAS 上，/dav/ 反代同源可达，秒连）；
 * 3. mDNS 发现（仅原生壳：NasDiscovery 插件，发现主机后试 8100 端口的应用反代）；
 * 4. 局域网子网扫描（桌面版：主进程读本机 IPv4 → 对所在 /24 扫 8100 端口；
 *    原生壳在 mDNS 落空时按上次地址的网段兜底扫一遍）。
 *
 * 身份校验：对候选 origin 的 /dav/ 发 PROPFIND（Depth:0），
 * 只有本项目部署的 NAS nginx 反代会返回 207 —— 天然防误连别人家的设备。
 *
 * 凭据：局域网自用部署（Boss杜 拍板「不要账号密码」），
 * 账号密码使用部署默认值自动写入本机 secrets，用户全程无输入。
 * NAS 侧 /dav/ 反代未来可在 nginx 层注入固定凭据（见 deploy/nginx.conf），
 * 届时客户端凭据仅作直连 WebDAV 的冗余。
 */
import { NasDiscovery, type NasService } from '@/lib/nasDiscovery';
import { nativeAwareFetch } from '@/lib/http';
import { authHeader } from '@/lib/sync/webdav';

/** NAS 上 tdxl-pwa 反代容器的应用端口（PWA 静态 + /dav/ WebDAV 同一容器） */
export const NAS_APP_PORT = 8100;

/** 局域网自用部署的固定凭据（写入本机 secrets 表，用户无感） */
export const NAS_DAV_USER = 'dorry';
export const NAS_DAV_PASSWORD = 'durui0928';

/** 单个候选的探测超时（扫描时每个请求都很短，快速失败） */
const VERIFY_TIMEOUT_MS = 2500;
const SCAN_TIMEOUT_MS = 800;

/** 子网扫描并发数 */
const SCAN_CONCURRENCY = 32;

export type ConnectSource = 'last-known' | 'same-origin' | 'mdns' | 'scan';

export interface ConnectProgress {
  (stage: string): void;
}

export interface ConnectSuccess {
  ok: true;
  origin: string;
  source: ConnectSource;
}

export interface ConnectFailure {
  ok: false;
  /** 失败时已尝试到哪一步，供 UI 给出具体原因 */
  stages: string[];
}

export type ConnectResult = ConnectSuccess | ConnectFailure;

export interface ConnectDeps {
  /** 上次配置的 webdavUrl（取 origin 作为首个候选），可为空串 */
  lastKnownUrl?: string;
  /** 是否网页形态（PWA/浏览器）——决定同源候选与是否允许跨域扫描 */
  isWeb?: boolean;
  /** 是否原生壳——决定 mDNS 候选 */
  isNative?: boolean;
  /** 是否桌面壳——决定子网扫描（主进程读本机 IP） */
  isDesktop?: boolean;
  /** 桌面壳读本机 IPv4（注入便于测试；默认走 window.tdxl.getLanIps） */
  getLanIps?: () => Promise<string[]>;
  fetchImpl?: typeof fetch;
  onProgress?: ConnectProgress;
}

/** 提取 origin（scheme://host:port），非法 URL 返回 null */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * 校验候选 origin 是否为本项目的 NAS 反代：
 * PROPFIND {origin}/dav/ Depth:0 → 207 视为命中。
 * 任何失败（网络/404/401/超时）都视为未命中，绝不抛出。
 */
export async function verifyNasOrigin(origin: string, fetchImpl: typeof fetch): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${origin}/dav/`, {
      method: 'PROPFIND',
      signal: controller.signal,
      headers: {
        Depth: '0',
        Authorization: authHeader(NAS_DAV_USER, NAS_DAV_PASSWORD),
      },
    });
    // 读完 body 释放连接
    await response.arrayBuffer();
    return response.status === 207;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 生成 /24 网段内除本机外的候选 origin 列表（仅 http:8100） */
export function subnetCandidates(lanIp: string): string[] {
  const match = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})$/.exec(lanIp);
  if (!match) {
    return [];
  }
  const prefix = match[1];
  const candidates: string[] = [];
  for (let host = 1; host <= 254; host += 1) {
    candidates.push(`http://${prefix}.${host}:${NAS_APP_PORT}`);
  }
  return candidates;
}

/** 并发跑完候选列表，返回第一个通过校验的 origin（全部失败返回 null）——见 scanSubnets */
/**
 * 子网扫描（带首个命中即返回语义）。
 * 独立于 raceVerify 的简化实现：分批并发，命中立即短路。
 */
async function scanSubnets(
  lanIps: string[],
  fetchImpl: typeof fetch,
  onProgress?: ConnectProgress,
): Promise<string | null> {
  const seenPrefixes = new Set<string>();
  const candidates: string[] = [];
  for (const ip of lanIps) {
    const match = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip);
    const prefix = match?.[1];
    if (prefix !== undefined && !seenPrefixes.has(prefix)) {
      seenPrefixes.add(prefix);
      candidates.push(...subnetCandidates(`${prefix}.1`));
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  const queue = [...candidates];
  let hit: string | null = null;
  const worker = async (): Promise<void> => {
    while (hit === null) {
      const candidate = queue.shift();
      if (candidate === undefined) {
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
      try {
        const response = await fetchImpl(`${candidate}/dav/`, {
          method: 'PROPFIND',
          signal: controller.signal,
          headers: {
            Depth: '0',
            Authorization: authHeader(NAS_DAV_USER, NAS_DAV_PASSWORD),
          },
        });
        await response.arrayBuffer();
        if (response.status === 207) {
          hit = candidate;
        }
      } catch {
        /* 未命中，继续 */
      } finally {
        clearTimeout(timer);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, candidates.length) }, () => worker()),
  );
  void onProgress;
  return hit;
}

/** mDNS 发现主机（5 秒窗口），展开为候选 origin（该主机的 8100 端口优先） */
async function mdnsCandidateOrigins(fetchImpl: typeof fetch): Promise<string[]> {
  const services: NasService[] = [];
  try {
    const handle = await NasDiscovery.addListener('serviceFound', (s: NasService) => {
      if (!services.some((p) => p.host === s.host)) {
        services.push(s);
      }
    });
    await NasDiscovery.startDiscovery({ types: ['_http._tcp', '_https._tcp', '_webdav._tcp'] });
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await NasDiscovery.stopDiscovery();
    handle.remove();
  } catch {
    return [];
  }
  const origins: string[] = [];
  for (const service of services) {
    // 应用反代端口优先（/dav/ 只在它上面）
    origins.push(`http://${service.host}:${NAS_APP_PORT}`);
    // 兜底：发现的服务端口本身也试一次（万一未来 WebDAV 直接开放同步目录）
    origins.push(`${service.scheme}://${service.host}:${service.port}`);
  }
  // 逐个校验（mDNS 候选少，串行即可）
  for (const origin of origins) {
    if (await verifyNasOrigin(origin, fetchImpl)) {
      return [origin];
    }
  }
  return [];
}

/**
 * 执行「连接 NAS」探测管线。
 * 命中后由调用方（SyncCard）写配置；本函数只负责找到 origin。
 */
export async function connectNas(deps: ConnectDeps = {}): Promise<ConnectResult> {
  const fetchImpl: typeof fetch =
    deps.fetchImpl ?? ((url, init) => nativeAwareFetch(String(url), init ?? {}));
  const onProgress = deps.onProgress;
  const stages: string[] = [];
  const step = async (
    label: string,
    candidate: string | null,
    source: ConnectSource,
  ): Promise<ConnectSuccess | null> => {
    if (candidate === null) {
      return null;
    }
    onProgress?.(label);
    if (await verifyNasOrigin(candidate, fetchImpl)) {
      return { ok: true, origin: candidate, source };
    }
    return null;
  };

  // ① 上次成功地址
  stages.push('上次地址');
  const lastKnown = originOf(deps.lastKnownUrl ?? '');
  const lastHit = await step('尝试上次连接的地址…', lastKnown, 'last-known');
  if (lastHit) {
    return lastHit;
  }

  // ② 同源（仅网页形态，且非 localhost 开发环境）
  const isWeb = deps.isWeb ?? (typeof window !== 'undefined' && !deps.isNative && !deps.isDesktop);
  const sameOrigin =
    isWeb && typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol) &&
    !/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
      ? window.location.origin
      : null;
  stages.push('同源');
  const sameHit = await step('检测当前页面所在服务器…', sameOrigin, 'same-origin');
  if (sameHit) {
    return sameHit;
  }

  // ③ mDNS（仅原生壳）
  if (deps.isNative === true) {
    stages.push('mDNS');
    onProgress?.('正在扫描局域网内的 NAS 设备…');
    const [mdnsHit] = await mdnsCandidateOrigins(fetchImpl);
    if (mdnsHit) {
      return { ok: true, origin: mdnsHit, source: 'mdns' };
    }
  }

  // ④ 子网扫描（桌面壳用主进程 IP；原生壳用上次地址网段兜底）
  let lanIps: string[] = [];
  if (deps.isDesktop === true) {
    const getLanIps =
      deps.getLanIps ?? (() => window.tdxl?.getLanIps() ?? Promise.resolve([]));
    try {
      lanIps = await getLanIps();
    } catch {
      lanIps = [];
    }
  } else if (deps.isNative === true && lastKnown) {
    // 原生壳 mDNS 落空：按上次地址网段兜底
    try {
      const parsed = new URL(lastKnown);
      lanIps = [parsed.hostname];
    } catch {
      lanIps = [];
    }
  }
  if (lanIps.length > 0) {
    stages.push('子网扫描');
    onProgress?.('正在扫描局域网（约 10~30 秒）…');
    const scanHit = await scanSubnets(lanIps, fetchImpl, onProgress);
    if (scanHit) {
      return { ok: true, origin: scanHit, source: 'scan' };
    }
  }

  return { ok: false, stages };
}

/**
 * 把命中的 origin 写入同步配置（免输入）：
 * - PWA：走同源反代（跨端口会被浏览器拦）→ useProxy + '/dav/'，webdavUrl 仅作地址记录；
 * - 桌面/原生：无跨域限制 → 直连反代地址 webdavUrl = {origin}/dav/；
 * - 账号密码用部署默认值自动写入，syncEnabled 直接开启。
 */
export interface ConnectionPatch {
  syncEnabled: true;
  webdavUrl: string;
  webdavUser: string;
  useProxy: boolean;
  proxyUrl: string;
}

export function connectionPatchFor(origin: string, form: 'web' | 'direct'): ConnectionPatch {
  if (form === 'web') {
    return {
      syncEnabled: true,
      webdavUrl: `${origin}/`,
      webdavUser: NAS_DAV_USER,
      useProxy: true,
      proxyUrl: '/dav/',
    };
  }
  return {
    syncEnabled: true,
    webdavUrl: `${origin}/dav/`,
    webdavUser: NAS_DAV_USER,
    useProxy: false,
    proxyUrl: '',
  };
}
