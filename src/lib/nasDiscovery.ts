/**
 * NAS mDNS 发现插件的 TS 封装（对应 iOS 原生 NasDiscovery 插件）。
 *
 * 原生端扫描局域网 Bonjour 服务，解析出主机名/端口后通过 `serviceFound` 事件回传；
 * Web / PWA / 桌面端无原生插件，调用会抛错 —— 这些端走手动填写地址，不影响功能。
 */
import { registerPlugin } from '@capacitor/core';

export interface NasService {
  /** 服务显示名（如 fnOS 设备名） */
  name: string;
  /** 解析出的主机名（已去掉结尾点），配合 NAS 有效证书使用 */
  host: string;
  port: number;
  /** 服务类型，如 _webdav._tcp. */
  type: string;
  /** 建议协议：https / http */
  scheme: string;
}

export interface NasDiscoveryPlugin {
  startDiscovery(options: { types?: string[] }): Promise<void>;
  stopDiscovery(): Promise<void>;
  addListener(
    event: 'serviceFound',
    callback: (service: NasService) => void,
  ): Promise<{ remove: () => void }>;
}

export const NasDiscovery = registerPlugin<NasDiscoveryPlugin>('NasDiscovery');
