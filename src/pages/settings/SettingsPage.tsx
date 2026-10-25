/**
 * P22 设置（批次 1）+ WebDAV 同步接线 + T19 设置项收口。
 *
 * 已交付：
 * 1. 主题三态切换（跟随系统 / 浅色 / 深色），并持久化到 localStorage；
 * 2. 发音设置：口音（英/美）+ 出卡自动朗读，写入 settings 表；
 * 3. 考试日期：日期选择器 + 剩余天数，供学习计划推算（PlanPage 只读展示，这里改）；
 * 4. 数据同步卡（SyncCard）：WebDAV 连接配置 + 密码（secrets 表）+ 立即同步与报告；
 * 5. 关于卡：版本号（vite define 注入）与双形态安装说明。
 *
 * 新词上限不在本页：它属于「学习计划」页的推算语境（auto/manual 模式在那里切换）。
 */
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ListRow } from '@/components/ui/ListRow';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import {
  BG_THEME_LABEL,
  BG_THEME_ORDER,
  DB,
  DEFAULT_EXAM_DATE,
  PLAN_ENTRY,
  ROUTES,
  SETTINGS_ABOUT,
  SETTINGS_EXAM,
  SETTINGS_TTS,
  THEME,
  THEME_LABEL,
  THEME_ORDER,
} from '@/constants';
import { runDbSelfTest } from '@/db/selfTest';
import { getSettings, patchSettings } from '@/db/repos/settingsRepo';
import { IS_DESKTOP } from '@/lib/desktop';
import { studyDayOf } from '@/lib/srs/studyDay';
import { now, parseDateKey } from '@/lib/time';
import { daysUntil } from '@/pages/plan/planLogic';
import { useUiStore } from '@/store/uiStore';
import type { BgTheme, ThemeMode } from '@/types';

import { BackupCard } from './BackupCard';
import { DesktopCard } from './DesktopCard';
import { AiCard } from './AiCard';
import { StudyHotkeysCard } from './StudyHotkeysCard';
import { SyncCard } from './SyncCard';

const THEME_OPTIONS = THEME_ORDER.map((mode) => ({ value: mode, label: THEME_LABEL[mode] }));

/** 背景颜色选项（只影响浅色态底色） */
const BG_THEME_OPTIONS = BG_THEME_ORDER.map((bg) => ({ value: bg, label: BG_THEME_LABEL[bg] }));

/** 日期输入沿用 SyncCard 的输入框风格，保证两卡视觉一致 */
const DATE_INPUT_CLASS =
  'h-11 w-full rounded-md border border-border bg-surface px-3 text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary';

export default function SettingsPage() {
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const bgTheme = useUiStore((state) => state.bgTheme);
  const setBgTheme = useUiStore((state) => state.setBgTheme);
  const showSuccess = useUiStore((state) => state.toast.success);
  const showError = useUiStore((state) => state.toast.error);
  const navigate = useNavigate();

  /** 全局设置（发音 / 考试日期等），即时持久化 */
  const settings = useLiveQuery(() => getSettings(), [], undefined);

  const handleSelfTest = async (): Promise<void> => {
    const result = await runDbSelfTest();
    if (result.ok) {
      showSuccess(DB.selfTestOk);
    } else {
      showError(DB.selfTestFailed);
    }
    // 详细步骤留在控制台，便于像你这样的维护者一眼看出卡在哪一步
    console.info('[db self test]', result.steps);
  };

  /** 考试日期：严格校验 YYYY-MM-DD 后再写库，非法值不动库只提示 */
  const handleExamDateChange = (value: string): void => {
    if (!parseDateKey(value)) {
      showError(SETTINGS_EXAM.invalidHint);
      return;
    }
    void patchSettings({ examDate: value });
  };

  const examDate = settings?.examDate || DEFAULT_EXAM_DATE;
  // 学习日键（默认 04:00 边界）与 PlanPage 同源，保证两页倒计时一致
  const todayKey = settings ? studyDayOf(now(), settings.dayStartHour) : '';
  const daysLeft = todayKey ? daysUntil(examDate, todayKey) : null;

  return (
    <div className="flex flex-col gap-4">
      <Card title={THEME.title}>
        <SegmentedControl<ThemeMode>
          options={THEME_OPTIONS}
          value={theme}
          onChange={setTheme}
          ariaLabel={THEME.ariaLabel}
        />
        <p className="mt-2 text-xs text-text-3">
          跟随系统时会自动响应系统的浅色/深色切换；手动选择后固定不变。
        </p>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-text">背景颜色</p>
          <SegmentedControl<BgTheme>
            options={BG_THEME_OPTIONS}
            value={bgTheme}
            onChange={setBgTheme}
            ariaLabel="背景颜色"
          />
          <p className="mt-2 text-xs text-text-3">
            浅色模式下的底色风格；深色模式不受影响。
          </p>
        </div>
      </Card>

      <Card title={SETTINGS_TTS.title}>
        {settings ? (
          <div className="flex flex-col gap-3">
            <SegmentedControl<'uk' | 'us'>
              options={[
                { value: 'uk', label: SETTINGS_TTS.accentUk },
                { value: 'us', label: SETTINGS_TTS.accentUs },
              ]}
              value={settings.ttsAccent}
              ariaLabel={SETTINGS_TTS.accentAria}
              onChange={(accent) => {
                void patchSettings({ ttsAccent: accent });
              }}
            />
            <SegmentedControl<'on' | 'off'>
              options={[
                { value: 'on', label: SETTINGS_TTS.autoOn },
                { value: 'off', label: SETTINGS_TTS.autoOff },
              ]}
              value={settings.ttsAutoPlay ? 'on' : 'off'}
              ariaLabel={SETTINGS_TTS.autoAria}
              onChange={(value) => {
                void patchSettings({ ttsAutoPlay: value === 'on' });
              }}
            />
            <p className="text-xs text-text-3">{SETTINGS_TTS.hint}</p>
          </div>
        ) : null}
      </Card>

      <Card title={SETTINGS_EXAM.title}>
        <div className="flex flex-col gap-3">
          <input
            type="date"
            className={DATE_INPUT_CLASS}
            value={examDate}
            aria-label={SETTINGS_EXAM.ariaLabel}
            onChange={(event) => handleExamDateChange(event.target.value)}
          />
          {daysLeft !== null ? (
            <p className="text-sm font-medium text-primary">{SETTINGS_EXAM.daysLeft(daysLeft)}</p>
          ) : null}
          <p className="text-xs text-text-3">{SETTINGS_EXAM.hint}</p>
        </div>
      </Card>

      <StudyHotkeysCard />

      <SyncCard />

      <AiCard />

      <BackupCard />

      {IS_DESKTOP ? <DesktopCard /> : null}

      <Card title={SETTINGS_ABOUT.title}>
        <div className="flex flex-col gap-3">
          <ListRow title={SETTINGS_ABOUT.versionLabel} meta={`v${__APP_VERSION__}`} />
          <div className="text-sm text-text-2">
            <p className="font-medium text-text">{SETTINGS_ABOUT.pwaTitle}</p>
            <p className="mt-1">{SETTINGS_ABOUT.pwaInstall}</p>
          </div>
          <div className="text-sm text-text-2">
            <p className="font-medium text-text">{SETTINGS_ABOUT.desktopTitle}</p>
            <p className="mt-1">{SETTINGS_ABOUT.desktopInstall}</p>
          </div>
        </div>
      </Card>

      <ListRow
        title={PLAN_ENTRY.title}
        subtitle={PLAN_ENTRY.desc}
        onClick={() => navigate(ROUTES.plan)}
      />

      <ListRow
        title="词库启用"
        subtitle="词库的启用开关与叠加顺序在「选词」页管理"
        onClick={() => navigate(ROUTES.books)}
      />

      {import.meta.env.DEV ? (
        <Card title="开发者工具">
          <div className="flex flex-col gap-2">
            <Button variant="secondary" onClick={() => void handleSelfTest()}>
              运行数据库自检
            </Button>
            <p className="text-xs text-text-3">
              等价于控制台执行 <code>__tdxlDbSelfTest()</code>：开库 → 写入 → 读回 → 删除。
            </p>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
