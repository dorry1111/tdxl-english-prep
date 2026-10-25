/**
 * 当日循环队列纯函数（PRD 5.4 / ARCHITECTURE 4.0）。
 *
 * 架构裁决（4.0）：不维护 pos 指针 —— 当前卡恒为 queue[0]，
 * 作答后从数组头部移除，「不可回退」由数据结构层面保证。
 *
 * 全部函数返回新数组（不原地 splice），入参一律 readonly 防误改。
 */
import type { EntityId, Timestamp } from '../../types/common';
import type { CardItem } from '../../types/session';

/** 带到期时间的复习卡（补位排序用） */
export interface DueReviewCard extends CardItem {
  dueAt: Timestamp;
}

export interface RefillResult {
  queue: CardItem[];
  /** 实际消耗的到期复习卡 / 新词卡数量（供调用方从待补池中扣减） */
  takenDue: number;
  takenNew: number;
}

/** 移除队首（当前卡）。调用方保证 queue 非空。 */
export function dequeueHead(queue: readonly CardItem[]): CardItem[] {
  return queue.slice(1);
}

/**
 * R2：把答「不认识」的卡重新插回队列。
 * 插入位置 = min(k, 移除后的队列长度)；k 来自 randInt(retryGapMin, retryGapMax)。
 *
 * R1 唯一性：同一 stateKey 在队列中至多 1 张。若已存在（理论不可达，
 * 防御性处理），先移除旧位置再插入，保证不出现两张同词卡。
 */
export function insertRetryCard(
  queue: readonly CardItem[],
  card: CardItem,
  k: number,
): CardItem[] {
  const withoutDup = queue.filter((item) => item.stateKey !== card.stateKey);
  const index = Math.min(Math.max(k, 0), withoutDup.length);
  const next = [...withoutDup];
  next.splice(index, 0, card);
  return next;
}

/**
 * R9 跨会话遗留：carryOver 的第 i 个词以 insertIndex = min(i, 3) 插入队首区域。
 * 已存在于队列的词跳过（保持唯一性）。
 */
export function insertCarryOver(
  queue: readonly CardItem[],
  carryOver: readonly CardItem[],
): CardItem[] {
  let next = [...queue];
  // 跳过重复词时不消耗插入槽位：后面的遗留词仍须落在队首区域内
  let inserted = 0;
  carryOver.forEach((card) => {
    if (next.some((item) => item.stateKey === card.stateKey)) {
      return;
    }
    const index = Math.min(inserted, 3, next.length);
    next = [...next.slice(0, index), card, ...next.slice(index)];
    inserted += 1;
  });
  return next;
}

/**
 * R5 队列补位：剩余 < buffer 时只在队尾追加，补足到 buffer 张。
 * 取词顺序固定：① 到期复习（dueAt 升序）→ ② 新词（调用方已按学习顺序排好）。
 * 不改变既有卡片顺序，不打断已排定的重现位置。
 */
export function refillTail(
  queue: readonly CardItem[],
  buffer: number,
  dueReviews: readonly DueReviewCard[],
  newWords: readonly CardItem[],
): RefillResult {
  const reviews = [...dueReviews].sort((a, b) => a.dueAt - b.dueAt);
  const fresh = [...newWords];
  const next = [...queue];
  let takenDue = 0;
  let takenNew = 0;
  while (next.length < buffer && (reviews.length > 0 || fresh.length > 0)) {
    const review = reviews.shift();
    if (review) {
      next.push(review);
      takenDue += 1;
      continue;
    }
    const word = fresh.shift();
    if (word) {
      next.push(word);
      takenNew += 1;
    }
  }
  return { queue: next, takenDue, takenNew };
}

/** 队列中某 stateKey 的出现次数（不变量校验用，恒应为 0 或 1） */
export function countByStateKey(
  queue: readonly CardItem[],
  stateKey: EntityId,
): number {
  return queue.filter((item) => item.stateKey === stateKey).length;
}
