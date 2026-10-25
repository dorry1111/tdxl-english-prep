/**
 * 左侧固定侧边栏（≥ 1280px，Windows 桌面）：图标 + 文字。
 */
import clsx from 'clsx';
import { NavLink } from 'react-router';

import { Icon } from '@/components/ui/Icon';
import { APP, NAV_ITEMS } from '@/constants';

export function Sidebar() {
  return (
    <nav
      aria-label="主导航"
      className="app-sidebar fixed inset-y-0 left-0 z-30 hidden w-sidebar flex-col border-r border-border bg-surface px-3 pt-[calc(var(--safe-top)+16px)] desktop:flex"
    >
      <div className="px-3 pb-4">
        <p className="text-base font-semibold text-text">{APP.name}</p>
        <p className="mt-1 text-xs text-text-3">{APP.slogan}</p>
      </div>
      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              end={item.path === '/'}
              aria-label={item.ariaLabel}
              className={({ isActive }) =>
                clsx(
                  'app-tappable flex min-h-[44px] items-center gap-3 rounded-md px-3 text-sm transition-colors duration-fast',
                  isActive
                    ? 'bg-primary-soft font-medium text-primary'
                    : 'text-text-2 hover:bg-surface-2 hover:text-text',
                )
              }
            >
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
