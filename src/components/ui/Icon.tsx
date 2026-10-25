/**
 * 内联 SVG 图标（手写 path，零依赖、零请求）。
 *
 * 用 currentColor 描边，颜色由父级 text-* 控制；尺寸默认 20px。
 * 只收录项目真正用到的图标（约 16 个），不追求通用图标库。
 */
import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'today'
  | 'words'
  | 'stats'
  | 'exams'
  | 'records'
  | 'settings'
  | 'sun'
  | 'moon'
  | 'auto'
  | 'close'
  | 'chevron-right'
  | 'check'
  | 'alert'
  | 'wifi-off'
  | 'refresh'
  | 'sparkle';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** 边长，默认 20 */
  size?: number;
  /** 传入后无障碍读屏会读出该文本；不传则视为装饰性图标 */
  title?: string;
}

export function Icon({ name, size = 20, title, className, ...rest }: IconProps) {
  const content = PATHS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {content}
    </svg>
  );
}

const PATHS: Record<IconName, ReactNode> = {
  // 今日：日历 + 勾
  today: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 11h18" />
      <path d="M9 16l2 2 4-4" />
    </>
  ),
  // 单词：书签（卡片）
  words: (
    <>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
      <path d="M9 8h6" />
    </>
  ),
  // 统计：简约柱状图（基线 + 三根柱）
  stats: (
    <>
      <path d="M4 20h16" />
      <path d="M7 20v-5M12 20V9M17 20V4" />
    </>
  ),
  // 真题：文稿
  exams: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </>
  ),
  // 做题记录：带勾的清单板
  records: (
    <>
      <path d="M8 4h8a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M9.5 4.5h5" />
      <path d="M9 10l1.6 1.6L13 9.2M9 16h5" />
    </>
  ),
  // 我的：齿轮（简化）
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.9 1.9M16.5 16.5l1.9 1.9M18.4 5.6l-1.9 1.9M7.5 16.5l-1.9 1.9" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  // 跟随系统：对比度圆
  auto: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  check: <path d="M4 12.5l5 5L20 6.5" />,
  alert: (
    <>
      <path d="M12 3.5l9 16H3l9-16z" />
      <path d="M12 9.5v5M12 17.5v.5" />
    </>
  ),
  'wifi-off': (
    <>
      <path d="M3 3l18 18" />
      <path d="M8.5 15.5a5 5 0 0 1 7 0" />
      <path d="M5 12a11 11 0 0 1 3.5-2.2M19 12a11 11 0 0 0-3.5-2.2" />
      <path d="M12 19.5v.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
      <path d="M20.5 3.5v5h-5" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      <path d="M18 16l.9 2.1L21 19l-2.1.9L18 22l-.9-2.1L15 19l2.1-.9L18 16z" />
    </>
  ),
};
