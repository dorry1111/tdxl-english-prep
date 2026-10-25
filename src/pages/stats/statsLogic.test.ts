/**
 * 单词统计页纯逻辑单测：连续打卡与柱状图比例。
 */
import { describe, expect, it } from 'vitest';

import { barHeightPercent, computeStreak, maxOf, nextDayKey, previousDayKey } from './statsLogic';

describe('computeStreak', () => {
  it('今天有记录：从今天往前连数', () => {
    expect(computeStreak(['2026-10-22', '2026-10-23', '2026-10-24'], '2026-10-24')).toBe(3);
  });

  it('今天还没背：从昨天往前连数（今天没背不算断签）', () => {
    expect(computeStreak(['2026-10-22', '2026-10-23'], '2026-10-24')).toBe(2);
  });

  it('断一天即止；无记录为 0', () => {
    expect(computeStreak(['2026-10-20', '2026-10-22'], '2026-10-22')).toBe(1);
    expect(computeStreak([], '2026-10-24')).toBe(0);
  });
});

describe('日期键推进', () => {
  it('跨月：previousDayKey / nextDayKey 都正确', () => {
    expect(previousDayKey('2026-11-01')).toBe('2026-10-31');
    expect(nextDayKey('2026-10-31')).toBe('2026-11-01');
    expect(nextDayKey('2026-12-31')).toBe('2027-01-01');
  });
});

describe('柱状图比例', () => {
  it('最大值归一为 100，其余按比例；全 0 时为 0', () => {
    expect(maxOf([3, 7, 0, 5])).toBe(7);
    expect(barHeightPercent(7, 7)).toBe(100);
    expect(barHeightPercent(3, 7)).toBe(43);
    expect(barHeightPercent(0, 0)).toBe(0);
  });
});
