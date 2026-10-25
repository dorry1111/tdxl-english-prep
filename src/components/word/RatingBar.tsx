/**
 * 四档评分条（T09）：揭示答案后出现，四等分按钮。
 *
 * - 颜色走 --c-rate-1..4 语义变量，亮/暗主题自动适配；
 * - 按钮高 56px（iPhone 拇指可触达，T09 验收第 1 条）；
 * - 未揭示时本组件不渲染（底部只显示「显示答案」）。
 */
import { STUDY } from '@/constants';
import { RATING, type Rating } from '@/types';

export interface RatingBarProps {
  onRate: (rating: Rating) => void;
}

const RATING_BUTTONS: ReadonlyArray<{ rating: Rating; label: string; color: string }> = [
  { rating: RATING.FORGOT, label: STUDY.rating1, color: 'var(--c-rate-1)' },
  { rating: RATING.VAGUE, label: STUDY.rating2, color: 'var(--c-rate-2)' },
  { rating: RATING.KNOWN, label: STUDY.rating3, color: 'var(--c-rate-3)' },
  { rating: RATING.MASTERED, label: STUDY.rating4, color: 'var(--c-rate-4)' },
];

export function RatingBar({ onRate }: RatingBarProps) {
  return (
    <div className="flex gap-2" role="group" aria-label={STUDY.ratingGroupLabel}>
      {RATING_BUTTONS.map(({ rating, label, color }) => (
        <button
          key={rating}
          type="button"
          aria-label={`${label}（快捷键 ${rating}）`}
          onClick={() => onRate(rating)}
          className="app-tappable h-14 flex-1 select-none rounded-md border-2 bg-surface text-base font-medium transition-opacity duration-fast hover:opacity-85 active:opacity-70"
          style={{ color, borderColor: color }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
