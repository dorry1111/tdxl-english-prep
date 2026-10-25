/**
 * `virtual:pwa-register/react` 的桌面构建替身。
 *
 * Electron 桌面形态（vite --mode desktop）不注册 Service Worker，
 * VitePWA 插件被移除后虚拟模块不再存在，这里提供同签名空实现，
 * 让 usePwaUpdate() 在桌面版里变成无操作。
 */

export interface RegisterSWOptions {
  onRegisteredSW?: (_swUrl: string, _registration: unknown) => void;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisterError?: (_error: unknown) => void;
}

export function useRegisterSW(_options: RegisterSWOptions = {}): {
  offlineReady: [boolean, (value: boolean) => void];
  needRefresh: [boolean, (value: boolean) => void];
  updateServiceWorker: (_reloadPage?: boolean) => Promise<void>;
} {
  return {
    offlineReady: [false, () => undefined],
    needRefresh: [false, () => undefined],
    updateServiceWorker: () => Promise.resolve(),
  };
}
