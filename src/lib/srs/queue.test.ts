/**
 * T06 边界测试：当日队列（SRS-TEST-CASES 第 4 节 TC-B03~B06）。
 */
import { describe, expect, test } from 'vitest';

import boundary from '../../../test/fixtures/boundary.json';

import { insertRetry, randInt, refillQueue } from './queue';
import { nextStudyDay0400 } from './studyDay';

const NOW = new Date('2026-10-24T10:00:00+08:00').getTime();
const DAY_START_HOUR = 4;

const fixtures = boundary.filter((b) => b.fn === 'insertRetry' || b.fn === 'refillQueue');

describe('队列边界用例', () => {
  for (const fixture of fixtures) {
    test(fixture.id, () => {
      const input = fixture.input as Record<string, unknown>;

      if (fixture.fn === 'insertRetry') {
        const result = insertRetry(
          input.queue as string[],
          input.id as string,
          input.pos as number,
          input.k as number,
          Math.random,
          {
            retryCountBefore: input.retryCountBefore as number | undefined,
            maxRetry: input.maxRetry as number | undefined,
            now: NOW,
            dayStartHour: DAY_START_HOUR,
          },
        );
        const expected = fixture.expected as Record<string, unknown>;
        expect(result.queue).toEqual(expected.queue);
        if ('requeued' in expected) {
          expect(result.requeued).toBe(expected.requeued);
          expect(result.retryCountAfter).toBe(expected.retryCountAfter);
          expect(result.unstable).toBe(expected.unstable);
          if (expected.dueAt === 'nextStudyDay0400') {
            expect(result.dueAt).toBe(nextStudyDay0400(NOW, DAY_START_HOUR));
          }
        }
        return;
      }

      // refillQueue
      const result = refillQueue(
        input.queue as string[],
        input.buffer as number,
        input.dueReviews as { id: string; dueAt: number }[],
        input.newWords as string[],
      );
      expect(result).toEqual((fixture.expected as { queue: string[] }).queue);
    });
  }
});

describe('insertRetry 语义补充', () => {
  test('min(pos+k, length) 上限收敛：k 超长时追加尾部', () => {
    const { queue, requeued } = insertRetry(['C'], 'B', 0, 3, Math.random);
    expect(queue).toEqual(['C', 'B']);
    expect(requeued).toBe(true);
  });

  test('未达上限时正常入队且 retryCount 自增', () => {
    const { queue, requeued, retryCountAfter, unstable } = insertRetry(
      ['C', 'D', 'E', 'F'],
      'B',
      0,
      3,
      Math.random,
      { retryCountBefore: 2, maxRetry: 5, now: NOW, dayStartHour: DAY_START_HOUR },
    );
    expect(requeued).toBe(true);
    expect(retryCountAfter).toBe(3);
    expect(unstable).toBe(false);
    expect(queue).toEqual(['C', 'D', 'E', 'B', 'F']);
  });

  test('gap 随机性可注入：固定 rand 得到确定结果（会话层可测试）', () => {
    // randInt(3,5) 与注入 rand 的映射：0->3, 0.99->5, 0.5->4
    expect(randInt(3, 5, () => 0)).toBe(3);
    expect(randInt(3, 5, () => 0.99)).toBe(5);
    expect(randInt(3, 5, () => 0.5)).toBe(4);
    // gapCandidate 缺省时走 randInt，注入固定 rand 后结果确定
    const { gap } = insertRetry(['C', 'D'], 'B', 0, 0, () => 0.99);
    expect(gap).toBe(5);
  });

  test('gap 未提供时在 [3,5] 内随机', () => {
    for (let i = 0; i < 50; i++) {
      const { gap } = insertRetry(['C', 'D', 'E', 'F'], 'B', 0, 0, Math.random);
      expect(gap).toBeGreaterThanOrEqual(3);
      expect(gap).toBeLessThanOrEqual(5);
    }
  });
});
