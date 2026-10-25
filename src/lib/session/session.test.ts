/**
 * T07 验收测试：当日循环队列 + 会话状态机（ARCHITECTURE 4.0/4.1、PRD 5.4/5.7）。
 */
import { describe, expect, test } from 'vitest';

import { MIN_QUEUE_SIZE } from '@/constants';
import { MIN, HR, DAY } from './testLadder';
import { buildSession } from './buildSession';
import {
  answer,
  computeAccuracy,
  computeProgress,
  createQueueState,
  type SessionConfig,
} from './sessionMachine';
import { countByStateKey, insertCarryOver, refillTail } from './queue';
import { nextStudyDay0400 } from '@/lib/srs/studyDay';
import type { CardItem } from '@/types/session';
import type { WordState } from '@/types/word';

const LADDER = [5 * MIN, 30 * MIN, 12 * HR, 1 * DAY, 2 * DAY, 4 * DAY, 7 * DAY, 15 * DAY, 30 * DAY, 60 * DAY, 120 * DAY];
const CFG: SessionConfig = {
  maxLevel: 10,
  masterLevel: 8,
  intervalLadder: LADDER,
  dayStartHour: 4,
  maxRetry: 5,
  queueBuffer: MIN_QUEUE_SIZE,
};
const NOW = new Date('2026-10-24T10:00:00+08:00').getTime();

/** 用例 A 的五个新词卡 */
function card(key: string, kind: CardItem['kind'] = 'new', round = 0): CardItem {
  return { key: `${kind}:${key}:${round}`, wordId: `core:${key}`, stateKey: `sk-${key}`, kind, round };
}

function wordState(level = 0): WordState {
  return {
    stateKey: 'sk-x',
    wordId: 'core:x',
    bookId: 'core',
    level,
    dueAt: 0,
    lastRating: null,
    lastReviewAt: null,
    firstLearnedAt: null,
    reviewCount: 0,
    correctCount: 0,
    wrongCount: 0,
    lapseCount: 0,
    retryCountToday: 0,
    retryDay: '2026-10-24',
    unstable: false,
    isStarred: false,
    masteredAt: null,
    updatedAt: 0,
    deletedAt: null,
  };
}

/** 维护测试期间的 WordState（模拟 store 落库后回读） */
class StateBook {
  private states = new Map<string, WordState>();

  get(stateKey: string): WordState {
    return this.states.get(stateKey) ?? { ...wordState(), stateKey, wordId: `core:${stateKey}` };
  }

  put(state: WordState): void {
    this.states.set(state.stateKey, state);
  }
}

const rnd = (): number => 0; // 调试模式：k 恒为 3
const RND0 = rnd;

describe('用例 A：当日循环重现（逐卡断言）', () => {
  const A = card('a');
  const B = card('b');
  const C = card('c');
  const D = card('d');
  const E = card('e');

  const states = new StateBook();
  let machine = createQueueState(5, [A, B, C, D, E]);
  const outcomes: ReturnType<typeof answer>[] = [];

  const submit = (cardItem: CardItem, rating: 1 | 2 | 3 | 4) => {
    const outcome = answer(
      machine,
      {
        rating,
        srsState: { ...states.get(cardItem.stateKey), wordId: cardItem.wordId },
        durationMs: 1000,
        sessionId: 'sess-test',
        deviceId: 'test-device',
        srs: CFG,
        maxRetry: 5,
      },
      NOW,
      RND0,
    );
    machine = outcome.machine;
    states.put(outcome.nextWordState);
    outcomes.push(outcome);
    return outcome;
  };

  test('步 1：A 认识 → [B,C,D,E]', () => {
    expect(machine.queue.map((c) => c.stateKey)).toEqual(['sk-a', 'sk-b', 'sk-c', 'sk-d', 'sk-e']);
    const o = submit(A, 3);
    expect(o.machine.queue.map((c) => c.stateKey)).toEqual(['sk-b', 'sk-c', 'sk-d', 'sk-e']);
    expect(o.nextWordState.level).toBe(1);
    expect(o.nextWordState.dueAt).toBe(NOW + 30 * MIN);
  });

  test('步 2：B 不认识 → 插入 pos+3 → [C,D,E,B]', () => {
    const o = submit(B, 1);
    expect(o.machine.queue.map((c) => c.stateKey)).toEqual(['sk-c', 'sk-d', 'sk-e', 'sk-b']);
    expect(o.machine.queue[3]?.round).toBe(1);
    expect(o.machine.retryPool['sk-b']?.retryCount).toBe(1);
    expect(o.nextWordState.level).toBe(0);
    expect(o.nextWordState.dueAt).toBe(nextStudyDay0400(NOW, 4));
    expect(o.requeued).toBe(true);
    expect(o.reviewLog.isRetry).toBe(false);
  });

  test('步 3：C 认识 → [D,E,B]', () => {
    const o = submit(C, 3);
    expect(o.machine.queue.map((c) => c.stateKey)).toEqual(['sk-d', 'sk-e', 'sk-b']);
  });

  test('步 4：D 模糊 → [E,B]（模糊不进当日循环）', () => {
    const o = submit(D, 2);
    expect(o.machine.queue.map((c) => c.stateKey)).toEqual(['sk-e', 'sk-b']);
    expect(o.requeued).toBe(false);
    expect(o.nextWordState.level).toBe(0);
  });

  test('步 5：E 认识 → [B]', () => {
    const o = submit(E, 3);
    expect(o.machine.queue.map((c) => c.stateKey)).toEqual(['sk-b']);
  });

  test('步 6：B 重现认识 → [] 会话结束；重现轮 isRetry=true', () => {
    const o = submit(machine.queue[0]!, 3);
    expect(o.machine.queue).toEqual([]);
    expect(o.machine.status).toBe('finished');
    expect(o.settled).toBe(true);
    expect(o.reviewLog.isRetry).toBe(true);
    expect(o.reviewLog.prevLevel).toBe(0); // 重现用的是 FORGOT 后归零的状态
    expect(o.reviewLog.newLevel).toBe(1);
  });

  test('终态：answeredCount=5、正确率 4/5=0.8（模糊计对）', () => {
    expect(machine.answeredCount).toBe(5);
    const accuracy = computeAccuracy(machine);
    expect(accuracy.correct).toBe(4);
    expect(accuracy.total).toBe(5);
    expect(accuracy.rate).toBe(0.8);
    expect(outcomes).toHaveLength(6);
  });

  test('D4：六次作答各产生一条 ReviewLog，字段齐全', () => {
    for (const o of outcomes) {
      expect(o.reviewLog.sessionId).toBe('sess-test');
      expect(o.reviewLog.answeredAt).toBe(NOW);
      expect(o.reviewLog.rating).toBeGreaterThanOrEqual(1);
      expect(o.reviewLog.newDueAt).toBeGreaterThan(0);
    }
  });
});

describe('R1 唯一性 / R3 上限 / R7 不可回退', () => {
  test('R1：同一词多次 FORGOT，队列中始终只出现 1 次', () => {
    const states = new StateBook();
    let machine = createQueueState(1, [card('x')]);
    for (let round = 1; round <= 4; round++) {
      const current = machine.queue[0]!;
      const o = answer(
        machine,
        {
          rating: 1,
          srsState: states.get(current.stateKey),
          durationMs: 100,
          sessionId: 's',
          deviceId: 'd',
          srs: CFG,
          maxRetry: 5,
        },
        NOW,
        RND0,
      );
      machine = o.machine;
      states.put(o.nextWordState);
      expect(countByStateKey(machine.queue, 'sk-x')).toBe(1);
      expect(machine.retryPool['sk-x']?.retryCount).toBe(round);
    }
  });

  test('R3：连续 5 次 FORGOT 后不再入队，unstable=true、dueAt=次日 04:00', () => {
    const states = new StateBook();
    let machine = createQueueState(1, [card('x')]);
    let last: ReturnType<typeof answer> | undefined;
    for (let round = 1; round <= 5; round++) {
      const current = machine.queue[0]!;
      last = answer(
        machine,
        {
          rating: 1,
          srsState: states.get(current.stateKey),
          durationMs: 100,
          sessionId: 's',
          deviceId: 'd',
          srs: CFG,
          maxRetry: 5,
        },
        NOW,
        RND0,
      );
      machine = last.machine;
      states.put(last.nextWordState);
    }
    expect(last).toBeDefined();
    expect(last!.requeued).toBe(false);
    expect(last!.unstable).toBe(true);
    expect(last!.nextWordState.unstable).toBe(true);
    expect(last!.nextWordState.dueAt).toBe(nextStudyDay0400(NOW, 4));
    expect(machine.queue).toEqual([]);
    expect(machine.status).toBe('finished');
  });

  test('R7：作答后队列不含上一张卡（不可回退）', () => {
    const states = new StateBook();
    let machine = createQueueState(3, [card('a'), card('b'), card('c')]);
    const prevHead = machine.queue[0]!.stateKey;
    const o = answer(
      machine,
      {
        rating: 3,
        srsState: states.get(prevHead),
        durationMs: 100,
        sessionId: 's',
        deviceId: 'd',
        srs: CFG,
        maxRetry: 5,
      },
      NOW,
      RND0,
    );
    expect(o.machine.queue.some((c) => c.stateKey === prevHead)).toBe(false);
  });
});

describe('R5 补位（TC-B06 口径）', () => {
  const R1: CardItem = card('r1', 'review');
  const R2: CardItem = card('r2', 'review');
  const N1 = card('n1');
  const N2 = card('n2');

  test('dueAt 升序取复习卡：[A] + R1(1000)/R2(500) + N1/N2 → [A, R2, R1]', () => {
    const result = refillTail(
      [card('a')],
      3,
      [
        { ...R1, dueAt: 1000 },
        { ...R2, dueAt: 500 },
      ],
      [N1, N2],
    );
    expect(result.queue.map((c) => c.stateKey)).toEqual(['sk-a', 'sk-r2', 'sk-r1']);
    expect(result.takenDue).toBe(2);
    expect(result.takenNew).toBe(0);
  });

  test('补位只在队尾追加：已有重现卡不被挤走', () => {
    const bRetry = card('b', 'retry', 1);
    const result = refillTail([card('a'), bRetry], 3, [{ ...R1, dueAt: 1000 }], []);
    expect(result.queue.map((c) => c.stateKey)).toEqual(['sk-a', 'sk-b', 'sk-r1']);
    expect(result.queue[1]?.kind).toBe('retry');
  });

  test('机器内补位：作答后队列空，按复习→新词顺序补足到 buffer', () => {
    const states = new StateBook();
    let machine = createQueueState(1, [card('a')]);
    const o = answer(
      machine,
      {
        rating: 3,
        srsState: states.get('sk-a'),
        durationMs: 100,
        sessionId: 's',
        deviceId: 'd',
        srs: CFG,
        maxRetry: 5,
        refill: {
          dueReviews: [
            { ...R1, dueAt: 1000 },
            { ...R2, dueAt: 500 },
          ],
          newWords: [N1, N2],
        },
      },
      NOW,
      RND0,
    );
    expect(o.machine.queue.map((c) => c.stateKey)).toEqual(['sk-r2', 'sk-r1', 'sk-n1']);
    expect(o.refillTaken).toEqual({ due: 2, new: 1 });
    expect(o.machine.plannedTotal).toBeGreaterThanOrEqual(3);
  });
});

describe('R9 跨会话遗留', () => {
  test('3 个遗留词出现在新会话队列前 4 位内', () => {
    const built = buildSession({
      carryOver: [card('c1', 'retry', 2), card('c2', 'retry', 2), card('c3', 'retry', 2)],
      dueWords: [],
      newWords: [card('n1'), card('n2'), card('n3'), card('n4'), card('n5')],
    });
    const head = built.queue.slice(0, 4).map((c) => c.stateKey);
    expect(head).toContain('sk-c1');
    expect(head).toContain('sk-c2');
    expect(head).toContain('sk-c3');
    expect(built.plannedTotal).toBe(8);
  });

  test('insertCarryOver：已存在于队列的遗留词跳过（唯一性）', () => {
    const queue = insertCarryOver([card('n1')], [card('n1'), card('c1')]);
    expect(countByStateKey(queue, 'sk-n1')).toBe(1);
    expect(queue.map((c) => c.stateKey)).toEqual(['sk-c1', 'sk-n1']);
  });
});

describe('buildSession 组装', () => {
  test('复习卡按 dueAt 升序、批次上限生效、新词殿后、按 stateKey 去重', () => {
    const due = [
      { ...card('r1', 'review'), dueAt: 2000 },
      { ...card('r2', 'review'), dueAt: 1000 },
    ];
    const built = buildSession({
      carryOver: [],
      dueWords: due,
      newWords: [card('n1'), card('r2'), card('n2')], // r2 与复习重复 → 去重
      batchSize: 1,
    });
    // batchSize=1 只装 1 张复习（dueAt 小的 r2 优先），r2 不再从新词重复进入
    expect(built.queue.map((c) => c.stateKey)).toEqual(['sk-r2', 'sk-n1', 'sk-n2']);
  });
});

describe('computeProgress', () => {
  test('进度分子分母与 pending', () => {
    const states = new StateBook();
    let machine = createQueueState(3, [card('a'), card('b'), card('c')]);
    expect(computeProgress(machine)).toEqual({ answered: 0, total: 3, pending: 3 });
    const o = answer(
      machine,
      {
        rating: 3,
        srsState: states.get('sk-a'),
        durationMs: 100,
        sessionId: 's',
        deviceId: 'd',
        srs: CFG,
        maxRetry: 5,
      },
      NOW,
      RND0,
    );
    machine = o.machine;
    expect(computeProgress(machine)).toEqual({ answered: 1, total: 3, pending: 2 });
  });
});
