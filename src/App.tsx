/**
 * 应用根组件：布局骨架 + 路由出口 + 全局浮层。
 *
 * 全局副作用只在这里注册一次（ARCHITECTURE 7.8）：PWA 更新检测。
 */
import { useEffect } from 'react';

import { ErrorBoundary } from '@/components/feedback/ErrorBoundary';
import { AppShell } from '@/components/layout/AppShell';
import { ToastContainer } from '@/components/ui/Toast';
import { UpdatePrompt } from '@/components/ui/UpdatePrompt';
import { UPDATE } from '@/constants';
import { usePwaUpdate } from '@/hooks/usePwaUpdate';
import { AppRoutes } from '@/router';
import { useUiStore } from '@/store/uiStore';
import { maybeAutoSync } from '@/lib/sync/autorun';

export default function App() {
  const { needRefresh, offlineReady, applyUpdate, dismiss } = usePwaUpdate();
  const showInfo = useUiStore((state) => state.toast.info);

  // 首次离线缓存就绪时提示一次（真实事件，不是假数据）
  useEffect(() => {
    if (offlineReady) {
      showInfo(UPDATE.offlineReady);
    }
  }, [offlineReady, showInfo]);

  // 启动即尝试一次自动同步（已配置 NAS 时静默拉取最新进度）；之后每 5 分钟兜底一次
  useEffect(() => {
    void maybeAutoSync();
    const timer = setInterval(() => void maybeAutoSync(), 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <ErrorBoundary>
      <AppShell>
        <AppRoutes />
      </AppShell>
      <ToastContainer />
      <UpdatePrompt visible={needRefresh} onUpdate={applyUpdate} onDismiss={dismiss} />
    </ErrorBoundary>
  );
}
