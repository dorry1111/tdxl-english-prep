/**
 * lib/perf 探针「默认零开销」测试。
 *
 * 这个文件存在的原因：探针是给用户排查冷启动用的，它自己绝不能成为新的启动开销。
 * 因此必须用测试锁死：**不带 `?perf=1` 时**不注册任何监听、不注册
 * `PerformanceObserver`、不打 User Timing 标记、不输出任何 console。
 *
 * 同时验证 `traceAsync` 的语义约定（成功原样返回、失败原样抛出），
 * 这是「包一层打点不许改变调用方行为」的底线。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ListenerRecorder {
  windowTypes: string[];
  documentTypes: string[];
  restore(): void;
}

/** 记录 window / document 上新增的监听类型，用于断言「没注册监听」 */
function recordListeners(): ListenerRecorder {
  const windowTypes: string[] = [];
  const documentTypes: string[] = [];
  const originalWindowAdd = window.addEventListener;
  const originalDocumentAdd = document.addEventListener;

  window.addEventListener = ((
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void => {
    windowTypes.push(type);
    originalWindowAdd.call(window, type, handler, options);
  }) as typeof window.addEventListener;

  document.addEventListener = ((
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void => {
    documentTypes.push(type);
    originalDocumentAdd.call(document, type, handler, options);
  }) as typeof document.addEventListener;

  return {
    windowTypes,
    documentTypes,
    restore: () => {
      window.addEventListener = originalWindowAdd;
      document.addEventListener = originalDocumentAdd;
    },
  };
}

/** 装一个假的 PerformanceObserver，`observe` 被调用即说明探针注册了观测 */
function installFakePerformanceObserver(): { observe: ReturnType<typeof vi.fn>; restore: () => void } {
  const observe = vi.fn();
  const original = globalThis.PerformanceObserver;
  Object.defineProperty(globalThis, 'PerformanceObserver', {
    configurable: true,
    writable: true,
    value: class {
      observe = observe;
      disconnect = (): void => undefined;
      takeRecords = (): PerformanceEntry[] => [];
    },
  });
  return {
    observe,
    restore: () => {
      Object.defineProperty(globalThis, 'PerformanceObserver', {
        configurable: true,
        writable: true,
        value: original,
      });
    },
  };
}

/** 等一段真实时间，让探针内部 setTimeout(0) 的启动口径输出刷出来 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

beforeEach(() => {
  vi.resetModules();
});

describe('perf 探针（默认关闭）', () => {
  it('不带 ?perf=1 时零开销：不注册 observer / 不监听 / 不打点 / 不输出', async () => {
    const recorder = recordListeners();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const fakeObserver = installFakePerformanceObserver();

    try {
      const perf = await import('./perf');
      expect(perf.isPerfEnabled()).toBe(false);

      perf.installPerfProbe();
      perf.perfMark('perf:qa-must-not-exist');
      perf.perfLog('这段日志不该出现');
      perf.perfMarkFromFirstGesture('study:reveal');
      await wait(10);

      expect(fakeObserver.observe).not.toHaveBeenCalled();
      expect(recorder.windowTypes).toHaveLength(0);
      expect(recorder.documentTypes).toHaveLength(0);
      expect(infoSpy).not.toHaveBeenCalled();
      expect(performance.getEntriesByName('perf:qa-must-not-exist')).toHaveLength(0);
    } finally {
      fakeObserver.restore();
      recorder.restore();
    }
  });

  it('traceAsync 语义不变：成功原样返回、失败原样抛出（默认关闭时）', async () => {
    const { traceAsync } = await import('./perf');

    const value = { answer: 42 };
    await expect(traceAsync('db:open', async () => value)).resolves.toBe(value);
    await expect(
      traceAsync('db:open', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});

describe('perf 探针（?perf=1 开启）', () => {
  it('带 ?perf=1 时真正生效：注册 longtask 观测与首屏/手势监听', async () => {
    window.history.replaceState({}, '', '/?perf=1');
    vi.resetModules();
    const recorder = recordListeners();
    const fakeObserver = installFakePerformanceObserver();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    try {
      const perf = await import('./perf');
      expect(perf.isPerfEnabled()).toBe(true);

      perf.installPerfProbe();
      await wait(10);

      expect(fakeObserver.observe).toHaveBeenCalledWith({ type: 'longtask', buffered: true });
      expect(recorder.windowTypes).toContain('load');
      expect(recorder.documentTypes).toContain('pointerdown');
      expect(infoSpy).toHaveBeenCalled();
    } finally {
      fakeObserver.restore();
      recorder.restore();
      window.history.replaceState({}, '', '/');
    }
  });
});
