/**
 * 七大题型定义（ARCHITECTURE 7.7、PRD 4.3.1）。
 * 规则以数据表形式声明，后续若考试大纲变化只改这里，不改逻辑。
 */
import type { SectionType } from '@/types';

/** 题型定义 */
export interface SectionMeta {
  /** 中文名（标题、筛选项直接用） */
  name: string;
  /** 短名（窄屏、标签用） */
  shortName: string;
  /** 标识色，取 CSS 变量 */
  color: string;
  /** 是否客观题（可自动判分） */
  isObjective: boolean;
  /** 卷面顺序，1 起 */
  order: number;
  /** 图标 key，由 Icon 组件映射 */
  icon: 'dialogue' | 'vocabulary' | 'reading' | 'cloze' | 'short-completion' | 'translation' | 'writing';
}

export const SECTION_META: Record<SectionType, SectionMeta> = {
  dialogue: {
    name: '口语交际',
    shortName: '口语',
    color: 'var(--c-sec-dialogue)',
    isObjective: true,
    order: 1,
    icon: 'dialogue',
  },
  vocabulary: {
    name: '词汇',
    shortName: '词汇',
    color: 'var(--c-sec-vocabulary)',
    isObjective: true,
    order: 2,
    icon: 'vocabulary',
  },
  reading: {
    name: '阅读理解',
    shortName: '阅读',
    color: 'var(--c-sec-reading)',
    isObjective: true,
    order: 3,
    icon: 'reading',
  },
  cloze: {
    name: '完形填空',
    shortName: '完形',
    color: 'var(--c-sec-cloze)',
    isObjective: true,
    order: 4,
    icon: 'cloze',
  },
  'short-completion': {
    name: '短文完成',
    shortName: '短文',
    color: 'var(--c-sec-short)',
    isObjective: true,
    order: 5,
    icon: 'short-completion',
  },
  translation: {
    name: '英译汉',
    shortName: '翻译',
    color: 'var(--c-sec-translation)',
    isObjective: false,
    order: 6,
    icon: 'translation',
  },
  writing: {
    name: '写作',
    shortName: '写作',
    color: 'var(--c-sec-writing)',
    isObjective: false,
    order: 7,
    icon: 'writing',
  },
};

/** 按卷面顺序排列的题型列表 */
export const SECTION_TYPES_BY_ORDER: readonly SectionType[] = (
  Object.keys(SECTION_META) as SectionType[]
).sort((a, b) => SECTION_META[a].order - SECTION_META[b].order);

/** 由题型推「是否客观题」（写入题目时落库，不在运行时现算） */
export function isObjectiveSection(type: SectionType): boolean {
  return SECTION_META[type].isObjective;
}

/** 整卷默认限时（秒）：2 小时（PRD / Exam.timeLimitSec 默认值） */
export const DEFAULT_EXAM_TIME_LIMIT_SEC = 7200;

/* ------------------------------------------------------------------ */
/* T13/T14/T15：答题与 UI 相关常量                                      */
/* ------------------------------------------------------------------ */

/** 答题草稿落库间隔（毫秒，PRD T14：每 3s 写一次 IndexedDB 防杀进程丢答案） */
export const ATTEMPT_FLUSH_INTERVAL_MS = 3000;

/** 倒计时告警阈值（剩余秒数，PRD T14：剩 5 分钟变红） */
export const COUNTDOWN_WARN_SEC = 300;

/** 专项练习的固定题量选项（「全部」单独渲染） */
export const DRILL_COUNT_OPTIONS: readonly number[] = [10, 20, 30];

/** 专项练习限时：每题分配秒数（勾选「限时」时 题量 × 该值） */
export const DRILL_TIME_PER_QUESTION_SEC = 60;

/** 主观题自评满分（英译汉 0~10 / 写作 0~15，PRD 3.4.1） */
export const SUBJECTIVE_MAX_SCORE = {
  translation: 10,
  writing: 15,
} as const;

/** 区段序号的罗马数字（答题卡分组标题 Ⅰ 口语交际 … Ⅶ 写作） */
export const SECTION_ROMAN: ReadonlyArray<string> = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'];

/** 批量重做的单次上限（避免一次抽太多题） */
export const WRONG_REDO_BATCH_LIMIT = 20;
