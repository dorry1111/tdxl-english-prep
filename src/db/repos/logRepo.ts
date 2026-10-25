/**
 * 答题流水仓库（ReviewLog，追加型）。
 *
 * 远端实体：`reviewlog-YYYY-MM.json`，按月分片（ARCHITECTURE 4.2）。
 * 保留策略：90 天 / 5 万条，由 `prune()` 裁剪（T05 验收项）。
 */
import { REMOTE_FILES, REVIEW_LOG_KEEP_COUNT, REVIEW_LOG_KEEP_DAYS, MS_PER_DAY } from '@/constants';
import { db, markDirty, toDbError } from '@/db';
import { dayjs } from '@/lib/dayjs';
import type { ReviewLog } from '@/types';

/** 取流水所属的远端分片文件名（按答题时间的月份） */
export function reviewLogEntityOf(answeredAt: number): string {
  return REMOTE_FILES.reviewLog(dayjs(answeredAt).format('YYYY-MM'));
}

/** 追加单条流水 */
export async function append(log: ReviewLog): Promise<void> {
  await appendMany([log]);
}

/** 批量追加流水（批量写入，避免逐条事务） */
export async function appendMany(logs: ReviewLog[]): Promise<void> {
  if (logs.length === 0) {
    return;
  }
  try {
    await db.transaction('rw', db.reviewLogs, db.syncMeta, async () => {
      await db.reviewLogs.bulkAdd(logs);
      const countPerEntity = new Map<string, number>();
      for (const log of logs) {
        const entity = reviewLogEntityOf(log.answeredAt);
        countPerEntity.set(entity, (countPerEntity.get(entity) ?? 0) + 1);
      }
      for (const [entity, count] of countPerEntity) {
        await markDirty(entity, count);
      }
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 取某次会话的全部流水（按答题时间升序） */
export async function listBySession(sessionId: string): Promise<ReviewLog[]> {
  const logs = await db.reviewLogs.where('sessionId').equals(sessionId).toArray();
  return logs.sort((left, right) => left.answeredAt - right.answeredAt);
}

/** 取某个词条的流水（最近的在前） */
export async function listByWord(wordId: string, limit = 20): Promise<ReviewLog[]> {
  const logs = await db.reviewLogs.where('wordId').equals(wordId).toArray();
  return logs.sort((left, right) => right.answeredAt - left.answeredAt).slice(0, limit);
}

/** 取时间区间内的流水（统计用） */
export async function listBetween(fromTs: number, toTs: number): Promise<ReviewLog[]> {
  return db.reviewLogs.where('answeredAt').between(fromTs, toTs, true, true).toArray();
}

/** 流水总条数 */
export async function countAll(): Promise<number> {
  return db.reviewLogs.count();
}

/**
 * 裁剪流水：先删 90 天之前的，再在「仍超过 5 万条」时从最老的开始删。
 *
 * @param nowTs 当前时间戳（显式传入，便于测试）
 */
export async function prune(
  nowTs: number,
  keepDays: number = REVIEW_LOG_KEEP_DAYS,
  keepCount: number = REVIEW_LOG_KEEP_COUNT,
): Promise<{ deletedByAge: number; deletedByCount: number }> {
  try {
    return await db.transaction('rw', db.reviewLogs, db.syncMeta, async () => {
      const cutoff = nowTs - keepDays * MS_PER_DAY;
      const expiredKeys = await db.reviewLogs.where('answeredAt').below(cutoff).primaryKeys();
      if (expiredKeys.length > 0) {
        await db.reviewLogs.bulkDelete(expiredKeys);
      }

      const remaining = await db.reviewLogs.count();
      let deletedByCount = 0;
      if (remaining > keepCount) {
        const overflow = remaining - keepCount;
        const oldestKeys = await db.reviewLogs.orderBy('answeredAt').limit(overflow).primaryKeys();
        if (oldestKeys.length > 0) {
          await db.reviewLogs.bulkDelete(oldestKeys);
        }
        deletedByCount = oldestKeys.length;
      }

      if (expiredKeys.length > 0 || deletedByCount > 0) {
        await markDirty(reviewLogEntityOf(nowTs), expiredKeys.length + deletedByCount);
      }
      return { deletedByAge: expiredKeys.length, deletedByCount };
    });
  } catch (error) {
    throw toDbError(error);
  }
}
