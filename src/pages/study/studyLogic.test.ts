/**
 * 学习会话页纯交互逻辑单测（T09 轻量测试）。
 *
 * 覆盖两类关键交互：
 * 1. 键盘映射（空格揭示 / 1~4 评分 / 未揭示时数字键无效）；
 * 2. 结算页文案格式化（正确率、用时）。
 */
import { describe, expect, it } from 'vitest';

import { formatAccuracy, formatDuration, resolveKeyAction } from './studyLogic';

describe('resolveKeyAction（键盘映射）', () => {
  it('未揭示：空格 → 揭示；数字键无效', () => {
    expect(resolveKeyAction(' ', false)).toEqual({ type: 'reveal' });
    expect(resolveKeyAction('Spacebar', false)).toEqual({ type: 'reveal' });
    expect(resolveKeyAction('4', false)).toBeNull();
  });

  it('已揭示：空格不再重复揭示；1~4 映射为对应评分', () => {
    expect(resolveKeyAction(' ', true)).toBeNull();
    expect(resolveKeyAction('1', true)).toEqual({ type: 'rate', rating: 1 });
    expect(resolveKeyAction('3', true)).toEqual({ type: 'rate', rating: 3 });
  });

  it('其他按键一律返回 null', () => {
    expect(resolveKeyAction('a', false)).toBeNull();
    expect(resolveKeyAction('5', true)).toBeNull();
    expect(resolveKeyAction('Escape', true)).toBeNull();
  });
});

describe('结算页文案', () => {
  it('formatAccuracy：用例 A 终态 80%（4/5）', () => {
    expect(formatAccuracy(0.8, 4, 5)).toBe('80%（4/5）');
    expect(formatAccuracy(0, 0, 0)).toBe('—');
  });

  it('formatDuration：秒 / 分秒 / 整分三种形态', () => {
    expect(formatDuration(45)).toBe('45 秒');
    expect(formatDuration(90)).toBe('1 分 30 秒');
    expect(formatDuration(60)).toBe('1 分钟');
  });
});
