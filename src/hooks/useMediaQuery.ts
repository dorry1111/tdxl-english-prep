/**
 * 断点判断 hook（PRD 6.2.1 四档断点）。
 *
 * 与 Tailwind 断点保持一致：
 * - phone:            < 640px
 * - tabletPortrait:   640 ~ 1023px（iPad 竖屏、iPhone 横屏）
 * - tabletLandscape:  1024 ~ 1279px（iPad 横屏，左侧图标导轨 + 双栏）
 * - desktop:          ≥ 1280px（Windows，左侧侧边栏 + 双栏）
 */
import { useEffect, useState } from 'react';

/** 通用媒体查询订阅（SSR 安全：服务端渲染时返回 false） */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia(query);
    const handleChange = (event: MediaQueryListEvent): void => {
      setMatches(event.matches);
    };
    // 初次挂载时对齐一次，避免 SSR/hydrate 与真实值不一致
    setMatches(media.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}

export interface BreakpointFlags {
  /** < 640px：底部标签栏、单栏 */
  isPhone: boolean;
  /** 640 ~ 1023px：底部标签栏、单栏、内容限宽 720 */
  isTabletPortrait: boolean;
  /** 1024 ~ 1279px：左侧图标导轨、双栏 */
  isTabletLandscape: boolean;
  /** ≥ 1280px：左侧固定侧边栏、双栏 */
  isDesktop: boolean;
  /** ≥ 1024px：是否需要常驻左侧导航（导轨或侧边栏） */
  hasSideNav: boolean;
  /** ≥ 1024px：学习/答题页是否可以用双栏 */
  canUseTwoColumn: boolean;
}

/** 一次性拿到全部断点布尔值，避免组件里写多个 useMediaQuery */
export function useBreakpoints(): BreakpointFlags {
  const isPhone = useMediaQuery(`(max-width: 639px)`);
  const isTabletPortrait = useMediaQuery(`(min-width: 640px) and (max-width: 1023px)`);
  const isTabletLandscape = useMediaQuery(`(min-width: 1024px) and (max-width: 1279px)`);
  const isDesktop = useMediaQuery(`(min-width: 1280px)`);

  return {
    isPhone,
    isTabletPortrait,
    isTabletLandscape,
    isDesktop,
    hasSideNav: isTabletLandscape || isDesktop,
    canUseTwoColumn: isTabletLandscape || isDesktop,
  };
}
