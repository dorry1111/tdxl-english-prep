import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXAM_DATE,
  INTERVAL_LADDER,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  computeExamDate,
} from '@/constants';
import { newId } from '@/lib/id';
import { msToNext0400 } from '@/lib/time';
import { fnv1a, stateKeyOfNorm } from '@/lib/hash';
import { normalizeWord, wordIdOf } from '@/lib/wordbookCache';
import { dayjs } from '@/lib/dayjs';

describe('T02 验收自测', () => {
  it('INTERVAL_LADDER 共 11 档且逐档正确', () => {
    expect(INTERVAL_LADDER).toHaveLength(11);
    expect([...INTERVAL_LADDER]).toEqual([
      5 * MS_PER_MINUTE,
      30 * MS_PER_MINUTE,
      12 * MS_PER_HOUR,
      1 * MS_PER_DAY,
      2 * MS_PER_DAY,
      4 * MS_PER_DAY,
      7 * MS_PER_DAY,
      15 * MS_PER_DAY,
      30 * MS_PER_DAY,
      60 * MS_PER_DAY,
      120 * MS_PER_DAY,
    ]);
  });

  it('考试日期 = 当年 5 月第三个星期日，2027 为 2027-05-16', () => {
    expect(computeExamDate(2026)).toBe('2026-05-17');
    expect(computeExamDate(2027)).toBe('2027-05-16');
    expect(computeExamDate(2028)).toBe('2028-05-21');
    expect(DEFAULT_EXAM_DATE).toBe('2027-05-16');
  });

  it('newId 1 万次无重复，同一毫秒内字典序递增', () => {
    const ids = new Set<string>();
    for (let index = 0; index < 10_000; index += 1) {
      ids.add(newId('log'));
    }
    expect(ids.size).toBe(10_000);

    const batch = Array.from({ length: 200 }, () => newId('log'));
    const sorted = [...batch].sort();
    expect(sorted).toEqual(batch);
  });

  it('norm 归一化与 stateKey 规则', () => {
    expect(normalizeWord(' Deteriorate ')).toBe('deteriorate');
    expect(normalizeWord('a  lot')).toBe('a lot');
    expect(wordIdOf('core', 'Deteriorate')).toBe('core:Deteriorate');
    expect(stateKeyOfNorm(normalizeWord('Café'))).toBe(stateKeyOfNorm('cafe'));
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(String(fnv1a('abc'))).toBe(stateKeyOfNorm('abc'));
  });

  it('学习日边界：03:59 属于前一天，04:00 属于当天', () => {
    const before = dayjs('2026-10-24 03:59:00', 'YYYY-MM-DD HH:mm:ss').valueOf();
    const at = dayjs('2026-10-24 04:00:00', 'YYYY-MM-DD HH:mm:ss').valueOf();
    // 03:59 时，下一个 04:00 只差 1 分钟（说明 04:00 属于下一个学习日）
    expect(msToNext0400(before, 4)).toBe(60_000);
    expect(msToNext0400(at, 4)).toBe(24 * 60 * 60_000);
  });
});
