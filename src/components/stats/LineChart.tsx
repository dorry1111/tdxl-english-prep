/**
 * 艾宾浩斯遗忘曲线：纯 SVG 折线图（不引图表库，ARCHITECTURE 7.3 与单词统计柱状图同口径）。
 *
 * - viewBox 自适应容器宽度，纵轴固定 0 / 50 / 100% 三条刻度线；
 * - 横轴只标首尾两个日期（中间日期靠 Tooltip 意义不大，保持简约）；
 * - 少于 2 个有效点时不画折线（返回 null，由页面展示空态）。
 */
import clsx from 'clsx';

import { STATS_DASH } from '@/constants';

/** 折线图数据点（页面已过滤掉无活动的 null 日） */
export interface LineChartPoint {
  dayKey: string;
  /** 保持率 0~100 */
  value: number;
}

export interface LineChartProps {
  points: readonly LineChartPoint[];
  className?: string;
}

const VIEW_W = 300;
const VIEW_H = 150;
const PAD_LEFT = 30;
const PAD_RIGHT = 8;
const TOP_Y = 10;
const BASE_Y = 128;
const MID_Y = (TOP_Y + BASE_Y) / 2;
const PLOT_W = VIEW_W - PAD_LEFT - PAD_RIGHT;

/** 横坐标：均匀分布，单点时居中 */
function xOf(index: number, count: number): number {
  if (count <= 1) {
    return PAD_LEFT + PLOT_W / 2;
  }
  return PAD_LEFT + (PLOT_W * index) / (count - 1);
}

/** 纵坐标：0% 在基线，100% 在顶部 */
function yOf(value: number): number {
  const clamped = Math.min(100, Math.max(0, value));
  return BASE_Y - ((BASE_Y - TOP_Y) * clamped) / 100;
}

export function LineChart({ points, className }: LineChartProps) {
  if (points.length < 2) {
    return null;
  }
  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${xOf(index, points.length).toFixed(1)} ${yOf(point.value).toFixed(1)}`)
    .join(' ');
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className={clsx('h-auto w-full text-primary', className)}
      role="img"
      aria-label={STATS_DASH.curveAria(
        points.map((point) => `${point.dayKey.slice(5)} ${point.value}%`),
      )}
      focusable="false"
    >
      {/* 纵轴刻度线：0 / 50 / 100% */}
      <g className="stroke-border" strokeWidth={0.6}>
        <line x1={PAD_LEFT} x2={VIEW_W - PAD_RIGHT} y1={BASE_Y} y2={BASE_Y} />
        <line x1={PAD_LEFT} x2={VIEW_W - PAD_RIGHT} y1={MID_Y} y2={MID_Y} strokeDasharray="2 3" />
        <line x1={PAD_LEFT} x2={VIEW_W - PAD_RIGHT} y1={TOP_Y} y2={TOP_Y} strokeDasharray="2 3" />
      </g>
      <g className="fill-text-3 text-[8px]">
        <text x={PAD_LEFT - 4} y={BASE_Y + 3} textAnchor="end">
          0%
        </text>
        <text x={PAD_LEFT - 4} y={MID_Y + 3} textAnchor="end">
          50%
        </text>
        <text x={PAD_LEFT - 4} y={TOP_Y + 3} textAnchor="end">
          100%
        </text>
      </g>

      {/* 横轴首尾日期 */}
      <g className="fill-text-3 text-[9px]">
        <text x={xOf(0, points.length)} y={VIEW_H - 4} textAnchor="middle">
          {first?.dayKey.slice(5) ?? ''}
        </text>
        <text x={xOf(points.length - 1, points.length)} y={VIEW_H - 4} textAnchor="middle">
          {last?.dayKey.slice(5) ?? ''}
        </text>
      </g>

      {/* 折线 + 数据点 */}
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <g className="fill-primary">
        {points.map((point, index) => (
          <circle key={point.dayKey} cx={xOf(index, points.length)} cy={yOf(point.value)} r={2.4} />
        ))}
      </g>
    </svg>
  );
}
