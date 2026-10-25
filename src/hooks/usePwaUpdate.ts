/**
 * Service Worker 更新检测（ARCHITECTURE 8.4）。
 *
 * 目标：**用户不能长期跑旧版本，但更新不能打断正在进行的会话。**
 *
 * 本批次只把钩子搭好：
 * - `registerType: 'prompt'`，绝不自动 skipWaiting；
 * - 若检测到更新时正处于 `/study` 或 `/attempt`，只置 `pendingUpdate`，不弹条；
 * - 退出会话（路由离开）后自动把提示放出来；
 * - 每 30 分钟 + 页面重新可见时触发一次 `registration.update()`。
 *
 * 具体的「会话结束再提示」联动在批次 2 接入 sessionStore 后补完。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useRegisterSW } from 'virtual:pwa-register/react';

import { isSessionRoute } from '@/constants/routes';
import { useUiStore } from '@/store/uiStore';

/** SW 更新检查间隔：30 分钟 */
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

export interface PwaUpdateApi {
  /** 是否有待应用的新版本，且当前允许提示用户 */
  needRefresh: boolean;
  /** 首次离线缓存是否已就绪 */
  offlineReady: boolean;
  /** 应用更新（skipWaiting + reload） */
  applyUpdate: () => void;
  /** 本次先不更新 */
  dismiss: () => void;
}

export function usePwaUpdate(): PwaUpdateApi {
  const location = useLocation();
  const [offlineReady, setOfflineReady] = useState(false);
  const setUpdateReady = useUiStore((state) => state.setUpdateReady);
  const setPendingUpdate = useUiStore((state) => state.setPendingUpdate);
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      registrationRef.current = registration;
      if (!registration) {
        return;
      }
      // 定时检查 + 回到前台时检查（iOS 上定时器会被节流，所以要两条路径）
      window.setInterval(() => {
        void registration.update();
      }, UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void registration.update();
        }
      });
    },
    onRegisterError() {
      // SW 注册失败不影响应用使用，只是失去离线能力；不打扰用户
    },
    onNeedRefresh() {
      if (isSessionRoute(window.location.pathname)) {
        // 会话中：只记录，不打断
        setPendingUpdate(true);
        return;
      }
      setNeedRefresh(true);
    },
    onOfflineReady() {
      setOfflineReady(true);
    },
  });

  // 把「可提示更新」同步到全局状态，供设置页等入口展示
  useEffect(() => {
    setUpdateReady(needRefresh);
  }, [needRefresh, setUpdateReady]);

  // 离开会话路由后，把之前压住的更新提示放出来
  useEffect(() => {
    if (isSessionRoute(location.pathname)) {
      return;
    }
    if (useUiStore.getState().pendingUpdate) {
      setPendingUpdate(false);
      setNeedRefresh(true);
    }
  }, [location.pathname, setNeedRefresh, setPendingUpdate]);

  const applyUpdate = useCallback(() => {
    void updateServiceWorker(true);
  }, [updateServiceWorker]);

  const dismiss = useCallback(() => {
    setNeedRefresh(false);
  }, [setNeedRefresh]);

  return { needRefresh, offlineReady, applyUpdate, dismiss };
}
