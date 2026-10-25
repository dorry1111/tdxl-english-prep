/**
 * 学习会话页的纯交互逻辑（T09）。
 *
 * 抽成纯函数的目的：键盘/手柄映射、文案格式化都不依赖 React，
 * 可以脱离 DOM 单测覆盖（studyLogic.test.ts）。
 */
import type { Rating, StudyHotkeys } from '@/types';

/** 键盘动作：空格/回车 → 揭示；评级键（默认 1~4）→ 评分（仅在已揭示时有效） */
export type KeyAction = { type: 'reveal' } | { type: 'rate'; rating: Rating };

export type RatingHotkeys = NonNullable<StudyHotkeys['keyboard']>;
export type GamepadHotkeys = NonNullable<StudyHotkeys['gamepad']>;

/** 键盘默认键位：与历史硬编码行为一致（1~4 对应四档） */
export const DEFAULT_KEYBOARD_HOTKEYS: Required<RatingHotkeys> = {
  rating1: '1',
  rating2: '2',
  rating3: '3',
  rating4: '4',
};

/** 手柄默认键位（标准 Gamepad 布局）：A=不认识 B=模糊 X=认识 Y=熟识，Start=揭示 */
export const DEFAULT_GAMEPAD_HOTKEYS: Required<GamepadHotkeys> = {
  rating1: 0,
  rating2: 1,
  rating3: 2,
  rating4: 3,
  reveal: 9,
};

/** 键盘键位归一：小写 + 老版 'Spacebar' 归一为 ' '，保证自定义与内置同口径比较 */
export function normalizeHotkeyKey(key: string): string {
  if (key === 'Spacebar') {
    return ' ';
  }
  return key.toLowerCase();
}

/**
 * 把按键翻译成会话动作；无需处理的按键返回 null。
 * 未揭示时评级键不评分（评分条禁用语义），已揭示时揭示键不再重复揭示。
 * `hotkeys` 缺省或某档未自定义时，该档回退内置默认（1~4）。
 */
export function resolveKeyAction(
  key: string,
  revealed: boolean,
  hotkeys?: RatingHotkeys,
): KeyAction | null {
  if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
    return revealed ? null : { type: 'reveal' };
  }
  if (!revealed) {
    return null;
  }
  const normalized = normalizeHotkeyKey(key);
  for (const rating of [1, 2, 3, 4] as const) {
    // 自定义优先；未自定义（undefined）回退默认数字键
    const bound = hotkeys?.[`rating${rating}`] ?? DEFAULT_KEYBOARD_HOTKEYS[`rating${rating}`];
    if (bound !== undefined && normalizeHotkeyKey(bound) === normalized) {
      return { type: 'rate', rating };
    }
  }
  return null;
}

/**
 * 把手柄按钮按下沿翻译成会话动作；非映射按钮返回 null。
 * 语义与键盘一致：未揭示时只有 reveal 生效，已揭示时只有评级生效。
 */
export function resolveGamepadAction(
  buttonIndex: number,
  revealed: boolean,
  hotkeys?: GamepadHotkeys,
): KeyAction | null {
  const revealButton = hotkeys?.reveal ?? DEFAULT_GAMEPAD_HOTKEYS.reveal;
  if (buttonIndex === revealButton) {
    return revealed ? null : { type: 'reveal' };
  }
  if (!revealed) {
    return null;
  }
  for (const rating of [1, 2, 3, 4] as const) {
    const bound = hotkeys?.[`rating${rating}`] ?? DEFAULT_GAMEPAD_HOTKEYS[`rating${rating}`];
    if (bound !== undefined && buttonIndex === bound) {
      return { type: 'rate', rating };
    }
  }
  return null;
}

/** 标准 Gamepad 布局的常用按钮名（设置卡展示用；未知索引回退「按钮 N」） */
export function gamepadButtonLabel(index: number): string {
  const names: Record<number, string> = {
    0: 'A / 交叉键',
    1: 'B / 圆圈键',
    2: 'X / 方块键',
    3: 'Y / 三角键',
    4: 'L1 / LB',
    5: 'R1 / RB',
    6: 'L2 / LT',
    7: 'R2 / RT',
    8: 'Back / Select',
    9: 'Start / Options',
    10: '左摇杆按下',
    11: '右摇杆按下',
    12: '十字键上',
    13: '十字键下',
    14: '十字键左',
    15: '十字键右',
  };
  return names[index] ?? `按钮 ${index}`;
}

/**
 * 手柄按下沿检测（纯函数）：上一帧与当前帧的 pressed 数组对比，
 * false→true 的按钮即「这一帧新按下」。长度不一致（换手柄/重连）时按新帧全量处理。
 */
export function detectPressedEdges(prev: readonly boolean[], curr: readonly boolean[]): number[] {
  const edges: number[] = [];
  for (let i = 0; i < curr.length; i += 1) {
    const wasPressed = i < prev.length ? prev[i] : false;
    if (curr[i] && !wasPressed) {
      edges.push(i);
    }
  }
  return edges;
}

/** 正确率展示：「80%（4/5）」；无数据用「—」占位 */
export function formatAccuracy(rate: number, correct: number, total: number): string {
  if (total <= 0) {
    return '—';
  }
  return `${Math.round(rate * 100)}%（${correct}/${total}）`;
}

/** 用时展示：秒 < 60 → 「45 秒」；否则「12 分 30 秒」（整分不带秒） */
export function formatDuration(sec: number): string {
  if (sec < 60) {
    return `${sec} 秒`;
  }
  const minutes = Math.floor(sec / 60);
  const rest = sec % 60;
  return rest === 0 ? `${minutes} 分钟` : `${minutes} 分 ${rest} 秒`;
}
