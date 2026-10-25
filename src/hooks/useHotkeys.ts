/**
 * 全局键盘快捷键（T14 答题页）。
 *
 * - 数字 1~4 → 选项 A~D；
 * - F → 标记 / 取消标记当前题；
 * - ← / → → 上一题 / 下一题；
 * - 输入框（input/textarea/select/contentEditable）聚焦时全部忽略，
 *   避免主观题打字误触（PRD T14 验收项）。
 */
import { useEffect, useRef } from 'react';

export interface HotkeyHandlers {
  /** 1~4 → 第 index 个选项（0 起） */
  onChoice?: (index: number) => void;
  onFlag?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

/** 判断事件目标是否处于文本输入态（快捷键应忽略） */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

export function useHotkeys(handlers: HotkeyHandlers, enabled = true): void {
  // 用 ref 持有最新回调，避免每次渲染重绑监听器
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (isTextEntryTarget(event.target)) {
        return;
      }
      const { onChoice, onFlag, onPrev, onNext } = handlersRef.current;
      if (event.key >= '1' && event.key <= '4') {
        const index = Number(event.key) - 1;
        if (onChoice) {
          event.preventDefault();
          onChoice(index);
        }
        return;
      }
      if (event.key === 'f' || event.key === 'F') {
        if (onFlag) {
          event.preventDefault();
          onFlag();
        }
        return;
      }
      if (event.key === 'ArrowLeft') {
        if (onPrev) {
          event.preventDefault();
          onPrev();
        }
        return;
      }
      if (event.key === 'ArrowRight') {
        if (onNext) {
          event.preventDefault();
          onNext();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
