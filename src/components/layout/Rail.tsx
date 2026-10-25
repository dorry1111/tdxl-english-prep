/**
 * 左侧图标导轨（1024 ~ 1279px，iPad 横屏）。
 *
 * 只显示图标，文字通过原生 title 做悬浮提示 + aria-label 保证读屏可读。
 */
import clsx from 'clsx';
import { NavLink } from 'react-router';

import { Icon } from '@/components/ui/Icon';
import { NAV_ITEMS } from '@/constants';

export function Rail() {
  return (
    <nav
      aria-label="主导航"
      className="app-rail fixed inset-y-0 left-0 z-30 hidden w-rail flex-col items-center gap-2 border-r border-border bg-surface pt-[calc(var(--safe-top)+12px)] tablet:flex desktop:hidden"
    >
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/'}
          title={item.label}
          aria-label={item.ariaLabel}
          className={({ isActive }) =>
            clsx(
              'app-tappable flex h-12 w-12 items-center justify-center rounded-md transition-colors duration-fast',
              isActive
                ? 'bg-primary-soft text-primary'
                : 'text-text-3 hover:bg-surface-2 hover:text-text-2',
            )
          }
        >
          <Icon name={item.icon} size={22} />
        </NavLink>
      ))}
    </nav>
  );
}
