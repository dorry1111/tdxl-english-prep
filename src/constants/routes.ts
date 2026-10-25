/**
 * 路由常量与一级导航定义（ARCHITECTURE 7.7：避免路由字符串散落在页面里）。
 */
import type { BgTheme, ThemeMode } from '@/types';

export const ROUTES = {
  // 一级导航
  home: '/',
  books: '/books',
  stats: '/stats',
  exams: '/exams',
  records: '/records',
  settings: '/settings',

  // 学习
  study: '/study',
  studySummary: '/study/summary',
  plan: '/plan',

  // 选词
  booksImport: '/books/import',
  wordDetail: '/word/:id',
  notebook: '/notebook',
  statsVocab: '/stats/vocab',

  // 真题
  examEdit: '/exams/:id/edit',
  examParseReview: '/exams/:id/review-parse',
  examStart: '/exams/:id/start',
  attempt: '/attempt/:id',
  attemptSubjective: '/attempt/:id/subjective',
  attemptSheet: '/attempt/:id/sheet',
  attemptResult: '/attempt/:id/result',
  attemptReview: '/attempt/:id/review',
  drill: '/drill',
  wrongBook: '/wrong',
  statsExams: '/stats/exams',

  // 我的
  settingsSync: '/settings/sync',
  settingsBackup: '/settings/backup',

  // 其他
  search: '/search',
} as const;

/** 一级导航项（PRD 6.1：学习 / 选词 / 统计 / 真题 / 做题记录 / 我的，共 6 个） */
export interface NavItem {
  /** 路由路径 */
  path: string;
  /** 中文名 */
  label: string;
  /** 图标 key，由 Icon 组件映射 */
  icon: NavIconKey;
  /** 无障碍描述 */
  ariaLabel: string;
}

export type NavIconKey = 'today' | 'words' | 'stats' | 'exams' | 'records' | 'settings';

export const NAV_ITEMS: readonly NavItem[] = [
  { path: ROUTES.home, label: '学习', icon: 'today', ariaLabel: '学习：任务与进度' },
  { path: ROUTES.books, label: '选词', icon: 'words', ariaLabel: '选词：词库与生词本' },
  { path: ROUTES.stats, label: '统计', icon: 'stats', ariaLabel: '统计：词汇与学习数据' },
  { path: ROUTES.exams, label: '真题', icon: 'exams', ariaLabel: '真题：试卷与错题' },
  { path: ROUTES.records, label: '做题记录', icon: 'records', ariaLabel: '做题记录：历次作答与成绩' },
  { path: ROUTES.settings, label: '我的', icon: 'settings', ariaLabel: '我的：设置与同步' },
] as const;

/** 内容区最大宽度（PRD 6.2.1：640 / 720 / 960 / 1200 四档） */
export const CONTENT_MAX_WIDTH = {
  phone: '100%',
  tabletPortrait: '720px',
  tabletLandscape: '960px',
  desktop: 'var(--content-max)',
} as const;

/** 路由懒加载失败时的兜底提示用的路径前缀 */
export const SESSION_ROUTE_PREFIXES: readonly string[] = [ROUTES.study, '/attempt'];

/** 判断某个路径是否属于「会话进行中，不应打断」的页面（ARCHITECTURE 8.4） */
export function isSessionRoute(pathname: string): boolean {
  return SESSION_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * 是否为一级导航页面（学习 / 选词 / 统计 / 真题 / 做题记录 / 我的）。
 *
 * 一级页面有固定的侧边栏/标签栏入口，不需要返回按钮；
 * 次级页面（如 /exams/:id/start、/settings/backup）才显示返回。
 */
export function isPrimaryRoute(pathname: string): boolean {
  return NAV_ITEMS.some((item) => item.path === pathname);
}

/** 是否需要显示「返回」按钮：次级页面才需要，会话页面（背单词/答题）不算 */
export function needsBackButton(pathname: string): boolean {
  return !isPrimaryRoute(pathname) && !isSessionRoute(pathname);
}

/** 主题存储键（T03 先存 localStorage，T05 之后迁移到 IndexedDB） */
export const THEME_STORAGE_KEY = 'tdxl.theme';

/** 背景颜色存储键（与浅色/深色独立的一维：只影响浅色态底色风格） */
export const BG_THEME_STORAGE_KEY = 'tdxl.bggtheme';

export const THEME_ORDER: readonly ThemeMode[] = ['auto', 'light', 'dark'] as const;

export const THEME_LABEL: Record<ThemeMode, string> = {
  auto: '跟随系统',
  light: '浅色',
  dark: '深色',
};

/** 背景颜色档位顺序与名称（设置页 SegmentedControl 用） */
export const BG_THEME_ORDER: readonly BgTheme[] = ['classic', 'green', 'paper', 'gray'] as const;

export const BG_THEME_LABEL: Record<BgTheme, string> = {
  classic: '经典白',
  green: '护眼绿',
  paper: '米黄纸',
  gray: '浅灰',
};

/** 顶栏标题：按路径前缀匹配（长的优先），未匹配到就用应用名 */
const PAGE_TITLE_RULES: ReadonlyArray<{ prefix: string; title: string }> = [
  { prefix: ROUTES.studySummary, title: '本次结算' },
  { prefix: ROUTES.study, title: '背单词' },
  { prefix: ROUTES.plan, title: '学习计划' },
  { prefix: ROUTES.booksImport, title: '词库导入' },
  { prefix: ROUTES.books, title: '选词' },
  { prefix: ROUTES.notebook, title: '生词本' },
  { prefix: ROUTES.stats, title: '统计' },
  { prefix: ROUTES.statsVocab, title: '单词统计' },
  { prefix: ROUTES.exams, title: '真题' },
  { prefix: ROUTES.records, title: '做题记录' },
  { prefix: ROUTES.drill, title: '专项练习' },
  { prefix: ROUTES.wrongBook, title: '错题本' },
  { prefix: ROUTES.statsExams, title: '真题成绩' },
  { prefix: ROUTES.attempt, title: '答题' },
  { prefix: ROUTES.settingsSync, title: '同步与备份' },
  { prefix: ROUTES.settingsBackup, title: '导出与导入' },
  { prefix: ROUTES.settings, title: '我的' },
  { prefix: ROUTES.search, title: '搜索' },
];

/** 根据当前路径取页面标题（顶栏用） */
export function titleOfPath(pathname: string): string {
  const matched = PAGE_TITLE_RULES.filter(
    (rule) => pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`),
  ).sort((left, right) => right.prefix.length - left.prefix.length)[0];
  return matched?.title ?? '同等学力备考';
}
