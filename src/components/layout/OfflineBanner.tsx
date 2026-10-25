/**
 * 离线提示条（ARCHITECTURE 8.4）。
 *
 * 断网时顶部常驻「离线模式 · 数据已本地保存」；恢复在线 2 秒后自动消失，
 * 让用户看到「已恢复」但不需要手动关闭。
 */
import { useEffect, useState } from 'react';

import { Icon } from '@/components/ui/Icon';
import { LAYOUT } from '@/constants';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

/** 恢复在线后提示条保留的时长 */
const RESTORED_HIDE_DELAY_MS = 2000;

export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const [visible, setVisible] = useState(!isOnline);

  useEffect(() => {
    if (!isOnline) {
      setVisible(true);
      return;
    }
    const timer = window.setTimeout(() => setVisible(false), RESTORED_HIDE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isOnline]);

  if (!visible) {
    return null;
  }

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-border bg-surface-2 px-4 py-2 text-xs text-text-2"
    >
      <Icon name="wifi-off" size={14} />
      <span>{LAYOUT.offline}</span>
    </div>
  );
}
