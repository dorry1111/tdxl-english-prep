/**
 * 数据同步卡（设置页，v1.9.0 重构：免输入一键连接）。
 *
 * 两态 UI：
 * - 未连接：大按钮「连接 NAS」→ connectNas 探测管线（上次地址 → 同源 → mDNS → 子网扫描），
 *   命中后自动写入配置（含托管凭据）并开启同步；失败给出具体阶段 + 引导高级设置。
 * - 已连接：状态条（绿点 + 主机 + 最近同步 + 统计）+ 自动同步 toggle + 立即同步；
 *   高级设置折叠区保留全部手填能力（地址/账号/密码/代理）与断开连接。
 *
 * 兼容：旧版本已配置的设备（webdavUrl 非空且 syncEnabled）直接进入已连接态，无需重新连接。
 */
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { SETTINGS_SYNC } from '@/constants';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { getSecret, getSettings, patchSettings, setSecret } from '@/db/repos/settingsRepo';
import { IS_DESKTOP } from '@/lib/desktop';
import { IS_NATIVE } from '@/lib/platform';
import { syncNow, SYNC_ERROR_MESSAGES } from '@/lib/sync/engine';
import { connectNas, connectionPatchFor, NAS_DAV_PASSWORD } from '@/lib/sync/autoConnect';
import { checkAndApplyDatasetUpdates } from '@/lib/dataset';
import { fmtDate } from '@/lib/time';
import { useUiStore } from '@/store/uiStore';
import type { SyncReport } from '@/types';

const INPUT_CLASS =
  'h-11 w-full rounded-md border border-border bg-surface px-3 text-sm text-text placeholder:text-text-3 focus:outline-none focus:ring-1 focus:ring-primary';

/** 判定当前是否处于「已连接」态：显式启用 且 有可用目标 */
function isConnectedForm(syncEnabled: boolean | undefined, webdavUrl: string | undefined): boolean {
  return syncEnabled === true && (webdavUrl ?? '') !== '';
}

export function SyncCard() {
  const showSuccess = useUiStore((state) => state.toast.success);
  const showError = useUiStore((state) => state.toast.error);
  const showInfo = useUiStore((state) => state.toast.info);

  const settings = useLiveQuery(() => getSettings(), [], undefined);
  /** 库里是否已存密码（只显示状态，绝不回显明文） */
  const hasSecret = useLiveQuery(async () => (await getSecret()) !== null, [], undefined);

  /** 高级设置折叠区（默认收起） */
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [useProxy, setUseProxy] = useState(IS_DESKTOP ? false : true);
  const [proxyUrl, setProxyUrl] = useState(IS_DESKTOP ? '' : '/dav/');
  /** settings 首包只初始化一次表单，之后的 useLiveQuery 刷新不覆盖用户正在输入的内容 */
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!settings || initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    setUrl(settings.webdavUrl);
    setUser(settings.webdavUser);
    if (settings.webdavUrl !== '' || settings.proxyUrl !== '') {
      setUseProxy(settings.useProxy);
      setProxyUrl(settings.proxyUrl);
    }
  }, [settings]);

  const [connecting, setConnecting] = useState(false);
  const [connectStage, setConnectStage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  const connected = isConnectedForm(settings?.syncEnabled, settings?.webdavUrl);
  /** 状态条展示的主机名（从 webdavUrl 提取 host，代理模式下从代理配置还原） */
  const connectedHost = (() => {
    try {
      return settings ? new URL(settings.webdavUrl).host : '';
    } catch {
      return settings?.webdavUrl ?? '';
    }
  })();

  /** 自动同步开关：直接落库，无独立保存按钮 */
  const handleToggleEnabled = async (next: boolean): Promise<void> => {
    try {
      await patchSettings({ syncEnabled: next });
    } catch {
      showError(SETTINGS_SYNC.saveFailed);
    }
  };

  /** 一键连接：探测管线 + 写配置（含托管凭据） */
  const handleConnect = async (): Promise<void> => {
    if (connecting || !settings) {
      return;
    }
    setConnecting(true);
    setConnectStage(null);
    try {
      const result = await connectNas({
        lastKnownUrl: settings.webdavUrl,
        isWeb: !IS_DESKTOP && !IS_NATIVE,
        isNative: IS_NATIVE,
        isDesktop: IS_DESKTOP,
        onProgress: (stage) => setConnectStage(stage),
      });
      if (!result.ok) {
        showError(`${SETTINGS_SYNC.connectFailedPrefix}（${result.stages.join(' → ')}）。${SETTINGS_SYNC.connectFailedHint}`);
        setAdvancedOpen(true);
        return;
      }
      const form = IS_DESKTOP || IS_NATIVE ? 'direct' : 'web';
      await patchSettings(connectionPatchFor(result.origin, form));
      await setSecret(NAS_DAV_PASSWORD);
      setUrl(connectionPatchFor(result.origin, form).webdavUrl);
      setUser(connectionPatchFor(result.origin, form).webdavUser);
      setUseProxy(form === 'web');
      setProxyUrl(form === 'web' ? '/dav/' : '');
      showSuccess(SETTINGS_SYNC.connectDone(result.origin));
      // 连接成功后立即跑一轮同步，让用户马上看到数据到位
      const fresh = await getSettings();
      if (fresh) {
        const syncResult = await syncNow(fresh);
        setReport(syncResult);
        const after = await getSettings();
        setLastSyncAt(after?.lastSyncAt ?? null);
        if (!syncResult.error) {
          showSuccess(SETTINGS_SYNC.syncDone);
        }
      }
    } finally {
      setConnecting(false);
      setConnectStage(null);
    }
  };

  /** 手填配置持久化（高级设置区「保存配置」） */
  const handleSave = async (): Promise<void> => {
    if (saving || !settings) {
      return;
    }
    const trimmedUrl = url.trim();
    const trimmedUser = user.trim();
    if (trimmedUrl === '' || trimmedUser === '') {
      showError(SETTINGS_SYNC.needServerUser);
      return;
    }
    if (useProxy && proxyUrl.trim() === '') {
      showError(SETTINGS_SYNC.needProxyUrl);
      return;
    }
    setSaving(true);
    try {
      await patchSettings({
        syncEnabled: settings.syncEnabled,
        webdavUrl: trimmedUrl,
        webdavUser: trimmedUser,
        useProxy,
        proxyUrl: proxyUrl.trim(),
      });
      const trimmedPassword = password.trim();
      if (trimmedPassword !== '') {
        await setSecret(trimmedPassword);
        setPassword('');
      }
      showSuccess(SETTINGS_SYNC.saved);
    } catch {
      showError(SETTINGS_SYNC.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async (): Promise<void> => {
    if (syncing || saving) {
      return; // 单飞：同步进行中不允许重复触发
    }
    const fresh = await getSettings();
    if (!fresh) {
      showError(SETTINGS_SYNC.settingsMissing);
      return;
    }
    setSyncing(true);
    try {
      const result = await syncNow(fresh);
      setReport(result);
      const after = await getSettings();
      setLastSyncAt(after?.lastSyncAt ?? null);
      if (result.error) {
        showError(result.error.message);
      } else {
        showSuccess(SETTINGS_SYNC.syncDone);
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    // 只关开关，保留配置：重新连接时 last-known 候选可秒连
    await handleToggleEnabled(false);
    showInfo(SETTINGS_SYNC.disconnectDone);
  };

  const handleCheckUpdates = async (): Promise<void> => {
    const r = await checkAndApplyDatasetUpdates();
    if (r.error) {
      showError(`数据更新失败：${r.error}`);
    } else if (r.applied > 0) {
      showSuccess(`已更新 ${r.applied} 个数据包`);
    } else {
      showInfo('已是最新，无可用更新');
    }
  };

  /** 高级设置手填表单（未连接/已连接共用） */
  const advancedForm = (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="sync-url" className="text-xs font-medium text-text-2">
          {SETTINGS_SYNC.serverLabel}
        </label>
        <input
          id="sync-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={SETTINGS_SYNC.serverPlaceholder}
          className={INPUT_CLASS}
        />
        <p className="text-xs text-text-3">{SETTINGS_SYNC.serverHint}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="sync-user" className="text-xs font-medium text-text-2">
            {SETTINGS_SYNC.userLabel}
          </label>
          <input
            id="sync-user"
            type="text"
            autoComplete="off"
            value={user}
            onChange={(event) => setUser(event.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="sync-password" className="text-xs font-medium text-text-2">
            {SETTINGS_SYNC.passwordLabel}
          </label>
          <input
            id="sync-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={
              hasSecret
                ? SETTINGS_SYNC.passwordPlaceholderSaved
                : SETTINGS_SYNC.passwordPlaceholderEmpty
            }
            className={INPUT_CLASS}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SegmentedControl<'on' | 'off'>
          options={[
            { value: 'on', label: SETTINGS_SYNC.proxyOn },
            { value: 'off', label: SETTINGS_SYNC.proxyOff },
          ]}
          value={useProxy ? 'on' : 'off'}
          ariaLabel={SETTINGS_SYNC.proxyAria}
          onChange={(value) => setUseProxy(value === 'on')}
        />
        {useProxy ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="sync-proxy" className="text-xs font-medium text-text-2">
              {SETTINGS_SYNC.proxyUrlLabel}
            </label>
            <input
              id="sync-proxy"
              type="text"
              autoComplete="off"
              value={proxyUrl}
              onChange={(event) => setProxyUrl(event.target.value)}
              placeholder={SETTINGS_SYNC.proxyUrlPlaceholder}
              className={INPUT_CLASS}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => void handleSave()} disabled={saving}>
          {saving ? SETTINGS_SYNC.saving : SETTINGS_SYNC.save}
        </Button>
        {connected ? (
          <Button variant="ghost" size="sm" onClick={() => void handleDisconnect()}>
            {SETTINGS_SYNC.disconnect}
          </Button>
        ) : null}
      </div>
    </div>
  );

  return (
    <Card title={SETTINGS_SYNC.title}>
      <div className="flex flex-col gap-3">
        {/* 状态徽标行 */}
        <div className="flex items-center justify-between">
          <span
            className={
              connected
                ? 'rounded-full border border-success-fg/40 px-2.5 py-0.5 text-xs text-success-fg'
                : 'rounded-full border border-border px-2.5 py-0.5 text-xs text-text-3'
            }
          >
            {connected ? SETTINGS_SYNC.badgeConnected : SETTINGS_SYNC.badgeDisconnected}
          </span>
          <button
            type="button"
            className="text-xs text-text-3 hover:text-text-2"
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            {advancedOpen ? SETTINGS_SYNC.advancedClose : SETTINGS_SYNC.advancedOpen}
          </button>
        </div>

        {!connected ? (
          <>
            {/* 未连接态：一键连接 */}
            <p className="text-sm text-text-2">{SETTINGS_SYNC.introDisconnected}</p>
            <Button onClick={() => void handleConnect()} disabled={connecting || !settings}>
              {connecting ? SETTINGS_SYNC.connecting : SETTINGS_SYNC.connect}
            </Button>
            {connectStage !== null ? (
              <p className="text-xs text-text-3">{connectStage}</p>
            ) : null}
          </>
        ) : (
          <>
            {/* 已连接态：状态条 + 自动同步 + 立即同步 */}
            <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
              <span className="h-2 w-2 flex-shrink-0 rounded-full bg-success-fg" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text">{connectedHost}</p>
                <p className="text-xs text-text-3">
                  {lastSyncAt !== null
                    ? SETTINGS_SYNC.lastAt(fmtDate(lastSyncAt))
                    : SETTINGS_SYNC.lastNever}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-text">{SETTINGS_SYNC.autoSyncLabel}</span>
              <button
                type="button"
                role="switch"
                aria-checked={settings?.syncEnabled ?? false}
                aria-label={SETTINGS_SYNC.autoSyncLabel}
                onClick={() => void handleToggleEnabled(!(settings?.syncEnabled ?? false))}
                className={
                  settings?.syncEnabled
                    ? 'relative h-6 w-10 rounded-full bg-success-fg transition-colors'
                    : 'relative h-6 w-10 rounded-full bg-border transition-colors'
                }
              >
                <span
                  className={
                    settings?.syncEnabled
                      ? 'absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-white'
                      : 'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white'
                  }
                />
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void handleSync()} disabled={syncing}>
                {syncing ? SETTINGS_SYNC.syncing : SETTINGS_SYNC.syncNow}
              </Button>
              <Button variant="ghost" onClick={() => void handleCheckUpdates()}>
                {SETTINGS_SYNC.dataUpdate}
              </Button>
            </div>

            {report !== null ? (
              <div className="rounded-md bg-surface-2 p-2 text-xs text-text-2">
                <p>
                  {SETTINGS_SYNC.statLine(
                    Object.values(report.uploaded).reduce((sum, count) => sum + count, 0),
                    Object.values(report.downloaded).reduce((sum, count) => sum + count, 0),
                    report.conflicts,
                  )}
                </p>
                {report.error ? (
                  <p className="mt-1 text-danger-fg">
                    {SETTINGS_SYNC.failed(SYNC_ERROR_MESSAGES[report.error.code])}
                  </p>
                ) : null}
              </div>
            ) : null}

            <p className="text-xs text-text-3">{SETTINGS_SYNC.credentialManaged}</p>
          </>
        )}

        {advancedOpen ? advancedForm : null}

        <p className="text-xs text-text-3">{SETTINGS_SYNC.hintStrategy}</p>
      </div>
    </Card>
  );
}
