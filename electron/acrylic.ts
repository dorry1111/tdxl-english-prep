/**
 * 窗口材质（亚克力/磨砂/纯色）分层应用。
 *
 * 降级链（对应设计方案）：
 * - Win11 22H2+（build 22621+）：DWM 原生 `setBackgroundMaterial('acrylic')`，拖动丝滑；
 * - Win10 1809+（build 17763+）：SetWindowCompositionAttribute + ACCENT_POLICY
 *   （默认 BLUR 磨砂避免 Win10 亚克力的拖动掉帧 bug；用户可手动选 ACRYLIC）；
 * - 其余 / 调用失败 / 用户选 solid：实色背景，完全不依赖 DWM。
 *
 * Win10 的 SetWindowCompositionAttribute 通过 koffi（预编译 FFI，无需 node-gyp）调用；
 * koffi 加载失败时静默降级为实色，绝不能因为玻璃效果让应用起不来。
 */
import { BrowserWindow, nativeTheme } from 'electron';
import os from 'node:os';

/** 用户的材质选择（设置页「界面质感」） */
export type MaterialChoice = 'auto' | 'acrylic' | 'blur' | 'solid';

/** koffi 模块缓存：加载失败记 null，不再反复尝试 */
let koffiModule: unknown | null = null;
let koffiLoadTried = false;

function loadKoffi(): KoffiLike | null {
  if (koffiLoadTried) {
    return koffiModule as KoffiLike | null;
  }
  koffiLoadTried = true;
  try {
    // esbuild external，运行时从 asar unpack 的 node_modules 里 require
    koffiModule = require('koffi') as KoffiLike;
    return koffiModule as KoffiLike;
  } catch {
    return null;
  }
}

/** koffi 用到的最小 API 形状（避免引完整类型依赖） */
interface KoffiLike {
  load: (name: string) => {
    func: (signature: string) => (...args: unknown[]) => boolean;
  };
  struct: (name: string, members: Record<string, string>) => unknown;
  create: (type: unknown, init?: Record<string, unknown>) => unknown;
  ref: (value: unknown) => unknown;
  sizeof: (type: unknown) => number;
}

/** SetWindowCompositionAttribute 的 Attribute 常量（文档化值 19） */
const WCA_ACCENT_POLICY = 19;
/** ACCENT_POLICY.AccentState 取值 */
const ACCENT_STATE = { DISABLED: 0, BLUR: 3, ACRYLIC: 4 } as const;

/** Windows 内部版本号（os.release() 形如 "10.0.26300"） */
export function windowsBuildNumber(): number {
  const [,, patch] = os.release().split('.');
  const build = Number(patch);
  return Number.isFinite(build) ? build : 0;
}

/** ACCENT_POLICY 的底色（ABGR）。半透明同色系底，让模糊层带一点主题色 */
function gradientColor(): number {
  // ABGR：高字节 alpha，随后 B/G/R
  return nativeTheme.shouldUseDarkColors ? 0xb42e2119 : 0xb4fcf8f7;
}

/**
 * Win10：SetWindowCompositionAttribute 应用 accent。
 * @returns 是否成功（失败由调用方降级）
 */
function applyWin10Accent(hwnd: bigint, state: number): boolean {
  const koffi = loadKoffi();
  if (!koffi) {
    return false;
  }
  try {
    const user32 = koffi.load('user32.dll');
    const setAttr = user32.func('bool __stdcall SetWindowCompositionAttribute(uintptr_t hwnd, void* data)');
    const ACCENT_POLICY = koffi.struct('ACCENT_POLICY', {
      AccentState: 'uint32',
      AccentFlags: 'uint32',
      GradientColor: 'uint32',
      AnimationId: 'uint32',
    });
    const policy = koffi.create(ACCENT_POLICY, {
      AccentState: state,
      AccentFlags: 2,
      GradientColor: gradientColor(),
      AnimationId: 0,
    });
    const data = koffi.create(
      koffi.struct('WINDOWCOMPOSITIONATTRIBDATA', {
        Attribute: 'uint32',
        Data: 'void*',
        SizeOfData: 'uint32',
      }),
      {
        Attribute: WCA_ACCENT_POLICY,
        Data: koffi.ref(policy),
        SizeOfData: koffi.sizeof(ACCENT_POLICY),
      },
    );
    return setAttr(hwnd, koffi.ref(data));
  } catch {
    return false;
  }
}

/** HWND（Electron 返回 8 字节 Buffer，64 位下即句柄） */
function hwndOf(win: BrowserWindow): bigint {
  try {
    return win.getNativeWindowHandle().readBigUInt64LE(0);
  } catch {
    return 0n;
  }
}

/**
 * 按用户选择 + 系统能力应用窗口材质。
 * 桌面版窗口必须 frame:false 且页面背景透明，材质才能透出来。
 */
export function applyMaterial(win: BrowserWindow, choice: MaterialChoice): void {
  if (process.platform !== 'win32') {
    return;
  }
  const build = windowsBuildNumber();

  // 解析 auto：能原生亚克力就亚克力，Win10 给磨砂，其余实色
  const resolved: Exclude<MaterialChoice, 'auto'> =
    choice === 'auto' ? (build >= 22621 ? 'acrylic' : build >= 17763 ? 'blur' : 'solid') : choice;

  if (resolved === 'solid') {
    win.setBackgroundMaterial('none');
    applyWin10Accent(hwndOf(win), ACCENT_STATE.DISABLED);
    return;
  }

  if (build >= 22621) {
    // Win11 22H2+：DWM 原生
    win.setBackgroundMaterial('acrylic');
    return;
  }

  if (build >= 17763) {
    // Win10 1809 ~ Win11 21H2：SetWindowCompositionAttribute
    const state = resolved === 'acrylic' ? ACCENT_STATE.ACRYLIC : ACCENT_STATE.BLUR;
    const ok = applyWin10Accent(hwndOf(win), state);
    if (!ok) {
      win.setBackgroundMaterial('none');
    }
    return;
  }

  // 更老的系统：实色兜底
  win.setBackgroundMaterial('none');
}
