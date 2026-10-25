/**
 * AI 结果对话框：loading / done / error 三态 + 「重新生成」。
 *
 * 三个 AI 功能（讲解 / 诊断 / 评估）共用本组件：
 * - 结果是固定分段结构的纯文本（提示词锁死格式），用等宽预格式化渲染，
 *   不引 markdown 依赖；
 * - 「重新生成」= 删缓存后重新请求（调用方先 removeCached 再 runAi）。
 */
import clsx from 'clsx';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';

export type AiDialogState = 'loading' | 'done' | 'error';

export interface AiResultDialogProps {
  open: boolean;
  title: string;
  state: AiDialogState;
  content: string;
  error: string;
  /** 重新生成（删缓存重跑）；loading 态禁用 */
  onRegenerate?: () => void;
  /** 底部按钮区左侧的额外控件（如「AI 评估」的采纳控件；仅 done 态由调用方自控显示） */
  footerExtra?: ReactNode;
  onClose: () => void;
}

export function AiResultDialog({
  open,
  title,
  state,
  content,
  error,
  onRegenerate,
  footerExtra,
  onClose,
}: AiResultDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      className="w-[min(92vw,640px)]"
      footer={
        <>
          {footerExtra && state === 'done' ? (
            <div className="me-auto flex items-center gap-2">{footerExtra}</div>
          ) : null}
          {onRegenerate ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={state === 'loading'}
              onClick={onRegenerate}
            >
              重新生成
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onClose}>
            关闭
          </Button>
        </>
      }
    >
      {state === 'loading' ? (
        <div className="flex items-center gap-2 py-6 text-sm text-text-3">
          <Icon name="sparkle" size={16} />
          <span>正在生成，请稍候（长篇内容最长约 90 秒）…</span>
        </div>
      ) : state === 'error' ? (
        <p role="alert" className="py-2 text-sm text-danger">
          {error}
        </p>
      ) : (
        <div
          className={clsx(
            'app-no-scrollbar max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words',
            'rounded-md border border-border bg-surface-2 p-3 text-sm leading-relaxed text-text',
          )}
        >
          {content}
        </div>
      )}
    </Dialog>
  );
}
