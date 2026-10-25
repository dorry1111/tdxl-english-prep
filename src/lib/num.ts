/**
 * 数值工具。随机数必须走这里，禁止在页面里直接 `Math.random()` 决定队列位置
 * （ARCHITECTURE 7.2），因为队列算法要用可注入的随机源做回放测试。
 */

/** 把 value 限制在 [min, max] 区间 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  if (min > max) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

/**
 * 生成 [min, max] 闭区间内的随机整数。
 *
 * @param rnd 随机源，默认 Math.random。测试时可传固定序列实现完全回放。
 */
export function randInt(min: number, max: number, rnd: () => number = Math.random): number {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  if (high <= low) {
    return low;
  }
  const roll = clamp(rnd(), 0, 0.999999999);
  return low + Math.floor(roll * (high - low + 1));
}

/** 比例：part / total，total 为 0 时返回 0（避免 NaN 显示） */
export function ratio(part: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return clamp(part / total, 0, 1);
}

/** 百分比文案，如 0.8 → '80%'；total 为 0 时返回 '—' */
export function formatPercent(part: number, total: number, digits = 0): string {
  if (total <= 0) {
    return '—';
  }
  const value = ratio(part, total) * 100;
  return `${value.toFixed(digits)}%`;
}

/** 四舍五入到指定小数位 */
export function roundTo(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
