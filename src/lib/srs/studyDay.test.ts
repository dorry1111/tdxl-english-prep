/**
 * T06 边界测试：学习日边界（SRS-TEST-CASES 第 4 节 TC-B01/B02）。
 *
 * 断言按本地时区（Asia/Shanghai）解析 fixture 里的无时区 ISO 串；
 * 调度语义本来就是"本地时区的 04:00"，与机器时区一致即有效。
 */
import { describe, expect, test } from 'vitest';

import boundary from '../../../test/fixtures/boundary.json';
import { nextStudyDay0400, studyDayOf, studyDayStart } from './studyDay';

const DAY_START_HOUR = 4;

function parseLocal(iso: string): number {
  return new Date(iso).getTime();
}

describe('nextStudyDay0400 边界', () => {
  for (const fixture of boundary.filter((b) => b.fn === 'nextStudyDay0400')) {
    const now = parseLocal(fixture.input.now as string);
    const expected = parseLocal((fixture.expected as { nextStudyDay0400: string }).nextStudyDay0400);

    test(`${fixture.id}: ${fixture.input.now} -> ${fixture.expected.nextStudyDay0400}`, () => {
      expect(nextStudyDay0400(now, DAY_START_HOUR)).toBe(expected);
    });
  }

  test('B01 与 B02 相差 1 分钟，返回值相差一整天', () => {
    const b01 = parseLocal('2026-10-24T03:59:00');
    const b02 = parseLocal('2026-10-24T04:00:00');
    expect(nextStudyDay0400(b02, DAY_START_HOUR) - nextStudyDay0400(b01, DAY_START_HOUR)).toBe(
      24 * 60 * 60 * 1000,
    );
  });

  test('studyDayOf / studyDayStart 与边界口径自洽', () => {
    const b01 = parseLocal('2026-10-24T03:59:00');
    const b02 = parseLocal('2026-10-24T04:00:00');
    expect(studyDayOf(b01, DAY_START_HOUR)).toBe('2026-10-23'); // 03:59 属于前一学习日
    expect(studyDayOf(b02, DAY_START_HOUR)).toBe('2026-10-24'); // 04:00 整属于当天
    expect(studyDayStart('2026-10-24', DAY_START_HOUR)).toBe(parseLocal('2026-10-24T04:00:00'));
  });
});
