/**
 * 应用入口。
 *
 * 启动顺序（有意为之）：
 * 1. 先装性能探针（`?perf=1` 时才生效），必须在挂载前，才能抓到首屏与首次交互；
 * 2. 恢复主题，避免深色模式下闪白；
 * 3. 挂载 React（首屏不依赖任何网络请求与数据库，断网也能进首页）；
 * 4. 后台初始化数据库与种子数据，失败时用 Toast 告知（无痕模式降级提示）；
 * 5. 首屏之后再调度空闲预热（词库索引 + 语音列表），不阻塞交互。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router';

import App from '@/App';
import { DB } from '@/constants';
import { runDbSelfTest } from '@/db/selfTest';
import { ensureSeeded } from '@/db/seed';
import { IS_DESKTOP } from '@/lib/desktop';
import { toUserMessage } from '@/lib/errors';
import { whenIdle } from '@/lib/idle';
import { installPerfProbe, perfMark } from '@/lib/perf';
import { scheduleWarmup } from '@/lib/warmup';
import { useUiStore, initTheme } from '@/store/uiStore';

import '@/styles/tokens.css';
import '@/styles/app.css';
import '@/styles/desktop.css';

// 性能探针：不带 ?perf=1 时为空操作（不注册监听、不输出日志）
installPerfProbe();

/** 恢复主题（localStorage → <html class="dark">） */
initTheme();

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root 容器不存在，index.html 可能被改动过');
}

// 桌面版走 tdxl:// 自定义协议，BrowserRouter 的 history API 不可靠，改 Hash 路由
const Router = IS_DESKTOP ? HashRouter : BrowserRouter;

createRoot(container).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
);

// 首帧提交后再打点，用于 `?perf=1` 的「首屏可交互」对照
requestAnimationFrame(() => {
  perfMark('perf:app-painted');
});

// 首屏渲染之后再做空闲预热（词库索引 + 语音列表），不阻塞交互、失败静默
scheduleWarmup();

/**
 * 后台启动任务。
 *
 * 不阻塞首屏渲染：即使数据库不可用，路由与页面依然可进入，
 * 用户看到的是「无法保存进度」的明确提示，而不是白屏（ARCHITECTURE 8.3）。
 *
 * 顺序要求：`ensureSeeded()` 必须先完成（设置/词库元信息是页面数据的前置），
 * 而 `runDbSelfTest()` 只是一次「开库→写→读回→删」的探测，结果仅用于
 * 无痕模式提示，因此挪到空闲时段执行——否则它会和用户进入学习页的第一批
 * 读库操作排在同一条 IndexedDB 队列上，冷启动时把首交互顶后。
 */
async function bootstrap(): Promise<void> {
  try {
    const seedResult = await ensureSeeded();
    // iOS 一次性迁移把云同步打开时提示一次（旧版升级用户需要知道这个变化）
    if (seedResult.iosSyncEnabled) {
      useUiStore.getState().toast.success('已为你开启云同步');
    }
  } catch (error) {
    useUiStore.getState().toast.error(toUserMessage(error));
    console.error('[db] 初始化失败：', error);
    return;
  }

  whenIdle(() => {
    void reportDbSelfTest();
  }, 1500);
}

/** 数据层自检 + 失败提示（空闲执行，不阻塞首交互） */
async function reportDbSelfTest(): Promise<void> {
  try {
    const result = await runDbSelfTest();
    if (!result.ok) {
      useUiStore.getState().toast.error(DB.privateModeWarning);
      console.warn('[db] 自检失败：', result.steps);
    }
  } catch (error) {
    console.error('[db] 自检异常：', error);
  }
}

if (import.meta.env.DEV) {
  // 开发模式下暴露自检函数，便于在控制台/真机 Safari 远程调试时手动验证
  window.__tdxlDbSelfTest = runDbSelfTest;
}

void bootstrap();
