/**
 * 底部标签栏（< 1024px）。
 *
 * 高度 = 56px + 安全区（iPhone 全面屏不做这一步会被 Home 指示条盖住）。
 */
import clsx from 'clsx';
import { NavLink } from 'react-router';

import { Icon } from '@/components/ui/Icon';
import { NAV_ITEMS } from '@/constants';

export function TabBar() {
  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[var(--safe-bottom)] tablet:hidden"
    >
      <ul className="flex h-[var(--nav-h)] items-stretch">
        {NAV_ITEMS.map((item) => (
          <li key={item.path} className="flex-1">
            <NavLink
              to={item.path}
              end={item.path === '/'}
              aria-label={item.ariaLabel}
              className={({ isActive }) =>
                clsx(
                  'app-tappable flex h-full flex-col items-center justify-center gap-0.5 text-xs',
                  isActive ? 'text-primary' : 'text-text-3',
                )
              }
            >
              <Icon name={item.icon} size={22} />
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
