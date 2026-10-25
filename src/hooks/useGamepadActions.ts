/**
 * 游戏手柄快捷键 hook（学习页四档评级 + 揭示）。
 *
 * 为什么用 rAF 轮询：Gamepad API 没有按下事件，规范要求页面主动轮询
 * `navigator.getGamepads()`；rAF 帧率轮询是标准做法，切后台自动暂停不耗电。
 * 手柄是可选项：没有手柄连接时轮询照跑但每帧只读一个数组，开销可忽略。
 *
 * 按下沿检测与键位映射抽在 studyLogic.ts（纯函数，可单测）；
 * 本 hook 只负责「轮询 → 边沿 → 分发动作」的接线，不持有业务状态。
 */
import { useEffect, useRef } from 'react';

import {
  detectPressedEdges,
  resolveGamepadAction,
  type GamepadHotkeys,
  type KeyAction,
} from '@/pages/study/studyLogic';

export function useGamepadActions(
  onAction: (action: KeyAction) => void,
  revealed: boolean,
  hotkeys?: GamepadHotkeys,
): void {
  // 回调与状态用 ref 直通：rAF 循环只在挂载时启动一次，避免 StudyPage 每次渲染重启轮询
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;
  const hotkeysRef = useRef<GamepadHotkeys | undefined>(hotkeys);
  hotkeysRef.current = hotkeys;

  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      return;
    }
    let rafId = 0;
    let prevPressed: readonly boolean[] = [];

    const tick = (): void => {
      const pads = navigator.getGamepads?.() ?? [];
      let curr: readonly boolean[] = prevPressed;
      for (const pad of pads) {
        // 只认第一个连接的手柄（单人学习场景，多手柄无意义）
        if (pad && pad.connected) {
          curr = pad.buttons.map((button) => button.pressed);
          break;
        }
      }
      if (curr !== prevPressed) {
        for (const index of detectPressedEdges(prevPressed, curr)) {
          const action = resolveGamepadAction(index, revealedRef.current, hotkeysRef.current);
          if (action) {
            actionRef.current(action);
          }
        }
        prevPressed = curr;
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, []);
}
