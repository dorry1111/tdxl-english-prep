/**
 * 全部路由（声明式 `<Routes>`）。
 *
 * 策略：
 * - 一级页面与批次 3 真题域页面用 `React.lazy` 懒加载，配合 Suspense 做路由级代码分割；
 * - 尚未实现的页面（批次 2/4）统一渲染 `ComingSoonPage`，保证 URL 直接可访问、刷新不 404；
 * - 404 兜底用 `NotFoundPage`。
 *
 * 页面清单与路由以 PRD 6.1 的表格为准。
 */
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { LoadingView } from '@/components/feedback/LoadingView';
import { ROUTES } from '@/constants';
import ComingSoonPage from '@/pages/ComingSoonPage';
import NotFoundPage from '@/pages/NotFoundPage';

const HomePage = lazy(() => import('@/pages/HomePage'));
const BooksPage = lazy(() => import('@/pages/words/BooksPage'));
const StatsPage = lazy(() => import('@/pages/stats/StatsPage'));
const ExamsPage = lazy(() => import('@/pages/exams/ExamsPage'));
const RecordsPage = lazy(() => import('@/pages/records/RecordsPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const StudyPage = lazy(() => import('@/pages/study/StudyPage'));
const StudySummaryPage = lazy(() => import('@/pages/study/StudySummaryPage'));

// 真题域（T13 录入 / 校对，T14 组卷 / 答题 / 答题卡，T15 成绩 / 解析 / 错题）
// 单词域（词库 / 计划 / 统计 / 词条 / 生词本）
const PlanPage = lazy(() => import('@/pages/plan/PlanPage'));
const StatsVocabPage = lazy(() => import('@/pages/stats/StatsVocabPage'));
const WordDetailPage = lazy(() => import('@/pages/words/WordDetailPage'));
const NotebookPage = lazy(() => import('@/pages/words/NotebookPage'));

// 搜索
const SearchPage = lazy(() => import('@/pages/search/SearchPage'));

const ExamEditPage = lazy(() => import('@/pages/exams/ExamEditPage'));
const ParseReviewPage = lazy(() => import('@/pages/exams/ParseReviewPage'));
const ExamStartPage = lazy(() => import('@/pages/exams/ExamStartPage'));
const AttemptPage = lazy(() => import('@/pages/exams/AttemptPage'));
const AttemptSubjectivePage = lazy(() => import('@/pages/exams/AttemptSubjectivePage'));
const AnswerSheetPage = lazy(() => import('@/pages/exams/AnswerSheetPage'));
const ResultPage = lazy(() => import('@/pages/exams/ResultPage'));
const ReviewPage = lazy(() => import('@/pages/exams/ReviewPage'));
const WrongBookPage = lazy(() => import('@/pages/exams/WrongBookPage'));
const StatsExamsPage = lazy(() => import('@/pages/exams/StatsExamsPage'));

/** 未实现页面（批次 2/4）的说明文案，集中一处便于将来逐个删除 */
const SOON = {
  booksImport: {
    title: '词库导入',
    description: '这里将支持粘贴 TXT / 选择 CSV 导入自定义词库，并给出逐行错误清单（批次 4）。',
  },
  wordDetail: {
    title: '词条详情',
    description: '这里将展示单词的音标、释义、例句、词根与学习历史（批次 2）。',
  },
  notebook: {
    title: '生词本',
    description: '这里将列出收藏的单词，可按来源筛选，并可直接进入学习（批次 4）。',
  },
  settingsSync: {
    title: '同步与备份',
    description: '这里将填写 WebDAV 地址、账号、应用密码，并展示同步状态与失败原因（批次 4）。',
  },
  settingsBackup: {
    title: '导出与导入',
    description: '这里将提供全量导出 JSON 与合并 / 覆盖导入（批次 4）。',
  },
  search: {
    title: '全局搜索',
    description: '这里将支持按前缀搜索单词与试卷（P2）。',
  },
} as const;

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingView />}>
      <Routes>
        {/* 一级导航 */}
        <Route path={ROUTES.home} element={<HomePage />} />
        <Route path={ROUTES.books} element={<BooksPage />} />
        <Route path={ROUTES.stats} element={<StatsPage />} />
        <Route path={ROUTES.exams} element={<ExamsPage />} />
        <Route path={ROUTES.records} element={<RecordsPage />} />
        <Route path={ROUTES.settings} element={<SettingsPage />} />

        {/* 学习 */}
        <Route path={ROUTES.study} element={<StudyPage />} />
        <Route path={ROUTES.studySummary} element={<StudySummaryPage />} />
        <Route path={ROUTES.plan} element={<PlanPage />} />

        {/* 选词 */}
        <Route path={ROUTES.booksImport} element={<ComingSoonPage {...SOON.booksImport} />} />
        <Route path={ROUTES.wordDetail} element={<WordDetailPage />} />
        <Route path={ROUTES.notebook} element={<NotebookPage />} />
        <Route path={ROUTES.statsVocab} element={<StatsVocabPage />} />

        {/* 真题 */}
        <Route path={ROUTES.examEdit} element={<ExamEditPage />} />
        <Route path={ROUTES.examParseReview} element={<ParseReviewPage />} />
        <Route path={ROUTES.examStart} element={<ExamStartPage />} />
        <Route path={ROUTES.attempt} element={<AttemptPage />} />
        <Route path={ROUTES.attemptSubjective} element={<AttemptSubjectivePage />} />
        <Route path={ROUTES.attemptSheet} element={<AnswerSheetPage />} />
        <Route path={ROUTES.attemptResult} element={<ResultPage />} />
        <Route path={ROUTES.attemptReview} element={<ReviewPage />} />
        <Route path={ROUTES.wrongBook} element={<WrongBookPage />} />
        <Route path={ROUTES.statsExams} element={<StatsExamsPage />} />
        {/* 专项练习：组卷入口在试卷库「开始模拟」页（整卷 / 专项切换），旧路径重定向 */}
        <Route path={ROUTES.drill} element={<Navigate to={ROUTES.exams} replace />} />

        {/* 我的 */}
        <Route path={ROUTES.settingsSync} element={<ComingSoonPage {...SOON.settingsSync} />} />
        <Route path={ROUTES.settingsBackup} element={<ComingSoonPage {...SOON.settingsBackup} />} />

        {/* 其他 */}
        <Route path={ROUTES.search} element={<SearchPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
