/**
 * FNV-1a 32 位哈希。
 *
 * 用途：
 * - 生成学习身份键 `stateKey`（见 ARCHITECTURE 3.2.1）；
 * - 同步分片 `shardOfWordState()`（T17，按 `fnv1a(stateKey) % 8`）。
 *
 * 为什么不用 `crypto.subtle.digest`：它是异步 API，而仓库层/队列需要同步拿到
 * 分片号与 stateKey；FNV-1a 计算量小、实现确定，同步返回，足够用于「分桶」。
 */

/**
 * 计算字符串的 FNV-1a 32 位哈希，返回无符号整数（0 ~ 4294967295）。
 *
 * 注意：按 UTF-16 码元逐字符计算（对纯英文单词与中文释义都稳定），
 * 同一输入永远得到同一结果。
 */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    // Math.imul 保证 32 位乘法不溢出成浮点误差
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 学习身份键：`fnv1a(norm)` 的十进制字符串。
 *
 * 【架构裁决】WordState 主键用 stateKey 而不是 wordId，
 * 这样同一个单词出现在多个词库时共享同一份学习状态（WRD-11）。
 */
export function stateKeyOfNorm(norm: string): string {
  return String(fnv1a(norm));
}
