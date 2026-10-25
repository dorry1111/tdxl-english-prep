/**
 * P03 会话结算页（T10）。
 *
 * 数据来自 sessionStore.settleSummary（submit 内部结算时就绪）：
 * 本次词数（新/复习拆分）、正确率（用例 A 口径：首次评分 ∈ {2,3,4} / 去重词数）、
 * 四档分布条、用时、不稳定词提醒；底部「再学一组」「返回首页」。
 * 无结算数据时显示明确空态，不是空白。
 */
import { useNavigate } from 'react-router';
import { useEffect } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { HOME, ROUTES, STUDY, SUMMARY, summaryUnstableLine } from '@/constants';
import { maybeAutoSync } from '@/lib/sync/autorun';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import type { Rating } from '@/types';
import { formatAccuracy, formatDuration } from './studyLogic';

/** 四档分布的展示元数据（颜色走语义变量） */
const RATING_META: ReadonlyArray<{ rating: Rating; label: string; color: string }> = [
  { rating: 1, label: STUDY.rating1, color: 'var(--c-rate-1)' },
  { rating: 2, label: STUDY.rating2, color: 'var(--c-rate-2)' },
  { rating: 3, label: STUDY.rating3, color: 'var(--c-rate-3)' },
  { rating: 4, label: STUDY.rating4, color: 'var(--c-rate-4)' },
];

export default function StudySummaryPage() {
  const navigate = useNavigate();
  const showInfo = useUiStore((state) => state.toast.info);
  const summary = useSessionStore((state) => state.settleSummary);
  const session = useSessionStore((state) => state.session);
  const start = useSessionStore((state) => state.start);
  const exit = useSessionStore((state) => state.exit);

  // 会话结算后触发自动同步（不 await，失败静默；内部有开关/间隔/单飞守卫）
  useEffect(() => {
    void maybeAutoSync();
  }, []);

  const handleBackHome = (): void => {
    exit();
    navigate(ROUTES.home);
  };

  const handleAgain = async (): Promise<void> => {
    const result = await start();
    if (result === 'started') {
      navigate(ROUTES.study);
    } else {
      showInfo(HOME.todayDone);
    }
  };

  if (!summary) {
    return (
      <Card title={SUMMARY.title}>
        <EmptyState
          icon="today"
          title={SUMMARY.noDataTitle}
          description={SUMMARY.noDataDesc}
          action={
            <Button variant="secondary" onClick={handleBackHome}>
              {SUMMARY.backHome}
            </Button>
          }
        />
      </Card>
    );
  }

  const ratingCounts = summary.ratingCounts;
  const maxCount = Math.max(...RATING_META.map((meta) => ratingCounts[String(meta.rating) as '1' | '2' | '3' | '4']), 1);

  return (
    <div className="flex flex-col gap-4">
      <Card title={SUMMARY.title}>
        <div className="flex flex-col gap-5">
          {/* 本次词数（新/复习拆分） */}
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-text-2">{SUMMARY.answered}</span>
            <span className="text-2xl font-semibold text-text">
              {summary.answeredCount}
              <span className="ml-1 text-sm font-normal text-text-3">{SUMMARY.unitWord}</span>
            </span>
          </div>
          <p className="-mt-3 text-right text-xs text-text-3">
            {SUMMARY.newCount} {session?.newCount ?? 0} · {SUMMARY.reviewCount}{' '}
            {session?.reviewCount ?? 0}
          </p>

          {/* 正确率 */}
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-text-2">{SUMMARY.accuracy}</span>
            <span className="text-2xl font-semibold text-primary">
              {formatAccuracy(summary.accuracy.rate, summary.accuracy.correct, summary.accuracy.total)}
            </span>
          </div>

          {/* 四档分布条 */}
          <div className="flex flex-col gap-2">
            <span className="text-sm text-text-2">{SUMMARY.ratingDist}</span>
            {RATING_META.map(({ rating, label, color }) => {
              const count = ratingCounts[String(rating) as '1' | '2' | '3' | '4'];
              return (
                <div key={rating} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-sm" style={{ color }}>
                    {label}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(count / maxCount) * 100}%`, backgroundColor: color }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-sm text-text-2">{count}</span>
                </div>
              );
            })}
          </div>

          {/* 用时 */}
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-text-2">{SUMMARY.duration}</span>
            <span className="text-base font-medium text-text">
              {formatDuration(summary.durationSec)}
            </span>
          </div>
        </div>
      </Card>

      {/* 不稳定词提醒 */}
      {summary.unstableCount > 0 ? (
        <Card className="border-danger bg-danger-soft" bodyClassName="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 text-danger">
            <Icon name="alert" size={18} />
          </span>
          <div>
            <p className="text-sm font-medium text-text">{SUMMARY.unstableTitle}</p>
            <p className="mt-1 text-sm text-text-2">
              {summaryUnstableLine(summary.unstableCount)}
              {SUMMARY.unstableDesc}
            </p>
          </div>
        </Card>
      ) : null}

      {/* 操作区 */}
      <div className="flex flex-col gap-2">
        <Button block size="lg" onClick={() => void handleAgain()}>
          {SUMMARY.again}
        </Button>
        <Button block size="lg" variant="secondary" onClick={handleBackHome}>
          {SUMMARY.backHome}
        </Button>
      </div>
    </div>
  );
}
