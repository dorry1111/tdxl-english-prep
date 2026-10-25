import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

/** 从 package.json 读版本号，注入 __APP_VERSION__ 供「我的 → 关于」卡片展示 */
const APP_VERSION = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
  ) as { version: string }
).version;

/**
 * Vite 配置。
 *
 * 关键点（对应 ARCHITECTURE 第 1、8 章）：
 * - 路径别名 `@/*` 必须与 tsconfig.json 的 paths 保持一致；
 * - Tailwind 走 PostCSS 模式，不在此处引入；
 * - PWA 采用 `registerType: 'prompt'`，更新由用户确认，避免打断学习会话；
 * - `navigateFallbackDenylist` 排除 `/data/`，词库 JSON 不走 HTML 兜底；
 * - **双形态**：`--mode desktop` 时输出 dist-desktop/（base=./、无 Service Worker），
 *   供 Electron 加载 file:// 使用；普通构建保持 PWA 行为不变。
 */
export default defineConfig(({ mode }) => {
  const isDesktop = mode === 'desktop';

  return {
    // 全局常量：版本号进 bundle，「我的 → 关于」直接展示，避免运行时再读文件
    define: {
      __APP_VERSION__: JSON.stringify(APP_VERSION),
    },
    plugins: [
      react(),
      // 桌面形态不开 PWA：file:// 下 Service Worker 无法注册，还会污染缓存
      ...(isDesktop
        ? []
        : [
            VitePWA({
              registerType: 'prompt',
              includeAssets: ['favicon.svg', 'icons/apple-touch-icon-180.png'],
              manifest: {
                id: '/',
                name: '同等学力英语备考',
                short_name: '同等学力备考',
                description: '同等学力申硕英语备考工具：背单词、真题模拟、进度同步，离线可用。',
                lang: 'zh-CN',
                start_url: '/',
                scope: '/',
                display: 'standalone',
                orientation: 'any',
                theme_color: '#0f8b8d',
                background_color: '#f6f8f9',
                categories: ['education', 'productivity'],
                icons: [
                  {
                    src: 'icons/icon-192.png',
                    sizes: '192x192',
                    type: 'image/png',
                    purpose: 'any',
                  },
                  {
                    src: 'icons/icon-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any',
                  },
                  {
                    src: 'icons/icon-maskable-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                  },
                ],
              },
              workbox: {
                // 词库分片与示范卷都进预缓存，保证断网也能背单词（ARCHITECTURE 8.4）
                globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
                cleanupOutdatedCaches: true,
                navigateFallback: 'index.html',
                navigateFallbackDenylist: [/^\/data\//],
                maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
              },
              devOptions: {
                enabled: true,
                type: 'module',
                navigateFallback: 'index.html',
              },
            }),
          ]),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // 桌面形态无 PWA 插件，虚拟模块换成空实现替身
        ...(isDesktop
          ? { 'virtual:pwa-register/react': fileURLToPath(new URL('./scripts/pwa-register-stub.ts', import.meta.url)) }
          : {}),
      },
    },
    server: {
      host: true,
      port: 5173,
    },
    preview: {
      host: true,
      port: 4173,
    },
    build: {
      // iOS 16.0+ Safari 是明确的支持下限（PRD 第 10 章）
      target: 'safari16',
      sourcemap: false,
      chunkSizeWarningLimit: 700,
      // 桌面版：相对路径 + 独立目录，Electron loadFile 直接指向
      base: isDesktop ? './' : '/',
      outDir: isDesktop ? 'dist-desktop' : 'dist',
    },
    test: {
      environment: 'jsdom',
      globals: false,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      passWithNoTests: true,
      restoreMocks: true,
    },
  };
});
