/**
 * Dexie 表结构与索引定义（ARCHITECTURE T05 表结构表）。
 *
 * 索引设计的两条底线：
 * 1. `wordStates` 的主键是 `stateKey`（不是 wordId），并保留 `dueAt` 单列索引，
 *    因为「取到期复习词」是全项目最高频的查询：`where('dueAt').belowOrEqual(now)`；
 * 2. `words` 保留 `bookId` 与 `norm` 单列索引（外加 `[bookId+norm]` 复合索引），
 *    支撑「按库取词」「按 norm 查词」「拼音/前缀搜索」。
 */
import Dexie, { type Table } from 'dexie';

import { DB_NAME, SCHEMA_VERSION, TABLE } from '@/constants';
import type {
  Attempt,
  AttemptAnswer,
  Exam,
  LlmCacheRecord,
  NotebookEntry,
  Passage,
  Question,
  ReviewLog,
  SessionSnapshot,
  Settings,
  SecretRecord,
  StudyDay,
  StudySession,
  SyncMeta,
  TextHighlight,
  Word,
  WordBook,
  WordHighlight,
  WordNote,
  WordState,
  WrongItem,
} from '@/types';

/**
 * 表结构定义（version 1）。
 *
 * 语法说明：`'primaryKey, index1, index2, [a+b]'`，
 * `[a+b]` 是复合索引；主键必须写在第一项。
 *
 * 【实现偏离·未给 boolean 字段建索引】
 * T05 的表结构表里列了 `books.enabled`、`wordStates.unstable/isStarred`、
 * `wrongItems.resolved`。但 IndexedDB 的合法键只有 number / string / Date / 二进制 / 数组，
 * **boolean 不是合法键**：给 boolean 字段建索引，写入时该条记录不会进索引（查询恒为空），
 * 用 `where(...).equals(true)` 还会直接抛 DataError。
 * 因此这里不建这些索引，改由仓库层在内存里过滤（数据量在「单用户万级」以内，
 * 全表 filter 的代价远小于引入 0/1 冗余字段带来的类型失真）。
 */
export const SCHEMA_V1 = {
  [TABLE.books]: 'id, source, priority',
  [TABLE.words]: 'id, bookId, norm, [bookId+norm], frequencyRank',
  [TABLE.wordStates]: 'stateKey, wordId, bookId, dueAt, level, updatedAt',
  [TABLE.reviewLogs]: 'id, wordId, sessionId, answeredAt',
  [TABLE.sessions]: 'id, studyDay, startedAt',
  [TABLE.sessionSnapshots]: 'sessionId, studyDay',
  [TABLE.studyDays]: 'studyDay',
  [TABLE.notebook]: 'id, wordId, source',
  [TABLE.exams]: 'id, parseStatus, updatedAt',
  [TABLE.passages]: 'id, paperId, [paperId+order]',
  [TABLE.questions]: 'id, paperId, [paperId+seq], sectionType',
  [TABLE.attempts]: 'id, paperId, startedAt',
  [TABLE.attemptAnswers]: 'id, attemptId, questionId, [attemptId+questionId]',
  [TABLE.wrongItems]: 'id, questionId, sectionType',
  [TABLE.settings]: 'id',
  [TABLE.secrets]: 'id',
  [TABLE.syncMeta]: 'entity, dirtyAt',
} as const;

/**
 * 表结构定义（version 2）。
 *
 * v2 只新增两张表（笔记与高亮批次），v1 的 17 张表结构原样保留；
 * Dexie 对「仅加表」的升级自动迁移，无需 upgrade 回调。
 *
 * 设计说明：
 * - 两张表都带 `stateKey` 索引（主查询维度）与 `[stateKey+kind]` / `[stateKey+scope]`
 *   复合索引，支撑「取某词全部笔记 / 全部高亮」与「取某词某一类笔记」；
 * - wordNotes 的「每词每类一条」唯一性由仓库层 upsert 语义保证
 *   （先按 [stateKey+kind] 查再复用主键 put），不建 unique 索引，
 *   避免 example 类一词多条与唯一约束冲突。
 */
export const SCHEMA_V2: Record<string, string> = {
  ...SCHEMA_V1,
  [TABLE.wordNotes]: 'id, stateKey, wordId, kind, [stateKey+kind]',
  [TABLE.wordHighlights]: 'id, stateKey, wordId, scope, [stateKey+scope]',
};

/**
 * 表结构定义（version 3）。
 *
 * v3 只新增一张表（真题划词高亮与笔记），v1/v2 的 19 张表结构原样保留；
 * Dexie 对「仅加表」的升级自动迁移，无需 upgrade 回调。
 */
export const SCHEMA_V3: Record<string, string> = {
  ...SCHEMA_V2,
  [TABLE.textHighlights]: 'id, anchorId, [anchorKind+anchorId]',
};

/**
 * 表结构定义（version 4）。
 *
 * v4 只新增一张表（LLM 结果缓存），v1~v3 的 20 张表结构原样保留；
 * Dexie 对「仅加表」的升级自动迁移，无需 upgrade 回调。
 *
 * 设计说明：
 * - 主键 = `llm:<feature>:<refId>` 由调用方拼装，天然按功能+引用去重；
 * - `feature` 与 `promptVersion` 建索引：按功能列历史、提示词升级后批量失效；
 * - 不参与同步（sync engine 的表清单不含本表），多设备各自缓存避免重复计费。
 */
export const SCHEMA_V4: Record<string, string> = {
  ...SCHEMA_V3,
  [TABLE.llmCache]: 'id, feature, promptVersion, createdAt',
};

/**
 * 应用唯一的 Dexie 子类。
 * 只在这里声明表字段类型，具体读写必须走 `db/repos/*`（ARCHITECTURE 7.2）。
 */
export class TdxlDB extends Dexie {
  books!: Table<WordBook, string>;
  words!: Table<Word, string>;
  wordStates!: Table<WordState, string>;
  reviewLogs!: Table<ReviewLog, string>;
  sessions!: Table<StudySession, string>;
  sessionSnapshots!: Table<SessionSnapshot, string>;
  studyDays!: Table<StudyDay, string>;
  notebook!: Table<NotebookEntry, string>;
  exams!: Table<Exam, string>;
  passages!: Table<Passage, string>;
  questions!: Table<Question, string>;
  attempts!: Table<Attempt, string>;
  attemptAnswers!: Table<AttemptAnswer, string>;
  wrongItems!: Table<WrongItem, string>;
  settings!: Table<Settings, 'global'>;
  /** 主键是字符串 id：'webdav-pass'（WebDAV 密码）/ 'llm-key'（大模型 Key）等，一类凭据一条 */
  secrets!: Table<SecretRecord, string>;
  syncMeta!: Table<SyncMeta, string>;
  /** v2：单词笔记（串记/联想/谐音/用户例句） */
  wordNotes!: Table<WordNote, string>;
  /** v2：文本高亮 */
  wordHighlights!: Table<WordHighlight, string>;
  /** v3：真题划词高亮与笔记 */
  textHighlights!: Table<TextHighlight, string>;
  /** v4：LLM 结果缓存（仅本地，不参与同步） */
  llmCache!: Table<LlmCacheRecord, string>;

  constructor(name: string = DB_NAME) {
    super(name);
    // v1 → v2 → v3 → v4 均仅新增表，Dexie 自动迁移，无需 upgrade 回调
    this.version(1).stores(SCHEMA_V1);
    this.version(2).stores(SCHEMA_V2);
    this.version(3).stores(SCHEMA_V3);
    this.version(SCHEMA_VERSION).stores(SCHEMA_V4);
  }
}

/**
 * 迁移模板（下一版 schema 生效时照此添加，**不要**直接改 SCHEMA_V1）：
 *
 * ```ts
 * db.version(2)
 *   .stores({ wordStates: 'stateKey, wordId, bookId, dueAt, level, unstable, isStarred, updatedAt, newField' })
 *   .upgrade(async (tx) => {
 *     // 逐条补数据；stateKey 规则如需变更，必须在这里重算并搬运
 *   });
 * ```
 */
export const MIGRATION_TEMPLATE_NOTE =
  '新增字段或索引时必须新增 version(n)，禁止修改已发布的 SCHEMA_V1。';
