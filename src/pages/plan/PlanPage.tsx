/**
 * P04 学习计划页。
 *
 * 全部数字都来自真实数据：
 * - 考试日期取 Settings.examDate（默认 DEFAULT_EXAM_DATE，可在设置里改）；
 * - 剩余词数 = 当前词库总词数 − 已学（走索引 count，不全量拉取）；
 * - 每日建议新词 = ceil(剩余 / 剩余天数)，夹到 [1, 50]（见 planLogic）；
 * - 预计学完日 = 今天 + ceil(剩余 / 每日新词)；
 * - 复习压力：当前待复习量 / 明日新增 / 未来一周到期量。
 */
import { useNavigate } from 'react-router';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { AiResultDialog, type AiDialogState } from '@/components/ai/AiResultDialog';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LoadingView } from '@/components/feedback/LoadingView';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Icon } from '@/components/ui/Icon';
import { Tag } from '@/components/ui/Tag';
import { BUILTIN_BOOK_ID, BOOKS, DEFAULT_DAILY_STUDY_QUOTA, DEFAULT_EXAM_DATE, EXAMS, MS_PER_DAY, PLAN, ROUTES } from '@/constants';
import { countDueByBook, countDueUpTo, countLearnedByBook } from '@/db/repos/forecastRepo';
import { getSettings, patchSettings } from '@/db/repos/settingsRepo';
import { removeCached } from '@/db/repos/llmCacheRepo';
import { loadCoreIndex, peekCoreIndex } from '@/lib/wordbookCache';
import { IS_DESKTOP } from '@/lib/desktop';
import { AI_NOT_CONFIGURED, runAi } from '@/lib/aiRunner';
import { advisePlan } from '@/lib/llm';
import { studyDayOf } from '@/lib/srs/studyDay';
import { resolveDailyNewLimit } from '@/store/sessionStore';
import { currentBookIdOf } from '@/store/bookSelection';
import { useUiStore } from '@/store/uiStore';
import {
  DAILY_STUDY_QUOTA_RANGE_MAX,
  DAILY_STUDY_QUOTA_RANGE_MIN,
  NEW_WORD_LIMIT_MAX,
  NEW_WORD_LIMIT_MIN,
  PLAN_DAILY_NEW_CAP,
  clampDailyStudyQuota,
  clampNewWordLimit,
  daysUntil,
  estimatedFinishDateKey,
  reviewPressureOf,
  suggestDailyNew,
  willMissDeadline,
} from './planLogic';

export default function PlanPage() {
  const navigate = useNavigate();
  const toastSuccess = useUiStore((state) => state.toast.success);

  const settings = useLiveQuery(() => getSettings(), [], undefined);
  const todayKey = settings ? studyDayOf(Date.now(), settings.dayStartHour) : '';
  const [aiDialog, setAiDialog] = useState<{ state: AiDialogState; content: string; error: string } | null>(null);
  /** 采纳控件里的建议值（用户可改；默认取报告里的建议或当前生效值） */
  const [adoptValue, setAdoptValue] = useState(20);

  /** 生效每日新词量（auto 推算 / manual 设定），与学习会话取词同口径 */
  const dailyLimit = useLiveQuery(
    async () => (settings && todayKey ? resolveDailyNewLimit(settings, todayKey) : null),
    [settings, todayKey],
    null,
  );

  /** 计划数据：剩余词数 + 复习压力（一次性聚合，避免每张卡各查一遍） */
  const plan = useLiveQuery(
    async () => {
      if (!settings || !todayKey) {
        return null;
      }
      const bookId = currentBookIdOf(settings);
      let total: number | null = peekCoreIndex()?.total ?? null;
      if (total === null && bookId === BUILTIN_BOOK_ID) {
        try {
          total = (await loadCoreIndex()).total;
        } catch {
          total = null;
        }
      }
      const learned = await countLearnedByBook(bookId);
      const nowTs = Date.now();
      const [dueNow, dueTomorrow, dueWeek] = await Promise.all([
        countDueUpTo(nowTs),
        countDueUpTo(nowTs + MS_PER_DAY),
        countDueUpTo(nowTs + 7 * MS_PER_DAY),
      ]);
      return {
        bookId,
        total,
        learned,
        due: await countDueByBook(bookId, nowTs),
        dueNow,
        dueTomorrow: Math.max(0, dueTomorrow - dueNow),
        dueWeek: Math.max(0, dueWeek - dueNow),
      };
    },
    [settings, todayKey],
    null,
  );

  if (!settings || !todayKey || !plan) {
    return <LoadingView message={PLAN.title} />;
  }

  const examDate = settings.examDate || DEFAULT_EXAM_DATE;
  const remaining = Math.max(0, (plan.total ?? 0) - plan.learned);
  const days = daysUntil(examDate, todayKey);
  const dailyNew = dailyLimit ?? suggestDailyNew(remaining, days);
  const finishKey = estimatedFinishDateKey(todayKey, remaining, dailyNew);
  const missed = willMissDeadline(finishKey, examDate);
  const pressure = reviewPressureOf(plan.dueNow);
  const manualMode = settings.newWordLimitMode === 'manual';
  const quotaMode = settings.newWordLimitMode === 'quota';

  // ---------- AI 评估（桌面独占）：指标 → 建议；采纳才写设置 ----------
  // 注意：必须在「数据未就绪提前 return」之前定义为普通函数（不能放 return 之后，
  // 也不能用 hooks——首帧 loading 直接 return 会导致 hooks 数量不一致）。
  const runAdvise = (regenerate: boolean): void => {
    setAiDialog({ state: 'loading', content: '', error: '' });
    void (async () => {
      try {
        if (regenerate) {
          await removeCached('plan', todayKey);
        }
        const result = await runAi('plan', todayKey, (config) =>
          advisePlan(config, {
            daysUntilExam: days,
            remainingWords: remaining,
            dailyNew,
            estimatedFinish: finishKey,
            willMissDeadline: missed,
            dueNow: plan.dueNow,
            dueTomorrow: plan.dueTomorrow,
            dueThisWeek: plan.dueWeek,
            inNotebook: plan.due,
          }),
        );
        // 从报告里抽取建议值失败也不阻塞：默认给当前生效值让用户自己改
        const match = result.content.match(/建议[^\d]{0,12}(\d{1,3})/);
        setAdoptValue(clampNewWordLimit(match ? Number(match[1]) : dailyNew));
        setAiDialog({ state: 'done', content: result.content, error: '' });
      } catch (error) {
        setAiDialog({
          state: 'error',
          content: '',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  };

  const handleAdopt = async (): Promise<void> => {
    try {
      await patchSettings({ newWordLimitMode: 'manual', newWordLimit: clampNewWordLimit(adoptValue) });
      toastSuccess(EXAMS.aiAdoptedToast);
      setAiDialog(null);
    } catch {
      // patchSettings 失败时对话框保持打开，用户可重试；错误由 dexie 层统一文案
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 倒计时 */}
      <Card title={PLAN.countdownTitle}>
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm text-text-2">{PLAN.examDateLabel}</span>
          <span className="text-sm font-medium text-text">{examDate}</span>
        </div>
        <div className="mt-3 flex items-end justify-between gap-4">
          <span className="text-sm text-text-2">{PLAN.daysLeftLabel}</span>
          <span className="text-3xl font-semibold text-primary">
            {days}
            <span className="ml-1 text-sm font-normal text-text-3">{PLAN.daysUnit}</span>
          </span>
        </div>
      </Card>

      {/* 推算结果 */}
      <Card title={PLAN.planTitle}>
        <dl className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-text-2">{PLAN.totalLabel}</dt>
            <dd className="text-base font-medium text-text">
              {plan.total === null ? '—' : plan.total}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-text-2">{PLAN.learnedLabel}</dt>
            <dd className="text-base font-medium text-text">{plan.learned}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-text-2">{PLAN.remainingLabel}</dt>
            <dd className="text-base font-medium text-text">{remaining}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-text-2">{PLAN.dailyNewLabel}</dt>
            <dd className="text-2xl font-semibold text-primary">
              {dailyNew}
              <span className="ml-1 text-sm font-normal text-text-3">{PLAN.wordsPerDayUnit}</span>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-text-2">{PLAN.finishDateLabel}</dt>
            <dd className="text-base font-medium text-text">{finishKey}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-text-3">
          {PLAN.capHint(PLAN_DAILY_NEW_CAP)}
        </p>
        {IS_DESKTOP ? (
          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              icon={<Icon name="sparkle" size={16} />}
              onClick={() => runAdvise(false)}
            >
              {EXAMS.aiAdviseButton}
            </Button>
          </div>
        ) : null}
      </Card>

      {/* 每日学习量：自动推算 / 按新词数 / 按总学习量（写入 Settings，学习会话与首页同口径） */}
      <Card title={PLAN.limitTitle}>
        <SegmentedControl
          ariaLabel={PLAN.limitAria}
          value={settings.newWordLimitMode}
          options={[
            { value: 'auto', label: PLAN.modeAuto },
            { value: 'manual', label: PLAN.modeManual },
            { value: 'quota', label: PLAN.modeQuota },
          ]}
          onChange={(mode) => {
            void patchSettings({ newWordLimitMode: mode });
          }}
        />
        {quotaMode ? (
          <>
            <div className="mt-3 flex justify-center">
              <NumberStepper
                value={clampDailyStudyQuota(settings.dailyStudyQuota ?? DEFAULT_DAILY_STUDY_QUOTA)}
                min={DAILY_STUDY_QUOTA_RANGE_MIN}
                max={DAILY_STUDY_QUOTA_RANGE_MAX}
                ariaLabel={PLAN.quotaAria}
                onChange={(value) => {
                  void patchSettings({ dailyStudyQuota: value });
                }}
              />
            </div>
            <p className="mt-2 text-xs text-text-3">{PLAN.quotaHint}</p>
          </>
        ) : manualMode ? (
          <>
            <div className="mt-3 flex justify-center">
              <NumberStepper
                value={clampNewWordLimit(settings.newWordLimit)}
                min={NEW_WORD_LIMIT_MIN}
                max={NEW_WORD_LIMIT_MAX}
                ariaLabel={PLAN.limitAria}
                onChange={(value) => {
                  void patchSettings({ newWordLimit: value });
                }}
              />
            </div>
            <p className="mt-2 text-xs text-text-3">
              {PLAN.manualHint(clampNewWordLimit(settings.newWordLimit))}
            </p>
          </>
        ) : (
          <p className="mt-3 text-xs text-text-3">{PLAN.autoHint(dailyNew)}</p>
        )}
      </Card>

      {/* 告警 */}
      {missed || remaining === 0 ? (
        <Card className={missed ? 'border-danger bg-danger-soft' : undefined}>
          <p className="text-sm text-text">
            {missed ? PLAN.missDeadlineText : PLAN.allLearnedText}
          </p>
        </Card>
      ) : null}

      {/* 复习压力 */}
      <Card title={PLAN.reviewTitle}>
        <dl className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-text-2">{PLAN.dueTodayLabel}</dt>
            <dd className="flex items-center gap-2">
              <span className="text-base font-medium text-text">{plan.dueNow}</span>
              <Tag
                color={
                  pressure === 'heavy'
                    ? 'var(--c-danger)'
                    : pressure === 'light'
                      ? 'var(--c-warn)'
                      : 'var(--c-success)'
                }
              >
                {pressure === 'heavy'
                  ? PLAN.pressureHeavy
                  : pressure === 'light'
                    ? PLAN.pressureLight
                    : PLAN.pressureNone}
              </Tag>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-text-2">{PLAN.dueTomorrowLabel}</dt>
            <dd className="text-base font-medium text-text">{plan.dueTomorrow}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-text-2">{PLAN.dueWeekLabel}</dt>
            <dd className="text-base font-medium text-text">{plan.dueWeek}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-text-2">{PLAN.dueInBookLabel}</dt>
            <dd className="text-base font-medium text-text">{plan.due}</dd>
          </div>
        </dl>
      </Card>

      {/* 去背单词 / 去选词库 */}
      <Card>
        <div className="flex flex-col gap-2">
          <Button block size="lg" onClick={() => navigate(ROUTES.study)}>
            {PLAN.goStudy}
          </Button>
          <Button
            block
            size="lg"
            variant="secondary"
            onClick={() => navigate(ROUTES.books)}
          >
            {BOOKS.startLearning}
          </Button>
        </div>
      </Card>

      <p className="px-1 text-xs text-text-3">{PLAN.footerHint}</p>

      {/* AI 评估对话框（桌面独占）：只给建议，「采纳」才写入每日新词量 */}
      {aiDialog ? (
        <AiResultDialog
          open
          title={EXAMS.aiAdviseDialogTitle}
          state={aiDialog.state}
          content={aiDialog.content}
          error={aiDialog.error || AI_NOT_CONFIGURED}
          onRegenerate={() => runAdvise(true)}
          onClose={() => setAiDialog(null)}
          footerExtra={
            <>
              <span className="text-xs text-text-3">{PLAN.dailyNewLabel}</span>
              <NumberStepper
                value={adoptValue}
                min={NEW_WORD_LIMIT_MIN}
                max={NEW_WORD_LIMIT_MAX}
                ariaLabel={PLAN.limitAria}
                onChange={setAdoptValue}
              />
              <Button size="sm" onClick={() => void handleAdopt()}>
                {EXAMS.aiAdoptButton}
              </Button>
            </>
          }
        />
      ) : null}
    </div>
  );
}
