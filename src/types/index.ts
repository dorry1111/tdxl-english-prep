/**
 * 类型统一出口：页面与仓库层只从这里 import 类型（ARCHITECTURE 2、3）。
 */
export type {
  AppErrorShape,
  BgTheme,
  EntityId,
  Level,
  Rating,
  Result,
  StudyDayKey,
  Syncable,
  ThemeMode,
  Timestamp,
} from './common';
export { RATING } from './common';

export type {
  Confusable,
  Example,
  ExamSense,
  HighlightColor,
  HighlightScope,
  Inflections,
  Meaning,
  NotebookEntry,
  ReviewLog,
  Word,
  WordBook,
  WordHighlight,
  WordMemo,
  WordNote,
  WordNoteKind,
  WordRoot,
  WordState,
} from './word';

export type {
  CardItem,
  QueueState,
  RetryPoolEntry,
  SessionProgress,
  SessionSnapshot,
  StudySession,
  SubmitAnswerInput,
} from './session';

export type {
  Attempt,
  AttemptAnswer,
  Exam,
  GradingResult,
  ParsedPaperDraft,
  Passage,
  Question,
  QuestionOption,
  Section,
  SectionType,
  TextAnchorKind,
  TextHighlight,
  WrongItem,
} from './exam';

export type { DailyStats, PlanEstimate, StudyDay } from './stats';

export type {
  BackupFile,
  LlmCacheRecord,
  RemoteFileEntry,
  SecretRecord,
  Settings,
  StudyHotkeys,
  SyncErrorCode,
  SyncMeta,
  SyncReport,
} from './sync';
