/**
 * 切题识别规则总表（T12，ARCHITECTURE 4.3 / PRD 8.2）。
 *
 * 设计约束（ARCHITECTURE 4.3）：所有规则以「数据表」形式声明，
 * 不写 if/else 长链；用户录入真实真题发现新写法时只改表，不改逻辑。
 */
import type { SectionType } from '@/types';

/* ------------------------------------------------------------------ */
/* 区段标题规则                                                        */
/* ------------------------------------------------------------------ */

/** 区段标题规则（PRD 8.2 区段标题识别表） */
export interface SectionTitleRule {
  type: SectionType;
  /** 区段中文名（报告/校对页展示用） */
  name: string;
  /** 中文关键词：出现在长度 ≤ 60 的短行中即命中 */
  zh: RegExp[];
  /** 英文关键词：必须出现在行首附近（允许 `Part N` 前缀），行长 ≤ 80 */
  en: RegExp[];
  /** 裸 Part 序号：仅当该行未命中任何 zh/en 关键词时兜底 */
  barePart: RegExp;
}

/** 罗马数字 Ⅰ-Ⅶ 与阿拉伯数字 1-7 的 Part 前缀（共享构造） */
function partRe(n: string): RegExp {
  return new RegExp(`^part\\s*[${n}]\\b`, 'i');
}

export const SECTION_TITLE_RULES: readonly SectionTitleRule[] = [
  {
    type: 'dialogue',
    name: '口语交际',
    zh: [/口语交际/, /口语/],
    en: [/dialogue\s*communication/i, /oral\s*communication/i],
    barePart: partRe('Ⅰ1'),
  },
  {
    type: 'vocabulary',
    name: '词汇',
    zh: [/词汇/],
    en: [/vocabulary/i],
    barePart: partRe('Ⅱ2'),
  },
  {
    type: 'reading',
    name: '阅读理解',
    zh: [/阅读理解/],
    en: [/reading\s*comprehension/i],
    barePart: partRe('Ⅲ3'),
  },
  {
    type: 'cloze',
    name: '完形填空',
    zh: [/完形填空/],
    en: [/cloze/i],
    barePart: partRe('Ⅳ4'),
  },
  {
    type: 'short-completion',
    name: '短文完成',
    zh: [/短文完成/],
    en: [/text\s*completion/i, /blank\s*filling/i, /short\s*answer/i],
    barePart: partRe('Ⅴ5'),
  },
  {
    type: 'translation',
    name: '英译汉',
    zh: [/英译汉/, /翻译/],
    en: [/translation/i],
    barePart: partRe('Ⅵ6'),
  },
  {
    type: 'writing',
    name: '写作',
    zh: [/写作/],
    en: [/writing/i, /composition/i],
    barePart: partRe('Ⅶ7'),
  },
];

/**
 * 判定一行是否为区段标题行。
 * 匹配顺序：zh/en 关键词（更具体）优先，裸 Part 序号兜底，
 * 这样「Part I Translation」不会被误判成口语交际。
 */
export function matchSectionTitle(line: string): SectionType | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;
  // 第一轮：中文关键词（短行）
  if (trimmed.length <= 60) {
    for (const rule of SECTION_TITLE_RULES) {
      if (rule.zh.some((re) => re.test(trimmed))) return rule.type;
    }
  }
  // 第二轮：英文关键词（允许 Part N 前缀，行首附近）
  for (const rule of SECTION_TITLE_RULES) {
    if (rule.en.some((re) => re.test(trimmed))) return rule.type;
  }
  // 第三轮：裸 Part 序号兜底
  for (const rule of SECTION_TITLE_RULES) {
    if (rule.barePart.test(trimmed)) return rule.type;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 行级规则（PRD 8.2 行级识别规则表）                                    */
/* ------------------------------------------------------------------ */

/** 行级规则条目 */
export interface LineRule {
  /** 规则名（调试与报告用） */
  name: string;
  /** 命中后的行类型 */
  kind:
    | 'blank'
    | 'answer'
    | 'explanation'
    | 'score'
    | 'optionGroup'
    | 'option'
    | 'questionNo'
    | 'passageHeading';
  /** 匹配正则（对单行做 test / exec） */
  re: RegExp;
}

/**
 * 行级规则表，顺序即优先级：
 * 空行 → 答案 → 解析 → 分值 → 选项组（一行多个选项）→ 单选项 → 题号 → 文章标题 → 其他。
 */
export const LINE_RULES: readonly LineRule[] = [
  { name: '空行', kind: 'blank', re: /^\s*$/ },
  // 【答案】B / 答案：B / Answer: B（PRD 8.2 答案行）
  { name: '答案行', kind: 'answer', re: /^\s*(?:【\s*答案\s*】|答案|answer)\s*[:：]?\s*(.+)$/i },
  // 【解析】xxx / 解析：xxx / Explanation: xxx
  { name: '解析行', kind: 'explanation', re: /^\s*(?:【\s*解析\s*】|解析|explanation)\s*[:：]?\s*(.*)$/i },
  // （2 分） / (0.5分)
  { name: '分值行', kind: 'score', re: /^\s*[（(]\s*(\d+(?:\.\d+)?)\s*分\s*[)）]/ },
  // 一行多个选项：A. xx B. xx C. xx（至少出现 B 项标记）
  {
    name: '选项组行',
    kind: 'optionGroup',
    re: /^\s*A\s*[.、．)）]\s*.+\s+B\s*[.、．)）]\s+.+$/,
  },
  // 单选项行：A. / A、/ A) / a.（PRD 8.2 选项行，四种写法）
  { name: '选项行', kind: 'option', re: /^\s*([A-Da-d])\s*[.、．)）]\s*(.+)$/ },
  // 题号行：11. / 11、/ 11）(PRD 8.2 题号行)
  { name: '题号行', kind: 'questionNo', re: /^\s*(\d{1,3})\s*[.、．)）]\s*(.*)$/ },
  // 文章标题行：Passage One / Text 3
  { name: '文章标题行', kind: 'passageHeading', re: /^\s*(?:Passage|Text)\s+([A-Za-z]+|\d+)\s*$/i },
];

/* ------------------------------------------------------------------ */
/* 官方试卷结构（3.4.1，用于校验基准）                                   */
/* ------------------------------------------------------------------ */

/** 官方区段规格 */
export interface OfficialSectionSpec {
  type: SectionType;
  questionCount: number;
  score: number;
}

/** 六版大纲官方分值结构（3.4.1 唯一权威口径） */
export const OFFICIAL_PAPER_STRUCTURE: readonly OfficialSectionSpec[] = [
  { type: 'dialogue', questionCount: 10, score: 10 },
  { type: 'vocabulary', questionCount: 10, score: 10 },
  { type: 'reading', questionCount: 25, score: 25 },
  { type: 'cloze', questionCount: 10, score: 10 },
  { type: 'short-completion', questionCount: 20, score: 20 },
  { type: 'translation', questionCount: 1, score: 10 },
  { type: 'writing', questionCount: 1, score: 15 },
];

/** 官方总题位：75 客观 + 2 主观 */
export const OFFICIAL_TOTAL_QUESTIONS = 77;
/** 官方总分 */
export const OFFICIAL_TOTAL_SCORE = 100;

/** 按官方结构推导某题型是否客观题（不依赖 constants/exam，保持本目录零运行时外部依赖） */
export function isObjectiveType(type: SectionType): boolean {
  const spec = SECTION_TITLE_RULES.find((r) => r.type === type);
  return spec ? spec.type !== 'translation' && spec.type !== 'writing' : true;
}

/** 题型中文对照（报告用） */
export function sectionName(type: SectionType): string {
  return SECTION_TITLE_RULES.find((r) => r.type === type)?.name ?? type;
}

/** 官方区段顺序（1 起） */
export function officialOrder(type: SectionType): number {
  const idx = OFFICIAL_PAPER_STRUCTURE.findIndex((s) => s.type === type);
  return idx + 1;
}
