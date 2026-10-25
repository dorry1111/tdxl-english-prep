/**
 * P01 今日首页（T10 接线）。
 *
 * - 数据卡：待复习 / 今日新词剩余 / 词库总词数（useLiveQuery 订阅，答题后自动刷新）；
 * - 主 CTA 三态：开始背单词 / 继续上次（有同日未完成快照时与「重新开始」二选一）/ 今日已达标；
 * - start() 返回 'empty' → Toast「今日已完成」；
 * - 会话进行中（status==='active'，如浏览器返回回首页）→ 直接给「继续背单词」入口。
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LoadingView } from '@/components/feedback/LoadingView';
import { HOME, ROUTES, homeContinueLabel } from '@/constants';
import { getDay } from '@/db/repos/dayRepo';
import { countDue } from '@/db/repos/stateRepo';
import { getSettings } from '@/db/repos/settingsRepo';
import { studyDayOf } from '@/lib/srs/studyDay';
import { loadCoreIndex } from '@/lib/wordbookCache';
import { useSessionStore, resolveDailyNewLimit, type ResumeInfo } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';

export default function HomePage() {
  const navigate = useNavigate();
  const showInfo = useUiStore((state) => state.toast.info);

  const status = useSessionStore((state) => state.status);
  const start = useSessionStore((state) => state.start);
  const checkResume = useSessionStore((state) => state.checkResume);

  const [resumeInfo, setResumeInfo] = useState<ResumeInfo | null>(null);
  const [starting, setStarting] = useState(false);

  // ---------- 订阅数据（useLiveQuery，答题后自动刷新） ----------
  const settings = useLiveQuery(() => getSettings(), [], undefined);
  const todayKey = settings ? studyDayOf(Date.now(), settings.dayStartHour) : '';
  const learnedToday = useLiveQuery(
    async () => (todayKey ? ((await getDay(todayKey))?.newLearned ?? 0) : 0),
    [todayKey],
    0,
  );
  const dueCount = useLiveQuery(() => countDue(Date.now()), [], 0);
  // 词库总词数：内置词库索引 total（索引加载失败时显示 —，不阻塞页面）
  const totalWords = useLiveQuery(
    async () => {
      try {
        return (await loadCoreIndex()).total;
      } catch {
        return null;
      }
    },
    [],
    null,
  );

  // 生效每日新词量（auto 推算 / manual 设定），与学习会话取词同口径
  const dailyLimit = useLiveQuery(
    async () =>
      settings && todayKey ? resolveDailyNewLimit(settings, todayKey) : (settings?.newWordLimit ?? 0),
    [settings, todayKey],
    settings?.newWordLimit ?? 0,
  );
  const newRemaining = Math.max(0, (dailyLimit ?? 0) - (learnedToday ?? 0));

  // ---------- 同日未完成快照 ----------
  useEffect(() => {
    let cancelled = false;
    void checkResume().then((resume) => {
      if (!cancelled && resume) {
        setResumeInfo(resume);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [checkResume]);

  const handleStart = async (options?: { resume?: boolean }): Promise<void> => {
    setStarting(true);
    try {
      const result = await start(options);
      if (result === 'empty') {
        showInfo(HOME.todayDone);
      } else {
        navigate(ROUTES.study);
      }
    } finally {
      setStarting(false);
    }
  };

  const allDone = settings !== undefined && newRemaining === 0 && (dueCount ?? 0) === 0;

  const stats: ReadonlyArray<{ label: string; value: string }> = [
    { label: HOME.dueToday, value: `${dueCount ?? 0}` },
    { label: HOME.newRemaining, value: settings === undefined ? '…' : `${newRemaining}` },
    { label: HOME.totalWords, value: totalWords === null ? '—' : `${totalWords}` },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* 数据卡 */}
      <Card title={HOME.title}>
        <dl className="grid grid-cols-3 gap-3">
          {stats.map(({ label, value }) => (
            <div key={label} className="flex flex-col items-center gap-1 rounded-md bg-surface-2 px-2 py-3">
              <dd className="text-xl font-semibold text-text">{value}</dd>
              <dt className="text-center text-xs text-text-3">{label}</dt>
            </div>
          ))}
        </dl>
      </Card>

      {/* 主 CTA（三态 / 续学二选一 / 会话中直返） */}
      <Card>
        {status === 'active' ? (
          <Button block size="lg" onClick={() => navigate(ROUTES.study)}>
            {HOME.continueActive}
          </Button>
        ) : resumeInfo ? (
          <div className="flex flex-col gap-2">
            <Button block size="lg" disabled={starting} onClick={() => void handleStart({ resume: true })}>
              {homeContinueLabel(resumeInfo.answeredCount)}
            </Button>
            <Button
              block
              size="lg"
              variant="secondary"
              disabled={starting}
              onClick={() => void handleStart()}
            >
              {HOME.restart}
            </Button>
          </div>
        ) : allDone ? (
          <Button
            block
            size="lg"
            variant="secondary"
            disabled={starting}
            onClick={() => void handleStart()}
          >
            {HOME.allDone}
          </Button>
        ) : settings === undefined ? (
          <LoadingView message={HOME.title} />
        ) : (
          <Button block size="lg" disabled={starting} onClick={() => void handleStart()}>
            {HOME.start}
          </Button>
        )}
      </Card>
    </div>
  );
}
