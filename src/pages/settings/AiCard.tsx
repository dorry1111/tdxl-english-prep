/**
 * AI 释义卡（设置页）：配置大模型 API，供搜索弹窗的「AI 释义」使用。
 *
 * - 三家预设（DeepSeek / Kimi / 豆包）+ 自定义，切预设自动填该家的默认
 *   baseUrl / 模型名，用户仍可改（豆包常需要填接入点 ep-xxx）；
 * - API Key 存 secrets 表（id='llm-key'）：只存本机、不进 Settings、不参与
 *   同步与导出 —— 换设备需各填一次，换取 key 永不出本机；
 * - 表单初始化与 SyncCard 同模式：settings 首包只灌一次，之后不覆盖输入。
 */
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { SETTINGS_AI } from '@/constants';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { getLlmKey, getSettings, patchSettings, setLlmKey } from '@/db/repos/settingsRepo';
import { LLM_PRESETS, type LlmProviderId } from '@/lib/llm';
import { useUiStore } from '@/store/uiStore';

const INPUT_CLASS =
  'h-11 w-full rounded-md border border-border bg-surface px-3 text-sm text-text placeholder:text-text-3 focus:outline-none focus:ring-1 focus:ring-primary';

const PROVIDER_OPTIONS: ReadonlyArray<{ value: LlmProviderId; label: string }> = (
  Object.keys(LLM_PRESETS) as LlmProviderId[]
).map((id) => ({ value: id, label: LLM_PRESETS[id].label }));

export function AiCard() {
  const showSuccess = useUiStore((state) => state.toast.success);
  const showError = useUiStore((state) => state.toast.error);

  const settings = useLiveQuery(() => getSettings(), [], undefined);
  /** 库里是否已存 Key（只显示状态，不回显明文） */
  const hasKey = useLiveQuery(async () => (await getLlmKey()) !== null, [], undefined);

  const [provider, setProvider] = useState<LlmProviderId>('deepseek');
  const [baseUrl, setBaseUrl] = useState(LLM_PRESETS.deepseek.baseUrl);
  const [model, setModel] = useState(LLM_PRESETS.deepseek.model);
  const [apiKey, setApiKey] = useState('');
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!settings || initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    const saved = settings.llmProvider ?? 'deepseek';
    setProvider(saved);
    setBaseUrl(settings.llmBaseUrl ?? LLM_PRESETS[saved].baseUrl);
    setModel(settings.llmModel ?? LLM_PRESETS[saved].model);
  }, [settings]);

  /** 切换预设：自动填该家默认地址与模型（用户随后可改），custom 清空待填 */
  const handleProviderChange = (next: LlmProviderId): void => {
    setProvider(next);
    setBaseUrl(LLM_PRESETS[next].baseUrl);
    setModel(LLM_PRESETS[next].model);
  };

  const [saving, setSaving] = useState(false);

  const handleSave = async (): Promise<void> => {
    if (saving) {
      return;
    }
    const trimmedBaseUrl = baseUrl.trim();
    const trimmedModel = model.trim();
    if (trimmedBaseUrl === '' || trimmedModel === '') {
      showError(SETTINGS_AI.needUrlModel);
      return;
    }
    setSaving(true);
    try {
      await patchSettings({
        llmProvider: provider,
        llmBaseUrl: trimmedBaseUrl,
        llmModel: trimmedModel,
      });
      const trimmedKey = apiKey.trim();
      if (trimmedKey !== '') {
        await setLlmKey(trimmedKey);
        setApiKey('');
      }
      showSuccess(SETTINGS_AI.saved);
    } catch {
      showError(SETTINGS_AI.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={SETTINGS_AI.title}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-text-2">{SETTINGS_AI.providerLabel}</span>
          <SegmentedControl<LlmProviderId>
            options={PROVIDER_OPTIONS}
            value={provider}
            ariaLabel={SETTINGS_AI.providerAria}
            onChange={handleProviderChange}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="llm-base-url" className="text-xs font-medium text-text-2">
            {SETTINGS_AI.urlLabel}
          </label>
          <input
            id="llm-base-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            className={INPUT_CLASS}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="llm-model" className="text-xs font-medium text-text-2">
            {SETTINGS_AI.modelLabel}
          </label>
          <input
            id="llm-model"
            type="text"
            autoComplete="off"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className={INPUT_CLASS}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="llm-key" className="text-xs font-medium text-text-2">
            {SETTINGS_AI.keyLabel}
          </label>
          <input
            id="llm-key"
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={hasKey ? SETTINGS_AI.keyPlaceholderSaved : SETTINGS_AI.keyPlaceholderEmpty}
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <Button variant="secondary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? SETTINGS_AI.saving : SETTINGS_AI.save}
          </Button>
        </div>

        <p className="text-xs text-text-3">{SETTINGS_AI.hintLocal}</p>
        <p className="text-xs text-text-3">{SETTINGS_AI.hintProxy}</p>
      </div>
    </Card>
  );
}
