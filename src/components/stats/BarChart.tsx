/**
 * 学习情况双系列柱状图（纯 Tailwind/CSS，做法参考单词统计页的未来 7 天柱状图）。
 *
 * - 两色柱：新学 = primary，复习 = info（次色），柱头带图例；
 * - 柱高按当日双系列最大值归一，最大值 0 时由页面走空态，这里不渲染；
 * - 横轴只标日期后 5 位（MM-DD），与折线图保持同一读数习惯。
 */
import clsx from 'clsx';

import { STATS_DASH } from '@/constants';

/** 柱状图单日数据 */
export interface BarChartItem {
  dayKey: string;
  newLearned: number;
  reviewed: number;
}

export interface BarChartProps {
  items: readonly BarChartItem[];
  className?: string;
}

/** 柱高百分比（最大值 0 时全 0，避免除零） */
function heightPercent(count: number, max: number): number {
  if (max <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((count / max) * 100));
}

export function BarChart({ items, className }: BarChartProps) {
  const max = items.reduce((current, item) => Math.max(current, item.newLearned, item.reviewed), 0);
  if (max <= 0) {
    return null;
  }

  return (
    <div className={clsx('flex flex-col gap-3', className)}>
      {/* 图例 */}
      <div className="flex items-center gap-4 text-xs text-text-2">
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-primary" aria-hidden="true" />
          {STATS_DASH.studyNew}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-info" aria-hidden="true" />
          {STATS_DASH.studyReview}
        </span>
      </div>

      <div
        className="flex items-end gap-1.5"
        role="img"
        aria-label={STATS_DASH.studyAria(
          items.map((item) => `${item.dayKey.slice(5)} 新学 ${item.newLearned} / 复习 ${item.reviewed}`),
        )}
      >
        {items.map((item, index) => (
          <div
            key={item.dayKey || index}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
          >
            <span className="text-xs text-text-2">
              {item.newLearned + item.reviewed > 0 ? item.newLearned + item.reviewed : ''}
            </span>
            <div className="flex h-24 w-full items-end justify-center gap-0.5 rounded-sm bg-surface-2 px-0.5">
              <div
                className="w-full rounded-sm bg-primary"
                style={{ height: `${heightPercent(item.newLearned, max)}%` }}
              />
              <div
                className="w-full rounded-sm bg-info"
                style={{ height: `${heightPercent(item.reviewed, max)}%` }}
              />
            </div>
            <span className="truncate text-xs text-text-3">{item.dayKey.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
