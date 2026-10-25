/**
 * ID 生成（ARCHITECTURE 7.6）。
 *
 * 形如 `sess_lq3k9f_a7b2c1`：
 * - 第 2 段：毫秒时间戳的 36 进制（字典序近似时间序，便于分页与日志排查）；
 * - 第 3 段 6 字符 = 3 位单调序号 + 3 位随机。
 *
 * 为什么不是纯随机 6 位：T02 验收要求「同一毫秒内生成的 ID 保持字典序递增」。
 * 把单调序号放在随机段之前，就能在时间戳相同的情况下依然递增，同时保留随机性
 * 以避免多设备/多标签页撞号。
 */

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';
const SEQ_WIDTH = 3;
const RAND_WIDTH = 3;

/** 上一次生成 ID 用的时间戳 */
let lastTimestamp = -1;
/** 同一毫秒内的序号，从 36^SEQ_WIDTH 回绕到 0 */
let sequence = 0;

function randomSuffix(length: number): string {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += BASE36.charAt(Math.floor(Math.random() * BASE36.length));
  }
  return out;
}

/** 把整数转成定宽的 36 进制字符串（超出宽度时保留低位） */
function toFixedBase36(value: number, width: number): string {
  const raw = value.toString(36);
  if (raw.length >= width) {
    return raw.slice(raw.length - width);
  }
  return raw.padStart(width, '0');
}

/**
 * 生成带语义前缀的 ID。
 *
 * @example newId('log') → 'log_lq3k9f_00a7b2'
 */
export function newId(prefix: string): string {
  const timestamp = Date.now();
  if (timestamp === lastTimestamp) {
    sequence = (sequence + 1) % 36 ** SEQ_WIDTH;
  } else {
    lastTimestamp = timestamp;
    sequence = 0;
  }
  const timePart = timestamp.toString(36);
  const seqPart = toFixedBase36(sequence, SEQ_WIDTH);
  const randPart = randomSuffix(RAND_WIDTH);
  return `${prefix}_${timePart}_${seqPart}${randPart}`;
}
