/**
 * 会话组装（ARCHITECTURE 4.1 异常退出恢复流程第 3 步 / PRD 5.4 R8/R9）。
 *
 * 组装顺序（不可调换）：
 * ① carryOver 遗留重现词（插队首 min(i,3) 位，跨会话连续性 R9）
 * ② 到期复习词（dueAt ≤ now 由调用方过滤；按 dueAt 升序，最多 SESSION_BATCH_SIZE 条，R8）
 * ③ 新词（调用方已按 Settings.learningOrder 与每日上限截取）
 * 全程按 stateKey 去重（R1 唯一性）。
 */
import type { CardItem } from '../../types/session';

import { insertCarryOver } from './queue';

export interface BuildSessionInput {
  /** 遗留重现词（来自上次快照 retryPool，按优先顺序） */
  carryOver: readonly CardItem[];
  /** 到期复习卡（调用方过滤过 dueAt ≤ now） */
  dueWords: readonly CardItem[];
  /** 新词卡（调用方按学习顺序与每日上限截取） */
  newWords: readonly CardItem[];
  /** 单次会话复习装载上限（PRD R8 分批） */
  batchSize?: number;
}

export interface BuiltSession {
  queue: CardItem[];
  /** 计划量 = 组装后的去重队列长度（进度分母基数） */
  plannedTotal: number;
}

export function buildSession(input: BuildSessionInput): BuiltSession {
  const { carryOver, dueWords, newWords, batchSize = Number.POSITIVE_INFINITY } = input;

  // ① 遗留重现词优先插队首区域
  let queue = insertCarryOver([], carryOver);

  // ② 到期复习（dueAt 升序；分批上限）
  const seen = new Set(queue.map((card) => card.stateKey));
  const reviews = [...dueWords].sort((a, b) => {
    const dueA = 'dueAt' in a ? (a as { dueAt: number }).dueAt : 0;
    const dueB = 'dueAt' in b ? (b as { dueAt: number }).dueAt : 0;
    return dueA - dueB;
  });
  let reviewQuota = batchSize;
  for (const card of reviews) {
    if (reviewQuota <= 0) {
      break;
    }
    if (seen.has(card.stateKey)) {
      continue;
    }
    seen.add(card.stateKey);
    queue = [...queue, card];
    reviewQuota -= 1;
  }

  // ③ 新词
  for (const card of newWords) {
    if (seen.has(card.stateKey)) {
      continue;
    }
    seen.add(card.stateKey);
    queue = [...queue, card];
  }

  return { queue, plannedTotal: queue.length };
}
