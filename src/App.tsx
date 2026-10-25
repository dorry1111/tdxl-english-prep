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

export default function App() {
  const { needRefresh, offlineReady, applyUpdate, dismiss } = usePwaUpdate();
  const showInfo = useUiStore((state) => state.toast.info);

  // 首次离线缓存就绪时提示一次（真实事件，不是假数据）
  useEffect(() => {
    if (offlineReady) {
      showInfo(UPDATE.offlineReady);
    }
  }, [offlineReady, showInfo]);

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
