/**
 * P06 单词统计页。
 *
 * 指标口径：
 * - 今日已学 / 今日复习：取 StudyDay（学习日 04:00 切分）；
 * - 待复习：wordStates 中 dueAt ≤ 现在且已开始学习的条数（走 dueAt 索引）；
 * - 连续打卡：有答题记录的学习日连成的最长当前段（今天没背时从昨天算起）；
 * - 累计掌握：熟练度 ≥ MASTER_L（8）的条数（走 level 索引）；
 * - 未来 7 天柱状图：按学习日边界切 7 个区间，逐个 count，纯 Tailwind 柱，不引图表库。
 */
import { useLiveQuery } from 'dexie-react-hooks';

import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingView } from '@/components/feedback/LoadingView';
import { MASTER_L, STATS_VOCAB } from '@/constants';
import { getDay, listAnswerDays } from '@/db/repos/dayRepo';
import { countDueUpTo, countDueBetween, countMastered } from '@/db/repos/forecastRepo';
import { getSettings } from '@/db/repos/settingsRepo';
import { studyDayOf, studyDayStart } from '@/lib/srs/studyDay';
import { fmtDuration } from '@/lib/time';
import { barHeightPercent, computeStreak, maxOf, nextDayKey } from './statsLogic';

/** 未来 7 天柱状图的天数 */
const FORECAST_DAYS = 7;

export default function StatsVocabPage() {
  const settings = useLiveQuery(() => getSettings(), [], undefined);
  const todayKey = settings ? studyDayOf(Date.now(), settings.dayStartHour) : '';

  const data = useLiveQuery(
    async () => {
      if (!settings || !todayKey) {
        return null;
      }
      const dayStartHour = settings.dayStartHour;
      const today = await getDay(todayKey);
      const answerDays = await listAnswerDays();
      const mastered = await countMastered(MASTER_L);
      const dueNow = await countDueUpTo(Date.now());

      // 未来 7 天：按学习日边界切区间，逐个区间 count（dueAt 索引区间查询）
      const dayKeys: string[] = [];
      const buckets: number[] = [];
      let cursor = todayKey;
      for (let index = 0; index < FORECAST_DAYS; index += 1) {
        dayKeys.push(cursor);
        const from = index === 0 ? 0 : studyDayStart(cursor, dayStartHour);
        const to = studyDayStart(nextDayKey(cursor), dayStartHour);
        buckets.push(await countDueBetween(from, to));
        cursor = nextDayKey(cursor);
      }
      return {
        today,
        answerDays,
        mastered,
        dueNow,
        dayKeys,
        buckets,
      };
    },
    [settings, todayKey],
    null,
  );

  if (!settings || !todayKey || !data) {
    return <LoadingView message={STATS_VOCAB.title} />;
  }

  const day = data.today;
  const streak = computeStreak(data.answerDays, todayKey);
  const max = maxOf(data.buckets);
  const hasAnyData = data.mastered > 0 || data.dueNow > 0 || (day?.answerCount ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* 今日数据 */}
      <Card title={STATS_VOCAB.todayTitle}>
        <dl className="grid grid-cols-3 gap-3">
          <div className="flex flex-col items-center gap-1 rounded-md bg-surface-2 px-2 py-3">
            <dd className="text-xl font-semibold text-text">{day?.newLearned ?? 0}</dd>
            <dt className="text-center text-xs text-text-3">{STATS_VOCAB.learnedToday}</dt>
          </div>
          <div className="flex flex-col items-center gap-1 rounded-md bg-surface-2 px-2 py-3">
            <dd className="text-xl font-semibold text-text">{day?.reviewed ?? 0}</dd>
            <dt className="text-center text-xs text-text-3">{STATS_VOCAB.reviewedToday}</dt>
          </div>
          <div className="flex flex-col items-center gap-1 rounded-md bg-surface-2 px-2 py-3">
            <dd className="text-xl font-semibold text-text">{day?.answerCount ?? 0}</dd>
            <dt className="text-center text-xs text-text-3">{STATS_VOCAB.answersToday}</dt>
          </div>
        </dl>
        <p className="mt-3 text-xs text-text-3">
          {STATS_VOCAB.durationLine(fmtDuration(day?.durationSec ?? 0))}
        </p>
      </Card>

      {/* 打卡与掌握 */}
      <Card title={STATS_VOCAB.progressTitle}>
        <dl className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-text-2">{STATS_VOCAB.streakLabel}</dt>
            <dd className="text-xl font-semibold text-primary">
              {streak}
              <span className="ml-1 text-sm font-normal text-text-3">{STATS_VOCAB.streakUnit}</span>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-text-2">{STATS_VOCAB.dueLabel}</dt>
            <dd className="text-xl font-semibold text-text">{data.dueNow}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-text-2">{STATS_VOCAB.masteredLabel}</dt>
            <dd className="text-xl font-semibold text-text">{data.mastered}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-text-3">{STATS_VOCAB.masteredHint(MASTER_L)}</p>
      </Card>

      {/* 未来 7 天到期柱状图（纯 CSS 柱，不引图表库） */}
      <Card title={STATS_VOCAB.forecastTitle}>
        {max === 0 ? (
          <EmptyState compact icon="today" title={STATS_VOCAB.forecastEmpty} />
        ) : (
          <div
            className="flex items-end gap-2"
            role="img"
            aria-label={STATS_VOCAB.forecastAria(data.buckets)}
          >
            {data.buckets.map((count, index) => {
              const dayKey = data.dayKeys[index] ?? '';
              return (
                <div key={dayKey || index} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span className="text-xs text-text-2">{count}</span>
                  <div className="flex h-24 w-full items-end rounded-sm bg-surface-2">
                    <div
                      className="w-full rounded-sm bg-primary"
                      style={{ height: `${Math.max(barHeightPercent(count, max), count > 0 ? 6 : 0)}%` }}
                    />
                  </div>
                  <span className="truncate text-xs text-text-3">
                    {index === 0 ? STATS_VOCAB.forecastToday : dayKey.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {!hasAnyData ? (
        <Card>
          <EmptyState
            compact
            icon="words"
            title={STATS_VOCAB.emptyTitle}
            description={STATS_VOCAB.emptyDesc}
          />
        </Card>
      ) : null}
    </div>
  );
}
