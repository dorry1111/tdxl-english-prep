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
import { checkAndApplyDatasetUpdates } from '@/lib/dataset';
import { isNativePluginAvailable } from '@/lib/nativePlugins';
import { IS_NATIVE } from '@/lib/platform';
import { primeSpeechOnFirstGesture } from '@/lib/tts';

/** 原生插件自检清单（启动时各打一条日志；未注册是 v1.8.0 之前旧 IPA 的典型症状） */
const SELF_CHECK_PLUGINS: readonly string[] = ['TtsBridge', 'NasDiscovery'];

export default function App() {
  const { needRefresh, offlineReady, applyUpdate, dismiss } = usePwaUpdate();
  const showInfo = useUiStore((state) => state.toast.info);

  // Apple 平台（iOS/Safari PWA）的语音手势解锁在根组件挂载即注册：
  // 不依赖用户是否进入学习页，任何页面首次触摸都能解锁。
  // StudyPage 既有调用保留（幂等，不会重复绑定监听）。
  useEffect(() => {
    primeSpeechOnFirstGesture();
  }, []);

  // 原生插件自检（仅原生壳执行一次）：可用打 info，未注册打 warn——
  // 否则 JS 侧调用会抛 not implemented，且现场只有一条被吞掉的异常难排查
  useEffect(() => {
    if (!IS_NATIVE) {
      return;
    }
    for (const name of SELF_CHECK_PLUGINS) {
      if (isNativePluginAvailable(name)) {
        console.info(`[plugins] ${name} 可用`);
      } else {
        console.warn(`[plugins] ${name} 未注册（JS 调用会失败，请确认原生壳已 conform CAPBridgedPlugin）`);
      }
    }
  }, []);

  // 首次离线缓存就绪时提示一次（真实事件，不是假数据）
  useEffect(() => {
    if (offlineReady) {
      showInfo(UPDATE.offlineReady);
    }
  }, [offlineReady, showInfo]);

  // 启动即尝试一次自动同步 + 数据更新（已配置 NAS 时静默拉取最新进度/词包）；
  // 之后每 5 分钟兜底一次，连接上 NAS 即自动同步，无需手动触发
  useEffect(() => {
    void maybeAutoSync();
    void checkAndApplyDatasetUpdates();
    const timer = setInterval(() => {
      void maybeAutoSync();
      void checkAndApplyDatasetUpdates();
    }, 5 * 60 * 1000);
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
