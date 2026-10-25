/**
 * 同步与设置域类型（ARCHITECTURE 3.6）。
 */
import type { EntityId, StudyDayKey, Timestamp } from './common';

/** 全局设置（单条记录，主键固定为 'global'） */
export interface Settings {
  id: 'global';

  // 考试
  examDate: StudyDayKey;
  activeBookIds: EntityId[];
  bookMode: 'single' | 'stack';
  /**
   * 当前学习词书（BooksPage 选书用）。
   *
   * 可选项：老记录没有这个字段，缺值时一律回退 `activeBookIds[0]`
   * （见 store/bookSelection.currentBookIdOf），因此无需数据迁移。
   * 取值链路仍是 `activeBookIds`：选书时两处一起写，保证取词与展示同源。
   */
  currentBookId?: EntityId | null;

  // 学习
  newWordLimit: number; // 默认 20，范围 1~200
  /**
   * 每日学习量的口径模式（PlanPage 三档）：
   * - auto：按剩余词数与考试日期推算新词上限；
   * - manual：固定每日新词上限（1~200）；
   * - quota：按「总学习量」控制，复习优先占满，余量给新词（见 dailyStudyQuota）。
   */
  newWordLimitMode: 'auto' | 'manual' | 'quota';
  /**
   * 每日总学习量（quota 模式生效，默认 50，范围 10~500）。
   *
   * 口径：每日学习量 = 待复习词 + 新学词，复习优先占满，余量给新词。
   * 可选字段：旧记录缺省时回退默认值（clampDailyStudyQuota），无需数据迁移。
   */
  dailyStudyQuota?: number;
  retryGapMin: number; // 默认 3
  retryGapMax: number; // 默认 5
  maxRetry: number; // 默认 5
  dayStartHour: number; // 默认 4
  sessionBatchSize: number; // 默认 200

  // 发音
  ttsEnabled: boolean;
  ttsAutoPlay: boolean;
  ttsRate: number; // 0.5 ~ 1.5
  ttsAccent: 'us' | 'uk';
  /** TTS 默认口径 v2 迁移标记（英式 + 自动朗读）；缺失即旧版默认值，启动时一次性升级 */
  ttsDefaultsV2?: boolean;
  /**
   * iOS 同步默认开启迁移标记（v1.8.0 一次性）：缺失即旧版 iOS 默认关闭同步。
   * 迁移后用户手动关闭 syncEnabled 也不会再被覆盖。
   */
  iosSyncDefaultsApplied?: boolean;

  // 显示
  theme: 'auto' | 'light' | 'dark';
  fontScale: number; // 1.0 基准，0.9 ~ 1.3

  // 同步
  syncEnabled: boolean;
  webdavUrl: string;
  webdavUser: string;
  useProxy: boolean;
  proxyUrl: string;
  /** 只读展示，永不被对端覆盖（PRD 9.2 C6） */
  deviceId: string;
  lastSyncAt: Timestamp | null;
  lastExportAt: Timestamp | null;
  /** 已应用的 NAS 数据集版本（datasets/manifest.json 的 version），用于增量更新判断 */
  datasetVersion?: number;

  // AI 释义（搜索弹窗用；三个字段都可选：旧记录缺省时回退 provider 预设，无需迁移。
  // API Key 不在此处 —— 走 secrets 表 id='llm-key'，只存本机不参与同步）
  llmProvider?: 'deepseek' | 'kimi' | 'doubao' | 'custom';
  /** 缺省 = 按 llmProvider 取预设地址 */
  llmBaseUrl?: string;
  /** 缺省 = 按 llmProvider 取预设模型名 */
  llmModel?: string;

  // 学习快捷键（可选字段：旧记录缺省时回退内置默认，无需迁移。
  // keyboard 存 KeyboardEvent.key 的小写形式；gamepad 存标准 Gamepad 布局的按钮索引）
  studyHotkeys?: StudyHotkeys;

  // 其他
  schemaVersion: number;

  /**
   * 【架构补充】同步版本字段。
   * Settings 需要参与「后写优先」合并，但 3.6 的定稿没有 updatedAt/deletedAt；
   * 这里补两个字段让 mergeRecords 的通用签名可以直接套用，避免同步层写特例分支。
   */
  updatedAt: Timestamp;
  deletedAt: Timestamp | null;
}

/**
 * WebDAV 密码 / 大模型 Key 等敏感凭据单独存放，绝不进入 Settings。
 * 硬约束：不参与同步、不进入导出文件、不打印日志。
 * id 按凭据类别区分：'webdav-pass'（同步密码）、'llm-key'（大模型 API Key）。
 */
export interface SecretRecord {
  id: string;
  value: string;
  updatedAt: Timestamp;
}

/**
 * LLM 结果缓存（v4 新增表）。
 *
 * 用途：AI 讲解 / AI 诊断 / AI 评估的结果落库，二次使用直接读缓存——
 * 刷新不丢、离线可看、不重复计费。promptVersion 用于提示词升级后
 * 自动失效（调用方比对版本号决定是否重新生成）。
 *
 * 硬约束：仅本地表，不进 sync 的 PullPayloads/推送清单——
 * 多设备各算各的，避免同一功能在 N 台设备上重复调用计费。
 */
export interface LlmCacheRecord {
  /** `llm:<feature>:<refId>`，如 llm:explain:e2024-q31 / llm:plan:2026-10-25 */
  id: string;
  /** 功能标识：explain / diagnose / plan */
  feature: 'explain' | 'diagnose' | 'plan';
  /** 提示词版本（LLM_PROMPT_VERSION）：不同版本视为不同缓存 */
  promptVersion: number;
  /** 生成结果的纯文本内容（五段/四段/三段固定结构） */
  content: string;
  /** 生成时使用的模型名 */
  model: string;
  createdAt: Timestamp;
}

/**
 * 学习页四档评级的自定义快捷键（不认识/模糊/认识/熟识 → Rating 1~4）。
 * 两个子对象都是整体可选：用户没自定义过就是 undefined，运行时回退内置默认。
 */
export interface StudyHotkeys {
  /** 键盘：ratingN = KeyboardEvent.key 的小写形式（如 '1'、'a'、'f2'） */
  keyboard?: { rating1?: string; rating2?: string; rating3?: string; rating4?: string };
  /** 手柄：ratingN / reveal = 标准 Gamepad 布局的按钮索引（0=A 1=B 2=X 3=Y 9=Start） */
  gamepad?: { rating1?: number; rating2?: number; rating3?: number; rating4?: number; reveal?: number };
}

/** 同步元信息（仅本地，不同步） */
export interface SyncMeta {
  /** 实体文件名，如 'wordstate-3.json'、'settings.json' */
  entity: string;
  /** 本地最后一次变更时间，用于判定是否需要上传 */
  dirtyAt: Timestamp | null;
  /** 最后拉取时间 */
  lastPulledAt: Timestamp | null;
  /** 远端文件版本标识（ETag，可能带引号） */
  lastEtag: string | null;
  /** 待上传变更条数（按主键去重计数） */
  pendingCount: number;
}

/** PROPFIND 返回的远端文件条目 */
export interface RemoteFileEntry {
  /** 相对远端根目录的路径，如 'wordstate-3.json' */
  name: string;
  etag: string | null;
  lastModified: string | null;
  contentLength: number | null;
  isDirectory: boolean;
}

export type SyncErrorCode =
  | 'NETWORK' // 网络不通 / 超时
  | 'AUTH' // 401/403 认证失败
  | 'PROXY' // 代理异常（5xx、CORS、自定义 header 被拦）
  | 'CONFLICT' // 412 且重试耗尽
  | 'PARSE' // 远端内容格式不符合预期
  | 'DISABLED'; // 同步未启用

export interface SyncReport {
  startedAt: Timestamp;
  finishedAt: Timestamp;
  /** 各实体上传/下载条数 */
  uploaded: Record<string, number>;
  downloaded: Record<string, number>;
  /** 冲突自动解决次数（用于 SYN-06 展示） */
  conflicts: number;
  error: { code: SyncErrorCode; message: string; detail?: unknown } | null;
}

/** 备份文件外壳 */
export interface BackupFile {
  schemaVersion: number;
  exportedAt: Timestamp;
  deviceId: string;
  counts: Record<string, number>;
  data: {
    books: unknown[];
    words: unknown[];
    wordStates: unknown[];
    reviewLogs: unknown[];
    sessions: unknown[];
    studyDays: unknown[];
    notebook: unknown[];
    exams: unknown[];
    passages: unknown[];
    questions: unknown[];
    attempts: unknown[];
    attemptAnswers: unknown[];
    wrongItems: unknown[];
    settings: Settings;
  };
}
