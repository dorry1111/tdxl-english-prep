/**
 * 确认框：基于原生 `<dialog>` + `showModal()`。
 *
 * 为什么用原生 dialog：
 * - 自带焦点陷阱（Tab 不会跑到背景）、Esc 关闭、顶层渲染；
 * - 这正是「不引 MUI」的补偿措施之一（ARCHITECTURE 1.2）。
 *
 * 打开/关闭由父组件的 `open` 控制；关闭动作（Esc、点遮罩、点按钮）都会回调 `onClose`。
 */
import clsx from 'clsx';
import { useEffect, useRef, type ReactNode } from 'react';

export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  /** 底部按钮区 */
  footer?: ReactNode;
  onClose: () => void;
  /** 是否允许点击遮罩关闭，默认 true */
  closeOnBackdrop?: boolean;
  className?: string;
}

export function Dialog({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  closeOnBackdrop = true,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    // Esc 键：阻止浏览器直接关闭，统一走父组件的状态
    const handleCancel = (event: Event): void => {
      event.preventDefault();
      onClose();
    };
    element.addEventListener('cancel', handleCancel);
    return () => element.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={clsx(
        'app-dialog w-[min(92vw,420px)] rounded-lg border border-border bg-surface p-0 text-text',
        className,
      )}
      onClick={(event) => {
        // 点击遮罩（即 dialog 自身，而非内部内容）时关闭
        if (closeOnBackdrop && event.target === ref.current) {
          onClose();
        }
      }}
    >
      <div className="px-5 pt-5">
        <h2 className="text-lg font-semibold text-text">{title}</h2>
        {description ? <p className="mt-2 text-sm text-text-2">{description}</p> : null}
        {children ? <div className="mt-3 text-sm text-text-2">{children}</div> : null}
      </div>
      {footer ? (
        <div className="mt-4 flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
      ) : (
        <div className="pb-4" />
      )}
    </dialog>
  );
}
