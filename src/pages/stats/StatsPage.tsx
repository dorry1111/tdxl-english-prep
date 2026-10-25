/**
 * P07 统计总览页 /stats。
 *
 * 指标口径（全部来自真实数据，不放假数据）：
 * - 总词汇量 = countLearnedAll（firstLearnedAt 非空且未删的去重 stateKey）；
 * - 总学习时间 = 全部 StudyDay.durationSec 求和（dayRepo.sumDuration）；
 * - 记忆度 = 已开始学习（lastRating 非空）的词按最近评分三档占比（statsData）；
 * - 艾宾浩斯遗忘曲线 = 当日有活动的词中，现在仍记得的占比（statsData.retentionCurveOf）；
 * - 学习情况 = StudyDay 逐日 newLearned / reviewed + 今日学习时长。
 *
 * 取数策略：wordStates / studyDays 全量 + 范围内 reviewLogs 拉内存算，
 * 与 statsData 纯函数层配套（量级几千，可控）。
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { BarChart } from '@/components/stats/BarChart';
import { LineChart, type LineChartPoint } from '@/components/stats/LineChart';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingView } from '@/components/feedback/LoadingView';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { MS_PER_DAY, STATS_DASH } from '@/constants';
import { listAll as listAllDays, sumDuration } from '@/db/repos/dayRepo';
import { countLearnedAll } from '@/db/repos/forecastRepo';
import { listBetween } from '@/db/repos/logRepo';
import { getSettings } from '@/db/repos/settingsRepo';
import { listAll as listAllStates } from '@/db/repos/stateRepo';
import { studyDayOf, studyDayStart } from '@/lib/srs/studyDay';
import { fmtDuration } from '@/lib/time';
import {
  dayKeysOfRange,
  memoryDistributionOf,
  memoryPercentsOf,
  retentionCurveOf,
  seriesMax,
  studyDaySeries,
  type StatsRangeDays,
} from './statsData';

/** 时间范围二级菜单选项（近 7 天 / 近 30 天 / 近 90 天） */
const RANGE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '7', label: STATS_DASH.range7 },
  { value: '30', label: STATS_DASH.range30 },
  { value: '90', label: STATS_DASH.range90 },
];

/** 解析 SegmentedControl 的字符串值为天数档位（未知值回退 7） */
function toRangeDays(value: string): StatsRangeDays {
  const days = Number(value);
  return days === 30 || days === 90 ? days : 7;
}

/** 卡头右侧的时间范围二级菜单（状态在页面内，不进 URL） */
function RangeSwitch({
  value,
  onChange,
}: {
  value: StatsRangeDays;
  onChange: (days: StatsRangeDays) => void;
}) {
  return (
    <div className="w-36">
      <SegmentedControl
        size="sm"
        ariaLabel={STATS_DASH.rangeAria}
        value={String(value)}
        options={RANGE_OPTIONS}
        onChange={(next) => onChange(toRangeDays(next))}
      />
    </div>
  );
}

/** 记忆度三档展示行（颜色沿用四档评级的 rate 色板） */
interface MemoryRow {
  label: string;
  percent: number;
  dot: string;
}

export default function StatsPage() {
  // 两个功能区各自持范围状态（默认近 7 天），互不影响
  const [curveRange, setCurveRange] = useState<StatsRangeDays>(7);
  const [studyRange, setStudyRange] = useState<StatsRangeDays>(7);

  const settings = useLiveQuery(() => getSettings(), [], undefined);
  const todayKey = settings ? studyDayOf(Date.now(), settings.dayStartHour) : '';

  const data = useLiveQuery(
    async () => {
      if (!settings || !todayKey) {
        return null;
      }
      const curveDayKeys = dayKeysOfRange(todayKey, curveRange);
      const studyDayKeys = dayKeysOfRange(todayKey, studyRange);
      const [states, logs, days, totalLearned, totalDuration] = await Promise.all([
        listAllStates(),
        listBetween(
          studyDayStart(curveDayKeys[0] ?? todayKey, settings.dayStartHour),
          Date.now() + MS_PER_DAY,
        ),
        listAllDays(),
        countLearnedAll(),
        sumDuration(),
      ]);
      const series = studyDaySeries(days, studyDayKeys);
      const memory = memoryDistributionOf(states);
      return {
        memory,
        memoryRows: memoryPercentsOf(memory),
        curvePoints: retentionCurveOf({
          dayKeys: curveDayKeys,
          dayStartHour: settings.dayStartHour,
          states,
          logs,
        })
          .filter((point) => point.retention !== null)
          .map((point): LineChartPoint => ({
            dayKey: point.dayKey,
            value: point.retention ?? 0,
          })),
        series,
        seriesMax: seriesMax(series),
        totalLearned,
        totalDuration,
        todayDay: days.find((day) => day.studyDay === todayKey) ?? null,
      };
    },
    [settings, todayKey, curveRange, studyRange],
    null,
  );

  if (!settings || !todayKey || !data) {
    return <LoadingView message={STATS_DASH.title} />;
  }

  const percents = data.memoryRows;
  const memoryRows: ReadonlyArray<MemoryRow> = [
    { label: STATS_DASH.memoryRemembered, percent: percents.remembered, dot: 'bg-rate-4' },
    { label: STATS_DASH.memoryFuzzy, percent: percents.fuzzy, dot: 'bg-rate-2' },
    { label: STATS_DASH.memoryForgotten, percent: percents.forgotten, dot: 'bg-rate-1' },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* 顶部长横条卡：总词汇量 / 总学习时间 / 记忆度 */}
      <Card>
        <dl className="grid grid-cols-3 gap-3">
          <div className="flex flex-col items-center gap-1 rounded-md bg-surface-2 px-2 py-3">
            <dd className="text-xl font-semibold text-text">{data.totalLearned}</dd>
            <dt className="text-center text-xs text-text-3">{STATS_DASH.totalLearned}</dt>
          </div>
          <div className="flex flex-col items-center gap-1 rounded-md bg-surface-2 px-2 py-3">
            <dd className="text-xl font-semibold text-text">{fmtDuration(data.totalDuration)}</dd>
            <dt className="text-center text-xs text-text-3">{STATS_DASH.totalDuration}</dt>
          </div>
          <div className="flex flex-col items-center gap-1 rounded-md bg-surface-2 px-2 py-3">
            {data.memory.total === 0 ? (
              <>
                <dd className="text-xl font-semibold text-text">{STATS_DASH.memoryEmpty}</dd>
                <dt className="text-center text-xs text-text-3">{STATS_DASH.memoryTitle}</dt>
              </>
            ) : (
              <>
                <dd className="flex w-full flex-col gap-0.5">
                  {memoryRows.map((row) => (
                    <span
                      key={row.label}
                      className="flex items-center justify-between gap-1 text-xs text-text-2"
                    >
                      <span className="flex items-center gap-1">
                        <span className={`h-2 w-2 rounded-full ${row.dot}`} aria-hidden="true" />
                        {row.label}
                      </span>
                      <span className="font-semibold text-text">
                        {STATS_DASH.memoryPercent(row.percent)}
                      </span>
                    </span>
                  ))}
                </dd>
                <dt className="text-center text-xs text-text-3">{STATS_DASH.memoryTitle}</dt>
              </>
            )}
          </div>
        </dl>
        <p className="mt-3 text-xs text-text-3">{STATS_DASH.memoryHint}</p>
      </Card>

      {/* 功能区① 艾宾浩斯遗忘曲线 */}
      <Card
        title={STATS_DASH.curveTitle}
        action={<RangeSwitch value={curveRange} onChange={setCurveRange} />}
      >
        <p className="mb-2 text-xs text-text-3">{STATS_DASH.curveDesc}</p>
        {data.curvePoints.length < 2 ? (
          <EmptyState
            compact
            icon="stats"
            title={STATS_DASH.curveEmptyTitle}
            description={STATS_DASH.curveEmptyDesc}
          />
        ) : (
          <LineChart points={data.curvePoints} />
        )}
      </Card>

      {/* 功能区② 学习情况 */}
      <Card
        title={STATS_DASH.studyTitle}
        action={<RangeSwitch value={studyRange} onChange={setStudyRange} />}
      >
        {data.seriesMax === 0 ? (
          <EmptyState
            compact
            icon="today"
            title={STATS_DASH.studyEmptyTitle}
            description={STATS_DASH.studyEmptyDesc}
          />
        ) : (
          <BarChart items={data.series} />
        )}
        <p className="mt-3 text-xs text-text-3">
          {STATS_DASH.todayDurationLine(fmtDuration(data.todayDay?.durationSec ?? 0))}
        </p>
      </Card>
    </div>
  );
}
