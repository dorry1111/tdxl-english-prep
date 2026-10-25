/**
 * 新版本提示条（ARCHITECTURE 8.4）。
 *
 * 只负责展示与回调，是否该弹由 `usePwaUpdate` 判断（会话中会延后到退出会话）。
 */
import { ACTIONS, UPDATE } from '@/constants';

import { Button } from './Button';
import { Icon } from './Icon';

export interface UpdatePromptProps {
  visible: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
}

export function UpdatePrompt({ visible, onUpdate, onDismiss }: UpdatePromptProps) {
  if (!visible) {
    return null;
  }
  return (
    <div className="fixed inset-x-0 bottom-[calc(var(--nav-h)+var(--safe-bottom))] z-40 px-4 pb-2 tablet:bottom-0">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-e2 tablet:flex-row tablet:items-center">
        <div className="flex flex-1 items-start gap-2">
          <span className="mt-0.5 shrink-0 text-primary">
            <Icon name="refresh" size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold text-text">{UPDATE.title}</p>
            <p className="text-xs text-text-3">{UPDATE.desc}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" size="sm" onClick={onDismiss}>
            {ACTIONS.later}
          </Button>
          <Button variant="primary" size="sm" onClick={onUpdate}>
            {ACTIONS.updateNow}
          </Button>
        </div>
      </div>
    </div>
  );
}
