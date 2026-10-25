/**
 * 学习计划页推算逻辑单测（纯函数）。
 */
import { describe, expect, it } from 'vitest';

import {
  DAILY_STUDY_QUOTA_RANGE_MAX,
  DAILY_STUDY_QUOTA_RANGE_MIN,
  PLAN_DAILY_NEW_CAP,
  clampDailyStudyQuota,
  clampNewWordLimit,
  daysUntil,
  effectiveDailyNew,
  estimatedFinishDateKey,
  reviewPressureOf,
  suggestDailyNew,
  willMissDeadline,
} from './planLogic';

describe('daysUntil', () => {
  it('同一天为 0，未来日期为正数', () => {
    expect(daysUntil('2027-05-16', '2027-05-16')).toBe(0);
    expect(daysUntil('2027-05-16', '2027-05-06')).toBe(10);
  });

  it('已过考试日与非法日期都收敛为 0（不出现负数/NaN）', () => {
    expect(daysUntil('2027-05-16', '2027-06-01')).toBe(0);
    expect(daysUntil('not-a-date', '2027-05-06')).toBe(0);
  });
});

describe('suggestDailyNew', () => {
  it('正常：ceil(剩余/天数) 并夹到 [1,50]', () => {
    expect(suggestDailyNew(5802, 204)).toBe(29); // ceil(28.44)
    expect(suggestDailyNew(100, 1)).toBe(50); // 超过上限 → 50
    expect(suggestDailyNew(1, 1000)).toBe(1); // 低于下限 → 1
  });

  it('边界：剩余为 0 → 0；天数为 0 → 上限', () => {
    expect(suggestDailyNew(0, 30)).toBe(0);
    expect(suggestDailyNew(9999, 0)).toBe(PLAN_DAILY_NEW_CAP);
  });
});

describe('estimatedFinishDateKey / willMissDeadline', () => {
  it('剩余 5802、每日 35 → 166 天后', () => {
    expect(estimatedFinishDateKey('2026-10-24', 5802, 35)).toBe('2027-04-08');
  });

  it('已学完或每日为 0 时就是今天', () => {
    expect(estimatedFinishDateKey('2026-10-24', 0, 35)).toBe('2026-10-24');
    expect(estimatedFinishDateKey('2026-10-24', 100, 0)).toBe('2026-10-24');
  });

  it('学完日晚于考试日 → 告警', () => {
    expect(willMissDeadline('2027-08-11', '2027-05-16')).toBe(true);
    expect(willMissDeadline('2027-04-08', '2027-05-16')).toBe(false);
  });
});

describe('reviewPressureOf', () => {
  it('0 → 无压力；小于阈值 → 有积压；达到阈值 → 偏重', () => {
    expect(reviewPressureOf(0)).toBe('none');
    expect(reviewPressureOf(42)).toBe('light');
    expect(reviewPressureOf(250)).toBe('heavy');
  });
});

describe('clampNewWordLimit', () => {
  it('收敛到 [1, 200]，非法输入回退默认 20', () => {
    expect(clampNewWordLimit(0)).toBe(1);
    expect(clampNewWordLimit(-5)).toBe(1);
    expect(clampNewWordLimit(75)).toBe(75);
    expect(clampNewWordLimit(300)).toBe(200);
    expect(clampNewWordLimit(Number.NaN)).toBe(20);
    expect(clampNewWordLimit(Number.NaN, 42)).toBe(42);
    expect(clampNewWordLimit(19.6)).toBe(20); // 四舍五入
  });
});

describe('clampDailyStudyQuota', () => {
  it('收敛到 [10, 500]，非法输入回退默认 50', () => {
    expect(DAILY_STUDY_QUOTA_RANGE_MIN).toBe(10);
    expect(DAILY_STUDY_QUOTA_RANGE_MAX).toBe(500);
    expect(clampDailyStudyQuota(50)).toBe(50);
    expect(clampDailyStudyQuota(0)).toBe(10);
    expect(clampDailyStudyQuota(-5)).toBe(10);
    expect(clampDailyStudyQuota(999)).toBe(500);
    expect(clampDailyStudyQuota(Number.NaN)).toBe(50);
    expect(clampDailyStudyQuota(Number.NaN, 42)).toBe(42);
    expect(clampDailyStudyQuota(49.6)).toBe(50); // 四舍五入
  });
});

describe('effectiveDailyNew', () => {
  it('manual：用设定值（收敛范围），忽略推算值', () => {
    expect(effectiveDailyNew('manual', 75, 30)).toBe(75);
    expect(effectiveDailyNew('manual', 0, 30)).toBe(1);
    expect(effectiveDailyNew('manual', 500, 30)).toBe(200);
  });

  it('auto：推算值 > 0 时用推算值；推算不可用回退设定值', () => {
    expect(effectiveDailyNew('auto', 75, 29)).toBe(29);
    expect(effectiveDailyNew('auto', 75, 0)).toBe(75);
    expect(effectiveDailyNew('auto', 20, -1)).toBe(20);
  });

  it('quota：按新词上限口径走设定值（总量换算在 resolveDailyNewLimit）', () => {
    expect(effectiveDailyNew('quota', 75, 30)).toBe(75);
    expect(effectiveDailyNew('quota', 0, 30)).toBe(1);
  });
});
