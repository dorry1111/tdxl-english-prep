/**
 * 专项抽题（ARCHITECTURE T11 / T14 接入）。
 *
 * 要求：同一 `(题目池, 题型, 数量, seed)` 组合的抽取结果完全可复现，
 * 因此不用 `Math.random`，而是用 mulberry32 确定性 PRNG + Fisher-Yates 洗牌。
 * mulberry32 实现短、周期 2^32、分布足够均匀，专用于「抽题」这种非安全场景。
 */
import type { Question, SectionType } from '@/types';

/**
 * 创建一个 mulberry32 伪随机数生成器（返回 0 ~ 1 的浮点数）。
 * 同一 seed 永远产生同一序列。
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 确定性洗牌（Fisher-Yates，从尾向头）。
 * 返回新数组，不修改入参；洗牌前先浅拷贝保证纯函数语义。
 */
export function shuffleSeeded<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  const random = createSeededRandom(seed);
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const temp = result[i] as T;
    result[i] = result[j] as T;
    result[j] = temp;
  }
  return result;
}

/**
 * 从题目池中抽取指定题型的专项练习题。
 *
 * 抽取前先按 `seq` 升序整理（保证输入顺序不影响结果），
 * 再用 `seed` 洗牌，取前 `count` 题；池子不足 `count` 时返回全部。
 *
 * @param questions   题目池（通常是整卷的题目）
 * @param sectionType 专项题型
 * @param count       需要的题量
 * @param seed        随机种子（同 seed 同结果，可用于「按种子重做」）
 */
export function pickDrillQuestions(
  questions: Question[],
  sectionType: SectionType,
  count: number,
  seed: number,
): Question[] {
  const pool = questions
    .filter((question) => question.sectionType === sectionType && question.deletedAt === null)
    .sort((left, right) => left.seq - right.seq);
  const shuffled = shuffleSeeded(pool, seed);
  const limit = Math.max(0, count);
  return shuffled.slice(0, limit);
}
