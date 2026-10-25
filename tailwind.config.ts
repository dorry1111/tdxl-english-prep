import type { Config } from 'tailwindcss';

/**
 * Tailwind 3.4 配置（严禁升到 4.x：v4 依赖 @property / color-mix，iOS 16.0 Safari 不支持）。
 *
 * 约定（ARCHITECTURE 7.3）：
 * - 所有颜色只映射到 CSS 变量，组件里不得硬编码色值；
 * - `darkMode: 'class'`，由 uiStore 在 <html> 上切换 `dark` 类；
 * - 断点：默认 sm=640px，扩展 tablet=1024px、desktop=1280px，与 PRD 6.2.1 断点表一一对应。
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--c-bg)',
        surface: 'var(--c-surface)',
        'surface-2': 'var(--c-surface-2)',
        border: 'var(--c-border)',
        glass: 'var(--c-glass)',
        'glass-border': 'var(--c-glass-border)',

        text: 'var(--c-text)',
        'text-2': 'var(--c-text-2)',
        'text-3': 'var(--c-text-3)',

        primary: 'var(--c-primary)',
        'primary-hover': 'var(--c-primary-hover)',
        'primary-soft': 'var(--c-primary-soft)',
        'primary-fg': 'var(--c-primary-fg)',

        success: 'var(--c-success)',
        warn: 'var(--c-warn)',
        danger: 'var(--c-danger)',
        'danger-soft': 'var(--c-danger-soft)',
        'danger-fg': 'var(--c-on-danger)',
        info: 'var(--c-rate-3)',
        overlay: 'var(--c-overlay)',

        'rate-1': 'var(--c-rate-1)',
        'rate-2': 'var(--c-rate-2)',
        'rate-3': 'var(--c-rate-3)',
        'rate-4': 'var(--c-rate-4)',

        'hl-1': 'var(--c-hl-1)',
        'hl-2': 'var(--c-hl-2)',
        'hl-3': 'var(--c-hl-3)',
        'hl-4': 'var(--c-hl-4)',

        'sec-dialogue': 'var(--c-sec-dialogue)',
        'sec-vocabulary': 'var(--c-sec-vocabulary)',
        'sec-reading': 'var(--c-sec-reading)',
        'sec-cloze': 'var(--c-sec-cloze)',
        'sec-short': 'var(--c-sec-short)',
        'sec-translation': 'var(--c-sec-translation)',
        'sec-writing': 'var(--c-sec-writing)',

        'exam-unanswered': 'var(--c-exam-unanswered)',
        'exam-answered': 'var(--c-exam-answered)',
        'exam-flagged': 'var(--c-exam-flagged)',
        'exam-on-state': 'var(--c-exam-on-state)',
        'exam-overlay': 'var(--c-exam-pause-overlay)',
        'exam-target': 'var(--c-exam-target)',
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
        full: 'var(--r-full)',
      },
      spacing: {
        1: 'var(--sp-1)',
        2: 'var(--sp-2)',
        3: 'var(--sp-3)',
        4: 'var(--sp-4)',
        5: 'var(--sp-5)',
        6: 'var(--sp-6)',
        7: 'var(--sp-7)',
        8: 'var(--sp-8)',
        10: 'var(--sp-10)',
        12: 'var(--sp-12)',
        // 给固定侧栏/导轨留位置（pl-sidebar / pl-rail）。
        // 注意：只配 width 不会生成 padding 工具类，两处都要配。
        sidebar: 'var(--sidebar-w)',
        rail: 'var(--rail-w)',
      },
      fontSize: {
        xs: ['var(--fs-xs)', { lineHeight: 'var(--lh-normal)' }],
        sm: ['var(--fs-sm)', { lineHeight: 'var(--lh-normal)' }],
        base: ['var(--fs-base)', { lineHeight: 'var(--lh-normal)' }],
        lg: ['var(--fs-lg)', { lineHeight: 'var(--lh-tight)' }],
        xl: ['var(--fs-xl)', { lineHeight: 'var(--lh-tight)' }],
        '2xl': ['var(--fs-2xl)', { lineHeight: 'var(--lh-tight)' }],
        '3xl': ['var(--fs-3xl)', { lineHeight: 'var(--lh-tight)' }],
      },
      boxShadow: {
        e1: 'var(--sh-1)',
        e2: 'var(--sh-2)',
      },
      screens: {
        tablet: '1024px',
        desktop: '1280px',
      },
      maxWidth: {
        content: 'var(--content-max)',
      },
      height: {
        nav: 'var(--nav-h)',
        tabbar: 'calc(var(--nav-h) + var(--safe-bottom))',
      },
      width: {
        sidebar: 'var(--sidebar-w)',
        rail: 'var(--rail-w)',
      },
      transitionTimingFunction: {
        app: 'var(--ease)',
      },
      transitionDuration: {
        fast: 'var(--dur-fast)',
        base: 'var(--dur-base)',
      },
    },
  },
  plugins: [],
} satisfies Config;
