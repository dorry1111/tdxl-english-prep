/**
 * 学习快捷键（键盘自定义 + 手柄映射 + 按下沿）的纯函数测试。
 *
 * 覆盖三类边界：
 * 1. 自定义键位生效且与内置默认互不干扰（未自定义的档回退 1~4）；
 * 2. 手柄按钮映射的揭示/评分语义与键盘同构；
 * 3. 按下沿检测只认 false→true，换手柄（长度变化）不误报。
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GAMEPAD_HOTKEYS,
  DEFAULT_KEYBOARD_HOTKEYS,
  detectPressedEdges,
  gamepadButtonLabel,
  normalizeHotkeyKey,
  resolveGamepadAction,
  resolveKeyAction,
} from './studyLogic';

describe('键盘快捷键（含自定义）', () => {
  it('未传自定义时保持默认 1~4', () => {
    expect(resolveKeyAction('1', true)).toEqual({ type: 'rate', rating: 1 });
    expect(resolveKeyAction('4', true)).toEqual({ type: 'rate', rating: 4 });
    expect(resolveKeyAction('a', true)).toBeNull();
  });

  it('自定义键位生效，大小写不敏感', () => {
    const hotkeys = { rating1: 'q', rating2: 'W', rating3: 'e', rating4: 'r' };
    expect(resolveKeyAction('Q', true, hotkeys)).toEqual({ type: 'rate', rating: 1 });
    expect(resolveKeyAction('w', true, hotkeys)).toEqual({ type: 'rate', rating: 2 });
    expect(resolveKeyAction('E', true, hotkeys)).toEqual({ type: 'rate', rating: 3 });
    expect(resolveKeyAction('r', true, hotkeys)).toEqual({ type: 'rate', rating: 4 });
    // 自定义后原默认数字键不再触发（除非也绑到数字）
    expect(resolveKeyAction('1', true, hotkeys)).toBeNull();
  });

  it('部分自定义时未覆盖的档回退默认数字键', () => {
    const hotkeys = { rating1: 'q' };
    expect(resolveKeyAction('q', true, hotkeys)).toEqual({ type: 'rate', rating: 1 });
    expect(resolveKeyAction('2', true, hotkeys)).toEqual({ type: 'rate', rating: 2 });
  });

  it('未揭示时自定义评级键不评分，揭示语义不变', () => {
    const hotkeys = { rating1: 'q', rating2: 'w' };
    expect(resolveKeyAction('q', false, hotkeys)).toBeNull();
    expect(resolveKeyAction(' ', false, hotkeys)).toEqual({ type: 'reveal' });
    expect(resolveKeyAction('Enter', true, hotkeys)).toBeNull();
  });

  it('normalizeHotkeyKey 归一老版空格键名', () => {
    expect(normalizeHotkeyKey('Spacebar')).toBe(' ');
    expect(normalizeHotkeyKey('A')).toBe('a');
  });

  it('默认键位表与历史硬编码一致', () => {
    expect(DEFAULT_KEYBOARD_HOTKEYS).toEqual({ rating1: '1', rating2: '2', rating3: '3', rating4: '4' });
  });
});

describe('手柄快捷键', () => {
  it('默认 A/B/X/Y 四档评分、Start 揭示', () => {
    expect(resolveGamepadAction(0, true)).toEqual({ type: 'rate', rating: 1 });
    expect(resolveGamepadAction(1, true)).toEqual({ type: 'rate', rating: 2 });
    expect(resolveGamepadAction(2, true)).toEqual({ type: 'rate', rating: 3 });
    expect(resolveGamepadAction(3, true)).toEqual({ type: 'rate', rating: 4 });
    expect(resolveGamepadAction(DEFAULT_GAMEPAD_HOTKEYS.reveal, false)).toEqual({ type: 'reveal' });
  });

  it('未揭示时评级按钮不触发，已揭示时揭示按钮不重复触发', () => {
    expect(resolveGamepadAction(0, false)).toBeNull();
    expect(resolveGamepadAction(DEFAULT_GAMEPAD_HOTKEYS.reveal, true)).toBeNull();
  });

  it('自定义手柄按钮生效，非映射按钮返回 null', () => {
    const hotkeys = { rating1: 4, rating2: 5, rating3: 6, rating4: 7, reveal: 8 };
    expect(resolveGamepadAction(4, true, hotkeys)).toEqual({ type: 'rate', rating: 1 });
    expect(resolveGamepadAction(8, false, hotkeys)).toEqual({ type: 'reveal' });
    expect(resolveGamepadAction(0, true, hotkeys)).toBeNull();
    expect(resolveGamepadAction(12, true)).toBeNull();
  });

  it('gamepadButtonLabel 给出可读名称', () => {
    expect(gamepadButtonLabel(0)).toContain('A');
    expect(gamepadButtonLabel(9)).toContain('Start');
    expect(gamepadButtonLabel(99)).toBe('按钮 99');
  });
});

describe('手柄按下沿检测', () => {
  it('只认 false→true 的沿', () => {
    expect(detectPressedEdges([false, false], [true, false])).toEqual([0]);
    expect(detectPressedEdges([true, false], [true, true])).toEqual([1]);
    expect(detectPressedEdges([true, true], [true, true])).toEqual([]);
    expect(detectPressedEdges([true], [false])).toEqual([]);
  });

  it('换手柄（当前帧更长）时新增按钮不误报为按下沿', () => {
    // 上一帧 [false]，当前帧 [false, false, true]：只有第 3 个是新按下
    expect(detectPressedEdges([false], [false, false, true])).toEqual([2]);
  });

  it('全 false 帧（手柄未连接）无边沿', () => {
    expect(detectPressedEdges([true, true], [false, false])).toEqual([]);
  });
});
