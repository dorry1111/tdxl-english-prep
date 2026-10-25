/**
 * SRS 与学习相关的全部可调常量（PRD 5.1 / ARCHITECTURE 7.7）。
 *
 * 约定：组件与算法里不得出现魔法数字，一律从这里取；用户可改的量优先从 Settings 取。
 * 本文件属于 constants 层，只允许依赖 types，因此时间单位常量也定义在这里。
 */

// ---------- 时间单位（调度计算全部用毫秒手算，不引日期库） ----------
export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

// ---------- 等级与间隔阶梯 ----------
/** 熟练度等级上限 */
export const L_MAX = 10;
/** 「已掌握」判定阈值：L ≥ 8（间隔 ≥ 30 天） */
export const MASTER_L = 8;

/**
 * 间隔阶梯 IDX[L]，共 11 档（L=0..10）。
 * 5min / 30min / 12h / 1d / 2d / 4d / 7d / 15d / 30d / 60d / 120d
 */
export const INTERVAL_LADDER: readonly number[] = [
  5 * MS_PER_MINUTE, // L=0  5 分钟
  30 * MS_PER_MINUTE, // L=1  30 分钟
  12 * MS_PER_HOUR, // L=2  12 小时
  1 * MS_PER_DAY, // L=3  1 天
  2 * MS_PER_DAY, // L=4  2 天
  4 * MS_PER_DAY, // L=5  4 天
  7 * MS_PER_DAY, // L=6  7 天
  15 * MS_PER_DAY, // L=7  15 天
  30 * MS_PER_DAY, // L=8  30 天
  60 * MS_PER_DAY, // L=9  60 天
  120 * MS_PER_DAY, // L=10 120 天
];

/** 取某等级的间隔毫秒数（越界自动收敛到 0..L_MAX，避免数组越界） */
export function intervalOfLevel(level: number): number {
  const index = Math.min(Math.max(Math.trunc(level), 0), L_MAX);
  const value = INTERVAL_LADDER[index];
  if (value !== undefined) {
    return value;
  }
  // 兜底：理论上不可达（index 已被 clamp），保证返回 number 而不是 undefined
  return MS_PER_DAY;
}

// ---------- 学习日 ----------
/** 学习日边界小时：凌晨 4 点前算前一天 */
export const DAY_START_HOUR = 4;

// ---------- 每日新词 ----------
/** 每日新词上限默认值 */
export const DEFAULT_NEW_WORD_LIMIT = 20;
/** 用户在设置里可输入的下限（PRD：1~200） */
export const NEW_WORD_LIMIT_MIN = 1;
/** 用户在设置里可输入的上限 */
export const NEW_WORD_LIMIT_MAX = 200;
/** 自动推算时的下限（PRD 5.5：clamp 到 5~200） */
export const PLAN_NEW_WORD_FLOOR = 5;

// ---------- 每日总学习量（quota 模式） ----------
/** 每日总学习量默认值（待复习 + 新学，复习优先占满） */
export const DEFAULT_DAILY_STUDY_QUOTA = 50;
/** 每日总学习量可输入下限 */
export const DAILY_STUDY_QUOTA_MIN = 10;
/** 每日总学习量可输入上限 */
export const DAILY_STUDY_QUOTA_MAX = 500;

// ---------- 当日循环重现 ----------
/** 同一词单日会话内最多重现次数 */
export const MAX_RETRY = 5;
/** 重现间隔下限（按卡位数） */
export const RETRY_GAP_MIN = 3;
/** 重现间隔上限（按卡位数） */
export const RETRY_GAP_MAX = 5;
/** 队列剩余少于此数时补位（PRD 5.4 R5） */
export const MIN_QUEUE_SIZE = 3;
/** 单次会话最多装载的到期复习词条数，超过则分批（PRD 5.4 R8） */
export const SESSION_BATCH_SIZE = 200;

// ---------- 计划推算 ----------
/** 考前只复习不学新词的天数 */
export const RESERVE_DAYS = 7;
/** 有效天数系数（容忍值班/中断） */
export const UTILIZE = 0.85;
/** 触发「新词归零」的到期复习阈值 */
export const REVIEW_LOAD_CAP = 250;

// ---------- 统计口径 ----------
/** 单次会话计入总时长的上限秒数（超过部分截断，防挂机污染） */
export const SESSION_DURATION_CAP_SEC = 30 * 60;

// ---------- 考试日期 ----------
/**
 * 同等学力申硕全国统考的考试日期 = 当年 5 月第三个星期日。
 *
 * 【实现说明】不硬编码日期字符串，也不使用 `new Date()`：
 * 用 Sakamoto 公式算星期几（纯整数运算，天然不受时区影响），
 * 这样换年份只需改 DEFAULT_EXAM_YEAR 或调用 computeExamDate(year)。
 */

/** 默认考试年份（用户可在设置里改考试日期） */
export const DEFAULT_EXAM_YEAR = 2027;

/**
 * Sakamoto 公式：返回某公历日期是星期几，0=周日，1=周一 … 6=周六。
 */
function dayOfWeekSundayFirst(year: number, month: number, day: number): number {
  const monthOffsetTable = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const y = month < 3 ? year - 1 : year;
  const offset = monthOffsetTable[month - 1] ?? 0;
  const sum =
    y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + offset + day;
  const weekDay = sum % 7;
  return ((weekDay % 7) + 7) % 7;
}

/**
 * 计算某年「5 月第三个星期日」的日期，返回 YYYY-MM-DD。
 *
 * @example computeExamDate(2027) === '2027-05-16'
 */
export function computeExamDate(year: number): string {
  const month = 5;
  const mayFirstWeekDay = dayOfWeekSundayFirst(year, month, 1);
  // 5 月 1 日到第一个星期日要跳过的天数
  const daysToFirstSunday = (7 - mayFirstWeekDay) % 7;
  const thirdSundayDay = 1 + daysToFirstSunday + 14;
  const mm = String(month).padStart(2, '0');
  const dd = String(thirdSundayDay).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** 默认考试日期（2027 年 5 月第三个星期日 = 2027-05-16） */
export const DEFAULT_EXAM_DATE = computeExamDate(DEFAULT_EXAM_YEAR);
