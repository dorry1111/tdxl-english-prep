/**
 * 统计聚合仓库（到期预测 / 掌握数 / 按词库已学数）。
 *
 * 为什么要单独一个仓库：
 * - 这些查询的共同点是「只数条数、不取内容」，必须走索引 + `count()`，
 *   绝不能 `toArray()` 全量拉取（wordStates 上万条时全量拉会把内存打满）；
 * - wordStates 已有 `dueAt`、`level`、`bookId` 三个单列索引，全部查询都能命中索引。
 *
 * 只做读，不写，因此不标脏、不产生同步副作用。
 */
import { db } from '@/db';

/** 未被软删除、且已进入调度（firstLearnedAt 非空）的学习状态才算数 */
function isCountable(state: { deletedAt: number | null; firstLearnedAt: number | null }): boolean {
  return state.deletedAt === null && state.firstLearnedAt !== null;
}

/**
 * 某个时间窗内到期的词条数（左闭右开 `[fromTs, toTs)`）。
 * 复习压力预测与「未来 7 天柱状图」都用它，一次一个索引区间查询。
 */
export async function countDueBetween(fromTs: number, toTs: number): Promise<number> {
  return db.wordStates
    .where('dueAt')
    .between(fromTs, toTs, true, false)
    .filter(isCountable)
    .count();
}

/** 到某个时刻为止已到期的词条数（含积压），首页「待复习」口径 */
export async function countDueUpTo(toTs: number): Promise<number> {
  return db.wordStates.where('dueAt').belowOrEqual(toTs).filter(isCountable).count();
}

/** 累计掌握词数（熟练度 ≥ 阈值，阈值取 MASTER_L） */
export async function countMastered(threshold: number): Promise<number> {
  return db.wordStates.where('level').aboveOrEqual(threshold).filter(isCountable).count();
}

/** 全部已开始学习的词条数（跨词库） */
export async function countLearnedAll(): Promise<number> {
  return db.wordStates.filter(isCountable).count();
}

/** 某个词库内「已开始学习」的词条数（走 bookId 索引） */
export async function countLearnedByBook(bookId: string): Promise<number> {
  return db.wordStates.where('bookId').equals(bookId).filter(isCountable).count();
}

/**
 * 某个词库内「当前待复习」的词条数。
 * dueAt = 0 表示未进入调度（新词首答前的初始状态），不计入待复习。
 */
export async function countDueByBook(bookId: string, nowTs: number): Promise<number> {
  return db.wordStates
    .where('bookId')
    .equals(bookId)
    .filter((state) => isCountable(state) && state.dueAt > 0 && state.dueAt <= nowTs)
    .count();
}
