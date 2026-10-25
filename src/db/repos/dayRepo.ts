/**
 * 日汇总仓库（StudyDay）。打卡与统计的唯一口径来源（PRD 5.6）。
 *
 * 远端实体：`study.json`
 */
import { REMOTE_FILES } from '@/constants';
import { db, markDirty, toDbError } from '@/db';
import { now } from '@/lib/time';
import type { StudyDay } from '@/types';

const ENTITY = REMOTE_FILES.study;

/** 单个学习日需要累加的增量 */
export interface StudyDayDelta {
  newLearned?: number;
  reviewed?: number;
  answerCount?: number;
  correctCount?: number;
  durationSec?: number;
  retryAnswers?: number;
}

/** 取某天的汇总 */
export async function getDay(studyDay: string): Promise<StudyDay | undefined> {
  return db.studyDays.get(studyDay);
}

/** 构造一条空的日汇总 */
export function createEmptyDay(studyDay: string, stamp: number = now()): StudyDay {
  return {
    studyDay,
    newLearned: 0,
    reviewed: 0,
    answerCount: 0,
    correctCount: 0,
    durationSec: 0,
    retryAnswers: 0,
    updatedAt: stamp,
    deletedAt: null,
  };
}

/** 确保某天的汇总记录存在（不存在则写入全零记录） */
export async function ensureDay(studyDay: string, stamp: number = now()): Promise<StudyDay> {
  const existing = await db.studyDays.get(studyDay);
  if (existing) {
    return existing;
  }
  const created = createEmptyDay(studyDay, stamp);
  await putDay(created);
  return created;
}

/** 整体写入一条日汇总 */
export async function putDay(day: StudyDay): Promise<void> {
  try {
    await db.transaction('rw', db.studyDays, db.syncMeta, async () => {
      await db.studyDays.put(day);
      await markDirty(ENTITY, 1);
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/**
 * 按增量更新某天的汇总。
 *
 * 为什么用增量而不是「读全量覆盖」：会话中每答一题都要更新，
 * 增量写法让并发（多标签页）下的丢更新概率更低，也不会误清其它指标。
 */
export async function incrementDay(studyDay: string, delta: StudyDayDelta): Promise<StudyDay> {
  try {
    return await db.transaction('rw', db.studyDays, db.syncMeta, async () => {
      const existing = (await db.studyDays.get(studyDay)) ?? createEmptyDay(studyDay);
      const next: StudyDay = {
        ...existing,
        newLearned: existing.newLearned + (delta.newLearned ?? 0),
        reviewed: existing.reviewed + (delta.reviewed ?? 0),
        answerCount: existing.answerCount + (delta.answerCount ?? 0),
        correctCount: existing.correctCount + (delta.correctCount ?? 0),
        durationSec: existing.durationSec + (delta.durationSec ?? 0),
        retryAnswers: existing.retryAnswers + (delta.retryAnswers ?? 0),
        updatedAt: now(),
      };
      await db.studyDays.put(next);
      await markDirty(ENTITY, 1);
      return next;
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 取全部日汇总（按日期升序，统计与连续打卡用） */
export async function listAll(): Promise<StudyDay[]> {
  const days = await db.studyDays.toArray();
  return days
    .filter((day) => day.deletedAt === null)
    .sort((left, right) => left.studyDay.localeCompare(right.studyDay));
}

/** 最近 N 天（按日期倒序） */
export async function listRecent(limit = 30): Promise<StudyDay[]> {
  const days = await listAll();
  return days.slice(Math.max(0, days.length - limit)).reverse();
}

/** 有答题记录的学习日（连续打卡计算用） */
export async function listAnswerDays(): Promise<string[]> {
  const days = await listAll();
  return days.filter((day) => day.answerCount > 0).map((day) => day.studyDay);
}

/** 全部学习日时长求和（统计页「总学习时间」用；日汇总量小，直接内存求和） */
export async function sumDuration(): Promise<number> {
  const days = await listAll();
  return days.reduce((total, day) => total + day.durationSec, 0);
}
