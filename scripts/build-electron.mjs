/**
 * Electron 侧构建脚本（Node 脚本，经 esbuild 打包主进程与 preload）。
 *
 * 输出：
 * - dist-electron/main.cjs    主进程
 * - dist-electron/preload.cjs 预加载
 *
 * esbuild 已随 vite 依赖安装，无需额外引入打包器。
 * electron / koffi 声明为 external：前者是运行时内置，后者必须留在
 * node_modules 里让 electron-builder 解包（asarUnpack）后加载 prebuilds。
 */
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: ['electron/main.ts'],
  external: ['electron', 'koffi'],
  outfile: 'dist-electron/main.cjs',
});

await build({
  ...common,
  entryPoints: ['electron/preload.ts'],
  external: ['electron'],
  outfile: 'dist-electron/preload.cjs',
});

console.log('[electron] main + preload 构建完成');
