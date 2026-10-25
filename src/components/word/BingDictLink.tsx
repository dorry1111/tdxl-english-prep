/**
 * 必应词典外链按钮：新标签打开该单词的必应词典页。
 *
 * - iPhone PWA 内以内建 Safari 视图打开，返回即回到原页面，不打断学习会话；
 * - 尺寸由调用方用 className 控制（详情面板全宽 / 笔记区行内小按钮）。
 */
import clsx from 'clsx';

import { STUDY } from '@/constants';

export interface BingDictLinkProps {
  headword: string;
  className?: string;
}

export function BingDictLink({ headword, className }: BingDictLinkProps) {
  return (
    <a
      href={`https://cn.bing.com/dict/search?q=${encodeURIComponent(headword)}`}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx(
        'app-tappable flex items-center justify-center rounded-md border border-primary text-sm font-medium text-primary',
        className ?? 'h-11 w-full',
      )}
    >
      {STUDY.bingDict}
    </a>
  );
}
