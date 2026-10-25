/**
 * 存储相关常量（ARCHITECTURE 7.7 / T05）。
 *
 * 表名规则：小写复数 camel（7.1），与 Dexie schema 一一对应。
 * 注意：架构 3.2 把词库类型命名为 WordBook，但**表名**是 `books`（T05 表结构表），
 * 二者不是同一层命名，不要混用。
 */

/** IndexedDB 数据库名 */
export const DB_NAME = 'tdxl_english_prep';

/** schema 版本，与 Settings.schemaVersion 同源 */
export const SCHEMA_VERSION = 4;

/** 全部表名常量（v1 的 17 张 + v2 新增 2 张 + v3 新增 1 张 + v4 新增 1 张，共 21 张） */
export const TABLE = {
  books: 'books',
  words: 'words',
  wordStates: 'wordStates',
  reviewLogs: 'reviewLogs',
  sessions: 'sessions',
  sessionSnapshots: 'sessionSnapshots',
  studyDays: 'studyDays',
  notebook: 'notebook',
  exams: 'exams',
  passages: 'passages',
  questions: 'questions',
  attempts: 'attempts',
  attemptAnswers: 'attemptAnswers',
  wrongItems: 'wrongItems',
  settings: 'settings',
  secrets: 'secrets',
  syncMeta: 'syncMeta',
  /** v2：单词笔记（串记/联想/谐音/用户例句） */
  wordNotes: 'wordNotes',
  /** v2：文本高亮 */
  wordHighlights: 'wordHighlights',
  /** v3：真题划词高亮与笔记 */
  textHighlights: 'textHighlights',
  /** v4：LLM 结果缓存（讲解/诊断/评估；仅本地，不参与同步） */
  llmCache: 'llmCache',
} as const;

export type TableName = (typeof TABLE)[keyof typeof TABLE];

/** WordState 同步分片数（ARCHITECTURE 4.2：分片数进 meta.json，未来改大不改协议） */
export const WORDSTATE_SHARDS = 8;

/** 远端文件名模板（T16/T17 使用） */
export const REMOTE_FILES = {
  meta: 'meta.json',
  settings: 'settings.json',
  wordbook: 'wordbook.json',
  study: 'study.json',
  examIndex: 'exam-index.json',
  /** wordstate-0.json .. wordstate-7.json */
  wordState: (shard: number): string => `wordstate-${shard}.json`,
  /** reviewlog-2026-10.json */
  reviewLog: (month: string): string => `reviewlog-${month}.json`,
  /** exams/<paperId>.json */
  exam: (paperId: string): string => `exams/${paperId}.json`,
} as const;

/** 复习流水保留策略（T05：logRepo.prune 的默认参数） */
export const REVIEW_LOG_KEEP_DAYS = 90;
export const REVIEW_LOG_KEEP_COUNT = 50_000;

/** 墓碑保留天数（ARCHITECTURE 4.2 C4） */
export const TOMBSTONE_KEEP_DAYS = 30;

/** 本地存储键：IndexedDB 不可用时的降级标记等 */
export const LOCAL_STORAGE_KEYS = {
  theme: 'tdxl.theme',
  fontSizeScale: 'tdxl.fontScale',
} as const;

/** 手动逐题录入的草稿 localStorage 键（T13：中途退出 / 刷新不丢） */
export const MANUAL_EXAM_DRAFT_KEY = 'tdxl.examDraft.manual';

/** 答题会话元信息键前缀（剩余时间基准 / 抽题结果，T14 刷新恢复用） */
export const ATTEMPT_META_KEY_PREFIX = 'tdxl.attempt.';

/** 某次答卷的元信息 localStorage 键 */
export function attemptMetaKey(attemptId: string): string {
  return `${ATTEMPT_META_KEY_PREFIX}${attemptId}`;
}
