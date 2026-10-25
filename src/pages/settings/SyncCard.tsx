/**
 * 数据同步卡（设置页，T18 接线）。
 *
 * 把批次 1 留白的「WebDAV 地址与账号在后续版本开放配置」补齐：
 * - 表单：服务器地址 / 账号 / 应用密码（写 secrets 表，不回显明文）/ 代理开关 / 自动同步开关；
 * - 保存 = patchSettings({syncEnabled, webdavUrl, webdavUser, useProxy, proxyUrl}) + setSecret（密码非空时）；
 * - 「立即同步」= 先把表单当前编辑按保存规则落库，再读库里的最新配置走 syncNow，与自动同步同一条链路；
 * - 代理默认值按端形态给建议：PWA 跨端口会被浏览器拦，默认走同源 /dav/ 反代；
 *   桌面版 Electron 无 CORS，默认直连。
 */
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { SETTINGS_SYNC } from '@/constants';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { getSecret, getSettings, patchSettings, setSecret } from '@/db/repos/settingsRepo';
import { IS_DESKTOP } from '@/lib/desktop';
import { syncNow, SYNC_ERROR_MESSAGES } from '@/lib/sync/engine';
import { fmtDate } from '@/lib/time';
import { useUiStore } from '@/store/uiStore';
import type { SyncReport } from '@/types';

const INPUT_CLASS =
  'h-11 w-full rounded-md border border-border bg-surface px-3 text-sm text-text placeholder:text-text-3 focus:outline-none focus:ring-1 focus:ring-primary';

export function SyncCard() {
  const showSuccess = useUiStore((state) => state.toast.success);
  const showError = useUiStore((state) => state.toast.error);

  const settings = useLiveQuery(() => getSettings(), [], undefined);
  /** 库里是否已存密码（只显示状态，绝不回显明文） */
  const hasSecret = useLiveQuery(async () => (await getSecret()) !== null, [], undefined);

  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [useProxy, setUseProxy] = useState(IS_DESKTOP ? false : true);
  const [proxyUrl, setProxyUrl] = useState(IS_DESKTOP ? '' : '/dav/');
  const [enabled, setEnabled] = useState(false);
  /** settings 首包只初始化一次表单，之后的 useLiveQuery 刷新不覆盖用户正在输入的内容 */
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!settings || initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    setUrl(settings.webdavUrl);
    setUser(settings.webdavUser);
    setEnabled(settings.syncEnabled);
    if (settings.webdavUrl !== '' || settings.proxyUrl !== '') {
      // 已有配置：原样回显
      setUseProxy(settings.useProxy);
      setProxyUrl(settings.proxyUrl);
    }
  }, [settings]);

  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  /**
   * 校验并把当前表单内容持久化（「保存配置」与「立即同步」共用）。
   * 为什么抽出：点「立即同步」必须先落库表单里的最新编辑（含密码写 secrets），
   * 否则 syncNow 读到的是旧配置，用户刚填的地址/账号/开关都不生效。
   * 返回是否持久化成功，供调用方决定是否继续后续动作。
   */
  const persistConfig = async (): Promise<boolean> => {
    // 校验规则与原 handleSave 完全一致：启用时 url/user 必填；走代理时 proxyUrl 必填
    const trimmedUrl = url.trim();
    const trimmedUser = user.trim();
    if (enabled && (trimmedUrl === '' || trimmedUser === '')) {
      showError(SETTINGS_SYNC.needServerUser);
      return false;
    }
    if (useProxy && proxyUrl.trim() === '') {
      showError(SETTINGS_SYNC.needProxyUrl);
      return false;
    }
    setSaving(true);
    try {
      await patchSettings({
        syncEnabled: enabled,
        webdavUrl: trimmedUrl,
        webdavUser: trimmedUser,
        useProxy,
        proxyUrl: proxyUrl.trim(),
      });
      const trimmedPassword = password.trim();
      if (trimmedPassword !== '') {
        await setSecret(trimmedPassword);
        setPassword(''); // 保存后清空输入框，状态回到「已保存」
      }
      return true;
    } catch {
      showError(SETTINGS_SYNC.saveFailed);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (saving) {
      return;
    }
    const ok = await persistConfig();
    if (ok) {
      showSuccess(SETTINGS_SYNC.saved);
    }
  };

  const handleSync = async (): Promise<void> => {
    if (syncing || saving) {
      return; // 单飞：同步进行中不允许重复触发；保存中也不触发，避免与 persistConfig 并发写库
    }
    // 先把表单当前编辑按保存的校验规则落库，失败则中断同步（错误提示已由 persistConfig 弹出）
    // 注意此处成功后不再弹「已保存」toast，避免与「同步完成」双提示
    const ok = await persistConfig();
    if (!ok) {
      return;
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

  return (
    <Card title={SETTINGS_SYNC.title}>
      <div className="flex flex-col gap-3">
        {/* 连接表单 */}
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

        {/* 代理：PWA 默认走 /dav/ 反代，桌面默认直连 */}
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
          <p className="text-xs text-text-3">{SETTINGS_SYNC.hintProxy}</p>
        </div>

        {/* 自动同步开关 */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-text-2">{SETTINGS_SYNC.enableLabel}</span>
          <SegmentedControl<'on' | 'off'>
            options={[
              { value: 'on', label: SETTINGS_SYNC.enableOn },
              { value: 'off', label: SETTINGS_SYNC.enableOff },
            ]}
            value={enabled ? 'on' : 'off'}
            ariaLabel={SETTINGS_SYNC.enableAria}
            onChange={(value) => setEnabled(value === 'on')}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? SETTINGS_SYNC.saving : SETTINGS_SYNC.save}
          </Button>
          <Button onClick={() => void handleSync()} disabled={syncing}>
            {syncing ? SETTINGS_SYNC.syncing : SETTINGS_SYNC.syncNow}
          </Button>
        </div>

        <p className="text-xs text-text-3">
          {lastSyncAt !== null
            ? SETTINGS_SYNC.lastAt(fmtDate(lastSyncAt))
            : SETTINGS_SYNC.lastNever}
        </p>

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

        <p className="text-xs text-text-3">{SETTINGS_SYNC.hintStrategy}</p>
      </div>
    </Card>
  );
}
