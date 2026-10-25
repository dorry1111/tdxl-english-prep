/**
 * 「学习快捷键」设置卡：四档评级（不认识/模糊/认识/熟识）的键盘 + 手柄自定义。
 *
 * 设计要点：
 * - 键盘捕获：进入捕获态后监听一次 keydown；Esc 取消；纯修饰键忽略；
 *   与其他档位冲突时报错不写入（键位冲突会让先匹配的档位抢走按键）。
 * - 手柄捕获：轮询 Gamepad API 的按下沿（复用 studyLogic 的纯函数），10 秒超时自动取消。
 * - 存储走 Settings.studyHotkeys（可选字段，缺省回退内置默认，无需 DB 迁移）；
 *   「恢复默认」把整块清回 undefined。
 */
import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ListRow } from '@/components/ui/ListRow';
import { SETTINGS_HOTKEYS } from '@/constants';
import { getSettings, patchSettings } from '@/db/repos/settingsRepo';
import {
  DEFAULT_GAMEPAD_HOTKEYS,
  DEFAULT_KEYBOARD_HOTKEYS,
  detectPressedEdges,
  gamepadButtonLabel,
  normalizeHotkeyKey,
  type GamepadHotkeys,
} from '@/pages/study/studyLogic';
import { useUiStore } from '@/store/uiStore';
import type { Rating } from '@/types';

/** 捕获目标：四个评级 + 手柄揭示 */
type CaptureTarget =
  | { kind: 'keyboard'; rating: Rating }
  | {
      kind: 'gamepad';
      slot: 'rating1' | 'rating2' | 'rating3' | 'rating4' | 'reveal';
    };

/** 纯修饰键不作为快捷键（单独按下无语义） */
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock']);

/** 手柄捕获超时（毫秒） */
const GAMEPAD_CAPTURE_TIMEOUT_MS = 10_000;

export function StudyHotkeysCard() {
  const showError = useUiStore((state) => state.toast.error);
  const settings = useLiveQuery(() => getSettings(), [], undefined);
  const keyboardMap = settings?.studyHotkeys?.keyboard;
  const gamepadMap = settings?.studyHotkeys?.gamepad;

  const [capture, setCapture] = useState<CaptureTarget | null>(null);

  const ratingLabel = (rating: Rating): string => {
    return ({ 1: '不认识', 2: '模糊', 3: '认识', 4: '熟识' })[rating];
  };

  /** 冲突检查：同一输入通道内，新绑定不得与其他档位重复 */
  const checkConflict = useCallback(
    (target: CaptureTarget, value: string | number): string | null => {
      if (target.kind === 'keyboard') {
        for (const rating of [1, 2, 3, 4] as const) {
          if (rating === target.rating) {
            continue;
          }
          const bound = keyboardMap?.[`rating${rating}`] ?? DEFAULT_KEYBOARD_HOTKEYS[`rating${rating}`];
          if (bound !== undefined && normalizeHotkeyKey(bound) === normalizeHotkeyKey(String(value))) {
            return ratingLabel(rating);
          }
        }
        return null;
      }
      for (const rating of [1, 2, 3, 4] as const) {
        if (target.slot === `rating${rating}`) {
          continue;
        }
        const bound = gamepadMap?.[`rating${rating}`] ?? DEFAULT_GAMEPAD_HOTKEYS[`rating${rating}`];
        if (bound === value) {
          return ratingLabel(rating);
        }
      }
      if (target.slot !== 'reveal' && (gamepadMap?.reveal ?? DEFAULT_GAMEPAD_HOTKEYS.reveal) === value) {
        return '揭示答案（手柄）';
      }
      return null;
    },
    [keyboardMap, gamepadMap],
  );

  // ---------- 键盘捕获 ----------
  useEffect(() => {
    if (capture === null || capture.kind !== 'keyboard') {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      if (event.key === 'Escape') {
        setCapture(null);
        return;
      }
      if (MODIFIER_KEYS.has(event.key)) {
        return;
      }
      const conflictWith = checkConflict(capture, event.key);
      if (conflictWith) {
        showError(SETTINGS_HOTKEYS.conflict(conflictWith));
        setCapture(null);
        return;
      }
      void patchSettings({
        studyHotkeys: {
          keyboard: { ...keyboardMap, [`rating${capture.rating}`]: event.key },
          gamepad: gamepadMap,
        },
      });
      setCapture(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capture, keyboardMap, gamepadMap, checkConflict, showError]);

  // ---------- 手柄捕获（轮询按下沿） ----------
  useEffect(() => {
    if (capture === null || capture.kind !== 'gamepad') {
      return;
    }
    if (typeof navigator === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setCapture(null);
      return;
    }
    let rafId = 0;
    let prevPressed: readonly boolean[] = [];
    const startedAt = Date.now();

    const tick = (): void => {
      if (Date.now() - startedAt > GAMEPAD_CAPTURE_TIMEOUT_MS) {
        showError(SETTINGS_HOTKEYS.gamepadMissing);
        setCapture(null);
        return;
      }
      const pads = navigator.getGamepads?.() ?? [];
      let curr: readonly boolean[] = prevPressed;
      for (const pad of pads) {
        if (pad && pad.connected) {
          curr = pad.buttons.map((button) => button.pressed);
          break;
        }
      }
      if (curr !== prevPressed) {
        const edges = detectPressedEdges(prevPressed, curr);
        const pressed = edges[0];
        if (pressed !== undefined) {
          const conflictWith = checkConflict(capture, pressed);
          if (conflictWith) {
            showError(SETTINGS_HOTKEYS.conflict(conflictWith));
          } else {
            void patchSettings({
              studyHotkeys: {
                keyboard: keyboardMap,
                gamepad: { ...gamepadMap, [capture.slot]: pressed },
              },
            });
          }
          setCapture(null);
          return;
        }
        prevPressed = curr;
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [capture, keyboardMap, gamepadMap, checkConflict, showError]);

  const handleReset = useCallback((): void => {
    setCapture(null);
    void patchSettings({ studyHotkeys: undefined });
  }, []);

  const keyboardDisplay = (rating: Rating): string => {
    const bound = keyboardMap?.[`rating${rating}`] ?? DEFAULT_KEYBOARD_HOTKEYS[`rating${rating}`];
    if (bound === undefined) {
      return '—';
    }
    return { ' ': '空格' }[normalizeHotkeyKey(bound)] ?? normalizeHotkeyKey(bound).toUpperCase();
  };

  const gamepadDisplay = (slot: keyof GamepadHotkeys): string => {
    const bound = gamepadMap?.[slot] ?? DEFAULT_GAMEPAD_HOTKEYS[slot];
    return gamepadButtonLabel(bound ?? 0);
  };

  const isCapturing = (target: CaptureTarget): boolean =>
    capture !== null &&
    ((target.kind === 'keyboard' && capture.kind === 'keyboard' && capture.rating === target.rating) ||
      (target.kind === 'gamepad' && capture.kind === 'gamepad' && capture.slot === target.slot));

  return (
    <Card title={SETTINGS_HOTKEYS.title}>
      <div className="flex flex-col gap-1">
        {([1, 2, 3, 4] as const).map((rating) => (
          <div key={rating} className="flex items-center gap-3 py-1">
            <span className="min-w-0 flex-1 truncate text-base text-text">{ratingLabel(rating)}</span>
            <button
              type="button"
              onClick={() => setCapture(isCapturing({ kind: 'keyboard', rating }) ? null : { kind: 'keyboard', rating })}
              className="app-tappable min-w-[132px] rounded-md border border-border px-2 py-1.5 text-center text-xs text-text-2 hover:border-primary hover:text-primary"
            >
              {isCapturing({ kind: 'keyboard', rating })
                ? SETTINGS_HOTKEYS.capturingKeyboard
                : `${SETTINGS_HOTKEYS.keyboardColumn}：${keyboardDisplay(rating)}`}
            </button>
            <button
              type="button"
              onClick={() =>
                setCapture(
                  isCapturing({ kind: 'gamepad', slot: `rating${rating}` })
                    ? null
                    : { kind: 'gamepad', slot: `rating${rating}` },
                )
              }
              className="app-tappable min-w-[150px] rounded-md border border-border px-2 py-1.5 text-center text-xs text-text-2 hover:border-primary hover:text-primary"
            >
              {isCapturing({ kind: 'gamepad', slot: `rating${rating}` })
                ? SETTINGS_HOTKEYS.capturingGamepad
                : `${SETTINGS_HOTKEYS.gamepadColumn}：${gamepadDisplay(`rating${rating}`)}`}
            </button>
          </div>
        ))}

        <ListRow
          title={SETTINGS_HOTKEYS.gamepadRevealRow}
          meta={gamepadDisplay('reveal')}
          onClick={() =>
            setCapture(isCapturing({ kind: 'gamepad', slot: 'reveal' }) ? null : { kind: 'gamepad', slot: 'reveal' })
          }
          showChevron={false}
          className={isCapturing({ kind: 'gamepad', slot: 'reveal' }) ? 'text-primary' : undefined}
        />
        {isCapturing({ kind: 'gamepad', slot: 'reveal' }) ? (
          <p className="px-4 text-xs text-primary">{SETTINGS_HOTKEYS.capturingGamepad}</p>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-text-3">{SETTINGS_HOTKEYS.hint}</p>
      <div className="mt-3 flex justify-end">
        <Button variant="secondary" onClick={handleReset}>
          {SETTINGS_HOTKEYS.reset}
        </Button>
      </div>
    </Card>
  );
}
