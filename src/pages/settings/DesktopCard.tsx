/**
 * 桌面端专属设置卡片：窗口质感 / 关闭行为 / 开机自启。
 * 仅在 Electron 形态渲染（IS_DESKTOP）。
 */
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { desktopApi, type DesktopConfigBridge } from '@/lib/desktop';
import { useUiStore } from '@/store/uiStore';

type Material = DesktopConfigBridge['material'];
type OnOff = 'on' | 'off';

const MATERIAL_OPTIONS: ReadonlyArray<{ value: Material; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'acrylic', label: '亚克力' },
  { value: 'blur', label: '磨砂' },
  { value: 'solid', label: '纯色' },
];

const ONOFF_OPTIONS: ReadonlyArray<{ value: OnOff; label: string }> = [
  { value: 'on', label: '开启' },
  { value: 'off', label: '关闭' },
];

/** 桌面数据属性：CSS 用它决定玻璃层是否退化为实色 */
function paintMaterial(material: Material): void {
  document.documentElement.dataset.material = material === 'solid' ? 'solid' : 'glass';
}

export function DesktopCard() {
  const showSuccess = useUiStore((state) => state.toast.success);
  const showError = useUiStore((state) => state.toast.error);
  const [config, setConfig] = useState<DesktopConfigBridge | null>(null);

  useEffect(() => {
    void desktopApi()
      ?.getConfig()
      .then((loaded) => {
        setConfig(loaded);
        paintMaterial(loaded.material);
      });
  }, []);

  if (!config) {
    return null;
  }

  const patch = async (partial: Partial<DesktopConfigBridge>): Promise<void> => {
    try {
      const next = await desktopApi()!.setConfig(partial);
      setConfig(next);
      if (partial.material !== undefined) {
        paintMaterial(next.material);
      }
      showSuccess('已保存。');
    } catch {
      showError('保存失败。');
    }
  };

  return (
    <Card title="桌面端">
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-2 text-sm font-medium text-text">窗口质感</p>
          <SegmentedControl<Material>
            options={MATERIAL_OPTIONS}
            value={config.material}
            onChange={(value) => void patch({ material: value })}
            ariaLabel="窗口质感"
          />
          <p className="mt-2 text-xs text-text-3">
            自动：Win11 用亚克力，Win10 用磨砂（避免拖动掉帧），不支持时回退纯色。
          </p>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-text">点关闭按钮时最小化到托盘</p>
          <SegmentedControl<OnOff>
            options={ONOFF_OPTIONS}
            value={config.closeToTray ? 'on' : 'off'}
            onChange={(value) => void patch({ closeToTray: value === 'on' })}
            ariaLabel="关闭按钮行为"
          />
          <p className="mt-2 text-xs text-text-3">开启后应用常驻托盘，背单词提醒不中断；从托盘菜单可彻底退出。</p>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-text">开机自启</p>
          <SegmentedControl<OnOff>
            options={ONOFF_OPTIONS}
            value={config.autoLaunch ? 'on' : 'off'}
            onChange={(value) => void patch({ autoLaunch: value === 'on' })}
            ariaLabel="开机自启"
          />
        </div>

        <Button variant="ghost" onClick={() => void desktopApi()?.openDataDir()}>
          打开数据目录
        </Button>
      </div>
    </Card>
  );
}
