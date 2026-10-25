/**
 * 答卷仓库：Attempt / AttemptAnswer。
 *
 * 远端实体：Attempt → `exam-index.json`；AttemptAnswer → `exams/<paperId>.json`
 * （答题明细跟着试卷走，避免 exam-index 膨胀）。
 */
import { REMOTE_FILES } from '@/constants';
import { db, markDirty, toDbError } from '@/db';
import { now } from '@/lib/time';
import type { Attempt, AttemptAnswer } from '@/types';

const EXAM_INDEX_ENTITY = REMOTE_FILES.examIndex;

/** 新建答卷（开考时写入，submittedAt 为 null） */
export async function createAttempt(attempt: Attempt): Promise<void> {
  try {
    await db.transaction('rw', db.attempts, db.syncMeta, async () => {
      await db.attempts.put(attempt);
      await markDirty(EXAM_INDEX_ENTITY, 1);
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 取答卷 */
export async function getAttempt(id: string): Promise<Attempt | undefined> {
  return db.attempts.get(id);
}

/** 局部更新答卷（交卷时写分数与提交时间） */
export async function patchAttempt(
  id: string,
  partial: Partial<Omit<Attempt, 'id'>>,
): Promise<Attempt | undefined> {
  try {
    return await db.transaction('rw', db.attempts, db.syncMeta, async () => {
      const existing = await db.attempts.get(id);
      if (!existing) {
        return undefined;
      }
      const next: Attempt = { ...existing, ...partial, updatedAt: now() };
      await db.attempts.put(next);
      await markDirty(EXAM_INDEX_ENTITY, 1);
      return next;
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 某份试卷的历史答卷（新→旧），用于「同一试卷第二次作答仍保留历史」 */
export async function listByPaper(paperId: string): Promise<Attempt[]> {
  const attempts = await db.attempts.where('paperId').equals(paperId).toArray();
  return attempts
    .filter((attempt) => attempt.deletedAt === null)
    .sort((left, right) => right.startedAt - left.startedAt);
}

/** 最近的答卷（成绩曲线用） */
export async function listRecent(limit = 20): Promise<Attempt[]> {
  const attempts = await db.attempts.orderBy('startedAt').reverse().limit(limit).toArray();
  return attempts.filter((attempt) => attempt.deletedAt === null);
}

/**
 * 全部答卷（做题记录页用）：新→旧，含未交卷的进行中记录，过滤墓碑。
 *
 * 不分页：单用户本地题库量级（千条以内）一次读完更简单，
 * 分组与汇总在页面纯函数里做（recordsLogic.ts）。
 */
export async function listAllActive(): Promise<Attempt[]> {
  const attempts = await db.attempts.orderBy('startedAt').reverse().toArray();
  return attempts.filter((attempt) => attempt.deletedAt === null);
}

/** 软删除一条答卷（做题记录页的「删除记录」） */
export async function softDeleteAttempt(id: string): Promise<void> {
  try {
    await db.transaction('rw', db.attempts, db.syncMeta, async () => {
      const existing = await db.attempts.get(id);
      if (!existing || existing.deletedAt !== null) {
        return;
      }
      const stamp = now();
      await db.attempts.put({ ...existing, deletedAt: stamp, updatedAt: stamp });
      await markDirty(EXAM_INDEX_ENTITY, 1);
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 批量写入作答明细（答题草稿每 3s 落库一次，用 put 覆盖同主键） */
export async function putAnswers(paperId: string, answers: AttemptAnswer[]): Promise<void> {
  if (answers.length === 0) {
    return;
  }
  try {
    await db.transaction('rw', db.attemptAnswers, db.syncMeta, async () => {
      await db.attemptAnswers.bulkPut(answers);
      await markDirty(REMOTE_FILES.exam(paperId), answers.length);
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 取某次答卷的全部明细 */
export async function getAnswers(attemptId: string): Promise<AttemptAnswer[]> {
  return db.attemptAnswers.where('attemptId').equals(attemptId).toArray();
}

/**
 * 写入/覆盖单条作答明细（答题草稿每 3s 落库一次，T14 用）。
 *
 * AttemptAnswer 没有 paperId 字段，dirty 计数挂在答卷所属试卷的
 * `exams/<paperId>.json` 上，因此需要在同一事务里读一次 Attempt。
 */
export async function updateAnswer(answer: AttemptAnswer): Promise<void> {
  try {
    await db.transaction('rw', db.attempts, db.attemptAnswers, db.syncMeta, async () => {
      await db.attemptAnswers.put(answer);
      const attempt = await db.attempts.get(answer.attemptId);
      if (attempt) {
        await markDirty(REMOTE_FILES.exam(attempt.paperId), 1);
      }
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 取某次答卷中某道题的明细 */
export async function getAnswer(
  attemptId: string,
  questionId: string,
): Promise<AttemptAnswer | undefined> {
  return db.attemptAnswers.where('[attemptId+questionId]').equals([attemptId, questionId]).first();
}
