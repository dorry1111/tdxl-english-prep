/**
 * 顶层错误边界。
 *
 * 兜住「未捕获异常导致白屏」：给用户一个明确的出口（重新加载），
 * 开发模式下额外展示错误信息，方便本机排查。
 *
 * 说明：架构里提到的「导出备份」按钮依赖备份模块（T19），
 * 批次 1 尚未实现，因此这里只提供「重新加载」，避免放一个点了没反应的假按钮。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { ACTIONS, ERROR_PAGE } from '@/constants';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 只在控制台留痕，不上报（单用户应用，没有服务端）
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private readonly handleReload = (): void => {
    window.location.reload();
  };

  private readonly handleReset = (): void => {
    this.setState({ hasError: false, message: '' });
  };

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
        <h1 className="text-xl font-semibold text-text">{ERROR_PAGE.title}</h1>
        <p className="max-w-[42ch] text-sm text-text-2">{ERROR_PAGE.desc}</p>
        <div className="mt-2 flex gap-2">
          <Button variant="primary" onClick={this.handleReload}>
            {ACTIONS.reload}
          </Button>
          <Button variant="secondary" onClick={this.handleReset}>
            {ACTIONS.retry}
          </Button>
        </div>
        {import.meta.env.DEV ? (
          <details className="mt-4 w-full max-w-[560px] text-left">
            <summary className="cursor-pointer text-xs text-text-3">{ERROR_PAGE.devDetailTitle}</summary>
            <pre className="mt-2 overflow-x-auto rounded-md bg-surface-2 p-3 text-xs text-text-2">
              {this.state.message}
            </pre>
          </details>
        ) : null}
      </div>
    );
  }
}
