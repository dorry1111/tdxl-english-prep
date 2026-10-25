/**
 * 真题域类型（ARCHITECTURE 3.4）。
 */
import type { EntityId, Syncable, Timestamp } from './common';
import type { HighlightColor } from './word';

/** 七大题型 */
export type SectionType =
  | 'dialogue' // 口语交际
  | 'vocabulary' // 词汇
  | 'reading' // 阅读理解
  | 'cloze' // 完形填空
  | 'short-completion' // 短文完成
  | 'translation' // 英译汉
  | 'writing'; // 写作

/** 区段（试卷的组成单元，定义分值而不定义题目） */
export interface Section {
  type: SectionType;
  /** 区段顺序，1 起 */
  order: number;
  /** 区段总分，由试卷数据定义，不硬编码 */
  score: number;
  questionCount: number;
  /** 该区段下的文章 ID 列表（无文章的题型为空数组） */
  passageIds: EntityId[];
}

/** 试卷（PRD 中称 ExamPaper） */
export interface Exam extends Syncable {
  id: EntityId;
  title: string;
  source: 'builtin' | 'pasted' | 'manual' | 'json';
  sections: Section[];
  totalQuestions: number;
  totalScore: number;
  /** 整卷限时秒数，默认 7200 */
  timeLimitSec: number;
  /** draft 草稿 / parsed 已切题待校对 / verified 已校对可模拟 */
  parseStatus: 'draft' | 'parsed' | 'verified';
  createdAt: Timestamp;
}

/** 文章（阅读/完形/短文完成的共用原文） */
export interface Passage extends Syncable {
  id: EntityId;
  paperId: EntityId;
  sectionType: SectionType;
  /** 区段内顺序 */
  order: number;
  /** 原文纯文本，保留换行与空行分段 */
  content: string;
  /** 参考译文，可空 */
  translation?: string;
}

export interface QuestionOption {
  key: string; // 'A' | 'B' | 'C' | 'D'
  text: string;
}

/** 题目 */
export interface Question extends Syncable {
  id: EntityId;
  paperId: EntityId;
  sectionType: SectionType;
  /** 阅读/完形/短文完成必填，其余为 null */
  passageId: EntityId | null;
  /** 全卷序号，1 起，唯一且连续 */
  seq: number;
  stem: string;
  /** 完形/短文完成的空位序 */
  blankIndex: number | null;
  /** 客观题的选项；主观题为空数组 */
  options: QuestionOption[];
  /** 客观题答案字母 */
  answerKey: string | null;
  /** 主观题参考答案/范文 */
  referenceAnswer: string | null;
  explanation: string;
  score: number;
  /** 由 sectionType 推导，便于判分与统计（写入时落库，不运行时算） */
  isObjective: boolean;
}

/** 一次答卷（PRD 中称 ExamAttempt） */
export interface Attempt extends Syncable {
  id: EntityId;
  paperId: EntityId;
  /** full 整卷模拟 / section 专项练习 */
  mode: 'full' | 'section';
  /** 专项模式的题型 */
  sectionType: SectionType | null;
  startedAt: Timestamp;
  submittedAt: Timestamp | null;
  durationSec: number;
  objectiveScore: number;
  subjectiveScore: number | null;
  totalScore: number;
  deviceId: string;
}

/** 单题作答明细（追加型） */
export interface AttemptAnswer {
  id: EntityId;
  attemptId: EntityId;
  questionId: EntityId;
  /** 客观题所选字母 */
  choice: string | null;
  /** 主观题作答文本 */
  text: string | null;
  /** 客观题判分结果；主观题为 null */
  isCorrect: boolean | null;
  flagged: boolean;
  /** 主观题自评得分 */
  selfScore: number | null;
  answeredAt: Timestamp;
}

/** 错题（PRD 中称 WrongQuestion） */
export interface WrongItem extends Syncable {
  id: EntityId;
  questionId: EntityId;
  paperId: EntityId;
  sectionType: SectionType;
  wrongCount: number;
  lastWrongAt: Timestamp;
  /** 重做答对后置 true，移出待复习 */
  resolved: boolean;
}

/** 真题划词锚点类型：阅读原文段落 / 题目（题干与解析） */
export type TextAnchorKind = 'passage' | 'question';

/**
 * 真题划词高亮与笔记（v3 新增，同步实体，远端落在 wordbook.<device>.json）。
 *
 * 锚点设计：只锚 passageId / questionId（内置卷确定性 ID，跨设备同步后仍可还原），
 * 不锚 attemptId——真题域的 attempt 不参与云同步，别的设备上不存在该 ID。
 * 同一套卷的高亮跨答题次数共享。
 */
export interface TextHighlight extends Syncable {
  id: EntityId;
  anchorKind: TextAnchorKind;
  /** passageId（anchorKind='passage'）或 questionId（anchorKind='question'） */
  anchorId: EntityId;
  /**
   * 块内定位：
   * - passage：`p:<段落序号>`（PassageView splitParagraphs 的下标，0 起）
   * - question：`stem`（题干）/ `explanation`（解析，仅回看模式）
   */
  blockKey: string;
  /** 被高亮的文本子串（还原时在块内 indexOf 定位） */
  text: string;
  /** 块内字符起点提示（多个相同子串时取离 start 最近者；允许 null） */
  start: number | null;
  color: HighlightColor;
  /** 划词笔记正文，可空（纯高亮无笔记） */
  note: string | null;
  /** 划的是单个英文单词时的归一化形式（生词本联动 / 搜索用），其余为 null */
  wordNorm: string | null;
  createdAt: Timestamp;
}

/** 切题中间产物（不落库，仅校对页内存态） */
export interface ParsedPaperDraft {  title: string;
  timeLimitSec: number;
  sections: Section[];
  passages: Passage[];
  questions: Question[];
  /** 未能归类的内容，必须在校对页展示，禁止静默丢弃 */
  unresolved: Array<{ lineNo: number; text: string; reason: string }>;
  /** 自动切题的置信度与告警（如「答案数量与题目数量不一致」） */
  warnings: string[];
}

/** 判分结果（grade.ts 纯函数输出） */
export interface GradingResult {
  objectiveScore: number;
  totalScore: number;
  correctCount: number;
  answeredCount: number;
  /** 需要写入错题本的题目 */
  wrongQuestionIds: EntityId[];
  /** 逐题明细 */
  perQuestion: Array<{
    questionId: EntityId;
    isCorrect: boolean | null;
    earned: number;
  }>;
}
