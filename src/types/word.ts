/**
 * 单词域类型（ARCHITECTURE 3.2）。
 *
 * 【架构裁决·stateKey】WordState 的主键不是 wordId，而是 `fnv1a(norm)` 的十进制字符串，
 * 这样同一个单词出现在两个词库里也只共享一份学习状态（WRD-11）。详见 3.2.1。
 */
import type { EntityId, Level, Rating, StudyDayKey, Syncable, Timestamp } from './common';

/** 词库（PRD 中称 VocabBook） */
export interface WordBook extends Syncable {
  id: EntityId;
  name: string;
  /** builtin 内置 / imported 用户导入 / virtual-notebook 生词本虚拟库 */
  source: 'builtin' | 'imported' | 'virtual-notebook';
  /** 词条数（冗余，便于列表展示，写入时维护） */
  wordCount: number;
  /** 是否参与学习 */
  enabled: boolean;
  /** 多词库叠加顺序，数字小者优先 */
  priority: number;
  createdAt: Timestamp;
}

/** 义项 */
export interface Meaning {
  /** 词性，如 "v." / "n."，可为空串 */
  pos: string;
  /** 中文释义，单条 */
  cn: string;
}

/** 例句 */
export interface Example {
  en: string;
  zh?: string;
}

/** 词根词缀 */
export interface WordRoot {
  type: 'prefix' | 'root' | 'suffix';
  text: string;
  meaning: string;
}

/** 易混词（与某词真实高频易混的对照说明） */
export interface Confusable {
  word: string;
  diff: string;
}

/** 考纲义项（熟词僻义/真题搭配，备考向） */
export interface ExamSense {
  pos: string;
  cn: string;
  note?: string;
}

/** 词形变化（规则脚本生成，仅收录高置信度形式） */
export interface Inflections {
  /** 名词复数 */
  plural?: string;
  /** 动词第三人称单数 */
  third?: string;
  /** 动词过去式 */
  past?: string;
  /** 动词过去分词 */
  pastParticiple?: string;
  /** 现在分词 */
  presentParticiple?: string;
  /** 副词/比较级等其它形式说明 */
  other?: string;
  /** 是否为不规则变化（true 时上述形式与原词不同源规则） */
  irregular?: boolean;
}

/**
 * 单词记忆内容（memo 分片，按首字母分 26 片）。
 * 四类内容全部可选：缺失字段由 UI 整块隐藏。
 */
export interface WordMemo {
  mnemonic?: string;
  roots?: WordRoot[];
  confusables?: Confusable[];
  examSenses?: ExamSense[];
  inflections?: Inflections;
}

/** 词条 */
export interface Word extends Syncable {
  /** 内置词库 id = `${bookId}:${norm}`；用户导入词 id 同规则，保证去重天然成立 */
  id: EntityId;
  bookId: EntityId;
  /** 单词/词组原文，展示用 */
  headword: string;
  /** 归一化：小写 + 去首尾空格 + 多空格合一；去重与搜索都基于它 */
  norm: string;
  phoneticUs?: string;
  phoneticUk?: string;
  /** 词性列表，如 ["v.","n."] */
  pos?: string[];
  meanings: Meaning[];
  examples?: Example[];
  mnemonic?: string;
  roots?: WordRoot[];
  /** 词频序，越小越常见；用于「按考频排序」与内置词库的默认学习顺序 */
  frequencyRank?: number;
  /**
   * 词库原序（大纲原始下标）。内置词库索引里必有；
   * 缺失词频时的排序回退键（ARCHITECTURE 3.2.3 W1）。
   */
  sourceOrder?: number;
  /** 预留：本地/远程音频地址，P0 不启用，一律走系统 TTS */
  audioUrl?: string;
  createdAt: Timestamp;
}

/** 单词学习状态（核心，每词一条） */
export interface WordState extends Syncable {
  /**
   * 主键 = 学习身份键，见 3.2.1 裁决。
   * 取值为 `fnv1a(norm)` 的十进制字符串，跨词库共享同一份学习状态。
   */
  stateKey: string;
  /** 最近一次来源词条 ID，仅用于展示与回溯，不参与唯一性判断 */
  wordId: EntityId;
  /** 冗余，便于按库统计与分片 */
  bookId: EntityId;
  /** 熟练度等级 0~10 */
  level: Level;
  /** 下次到期时间戳，调度的唯一依据 */
  dueAt: Timestamp;
  /** 最近一次评分 */
  lastRating: Rating | null;
  lastReviewAt: Timestamp | null;
  /** 首次学习时间，用于「今日新词」统计 */
  firstLearnedAt: Timestamp | null;
  reviewCount: number;
  correctCount: number;
  wrongCount: number;
  /** 「不认识」累计次数 */
  lapseCount: number;
  /** 今日会话内重现次数（学习日切换时归零） */
  retryCountToday: number;
  /**
   * 【架构补充】retryCountToday 归属的学习日。
   * 用于判断该计数是否已过期需清零——PRD 未定义此字段，缺它无法实现「跨日清零」。
   */
  retryDay: StudyDayKey;
  /** 今日达 MAX_RETRY 仍答错，次日首页提示「N 个词不稳定，建议重背」 */
  unstable: boolean;
  /** 是否收藏（生词本主开关，冗余便于快查） */
  isStarred: boolean;
  /** 首次达到 MASTER_L 的时间 */
  masteredAt: Timestamp | null;
}

/** 答题流水（追加型，按月分片同步） */
export interface ReviewLog {
  id: EntityId;
  /** 词条 ID（Word.id） */
  wordId: EntityId;
  /** 学习身份键（见 3.2.1），统计去重用这个 */
  stateKey: string;
  sessionId: EntityId;
  rating: Rating;
  prevLevel: Level;
  newLevel: Level;
  prevDueAt: Timestamp;
  newDueAt: Timestamp;
  answeredAt: Timestamp;
  /** 看卡耗时，用于识别「秒过」异常 */
  durationMs: number;
  /** 是否当日重现轮次 */
  isRetry: boolean;
  deviceId: string;
}

/** 生词本条目（PRD 中称 WordbookEntry） */
export interface NotebookEntry extends Syncable {
  id: EntityId;
  wordId: EntityId;
  /** 冗余，词条被删后仍可展示 */
  headword: string;
  source: 'manual' | 'exam-wrong' | 'imported';
  /** 来源试卷/题目 ID */
  sourceRef: string | null;
  note: string;
  createdAt: Timestamp;
}

/**
 * 单词笔记类型：
 * - chunk 串记（串联记忆）/ assoc 联想 / homophone 谐音：每词每类一条（upsert）；
 * - example 用户例句：原词库数据无例句，用户自行添加，一词可多条。
 */
/**
 * 笔记类型。'note' 为单一自由备注（当前 UI 唯一入口）；
 * chunk/assoc/homophone 为历史三类结构化笔记（UI 已移除，数据与同步保留兼容）。
 */
export type WordNoteKind = 'chunk' | 'assoc' | 'homophone' | 'example' | 'note';

/** 单词自定义笔记（同步实体，远端落在 wordbook.json） */
export interface WordNote extends Syncable {
  id: EntityId;
  /** 学习身份键（fnv1a(norm)），笔记跨词库跟随学习状态 */
  stateKey: string;
  wordId: EntityId;
  kind: WordNoteKind;
  /** 主内容：笔记正文；kind='example' 时为英文例句 */
  content: string;
  /** 仅 kind='example' 时使用：例句中文翻译，可为空 */
  zh: string | null;
  createdAt: Timestamp;
}

/** 高亮作用域：词头 / 义项 / 例句 */
export type HighlightScope = 'headword' | 'meaning' | 'example';

/** 高亮颜色档位 1~4（渲染映射到 --c-hl-1..4 CSS 变量） */
export type HighlightColor = 1 | 2 | 3 | 4;

/** 文本高亮记录（同一段文本可被多次高亮，还原时取 createdAt 最新的一档） */
export interface WordHighlight extends Syncable {
  id: EntityId;
  stateKey: string;
  wordId: EntityId;
  scope: HighlightScope;
  /**
   * scope='example' 时为例句下标（词库自带例句在前，用户例句接续编号）；
   * headword / meaning 恒为 null。
   */
  exampleIndex: number | null;
  /** 被高亮的文本子串（还原时按 scope + exampleIndex + 文本匹配定位） */
  text: string;
  color: HighlightColor;
  createdAt: Timestamp;
}
