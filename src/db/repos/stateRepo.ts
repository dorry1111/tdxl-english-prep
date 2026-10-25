/**
 * 学习状态仓库（WordState）。
 *
 * 主键是 `stateKey = fnv1a(norm)` 的十进制字符串（ARCHITECTURE 3.2.1），
 * 因此「取某个词的学习状态」= 先算 norm → 再算 stateKey → 主键直查，无索引回表。
 *
 * 同步分片：`fnv1a(stateKey) % 8` → `wordstate-<n>.json`（ARCHITECTURE 4.2）。
 */
import { DAY_START_HOUR, REMOTE_FILES, WORDSTATE_SHARDS } from '@/constants';
import { db, markDirty, toDbError } from '@/db';
import { fnv1a } from '@/lib/hash';
import { now } from '@/lib/time';
import { studyDayOf } from '@/lib/srs/studyDay';
import type { WordState } from '@/types';

/** 计算 stateKey 所属的同步分片号（0 ~ 7） */
export function wordStateShardOf(stateKey: string): number {
  return fnv1a(stateKey) % WORDSTATE_SHARDS;
}

/** 计算 stateKey 对应的远端实体文件名 */
export function wordStateEntityOf(stateKey: string): string {
  return REMOTE_FILES.wordState(wordStateShardOf(stateKey));
}

/** 按 stateKey 取学习状态 */
export async function getState(stateKey: string): Promise<WordState | undefined> {
  return db.wordStates.get(stateKey);
}

/** 批量按 stateKey 取学习状态 */
export async function getStates(stateKeys: string[]): Promise<WordState[]> {
  if (stateKeys.length === 0) {
    return [];
  }
  return db.wordStates.bulkGet(stateKeys).then((rows) =>
    rows.filter((row): row is WordState => row !== undefined),
  );
}

/**
 * 批量写入/更新学习状态。
 * 一次事务写完整批，并按分片分别累加待上传条数。
 */
export async function bulkUpsert(states: WordState[]): Promise<void> {
  if (states.length === 0) {
    return;
  }
  try {
    await db.transaction('rw', db.wordStates, db.syncMeta, async () => {
      await db.wordStates.bulkPut(states);
      const countPerEntity = new Map<string, number>();
      for (const state of states) {
        const entity = wordStateEntityOf(state.stateKey);
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

/**
 * 取到期复习词。
 *
 * 依赖 `dueAt` 单列索引，返回结果天然按 `dueAt` 升序（T05 验收项）。
 * 只取「已开始学习」的词（firstLearnedAt 非空），避免新词被当成复习词。
 */
export async function getDueWords(nowTs: number, limit: number): Promise<WordState[]> {
  const rows = await db.wordStates.where('dueAt').belowOrEqual(nowTs).limit(limit).toArray();
  return rows.filter((row) => row.deletedAt === null && row.firstLearnedAt !== null);
}

/** 今日到期量（首页「待复习」指标） */
export async function countDue(nowTs: number): Promise<number> {
  const rows = await db.wordStates.where('dueAt').belowOrEqual(nowTs).toArray();
  return rows.filter((row) => row.deletedAt === null && row.firstLearnedAt !== null).length;
}

/** 取某个词条 ID 关联的所有学习状态（理论上 1 条，多词库时按 norm 去重后仍是 1 条） */
export async function listByWordId(wordId: string): Promise<WordState[]> {
  return db.wordStates.where('wordId').equals(wordId).toArray();
}

/** 全部学习状态（统计用；不要用 useLiveQuery 订阅整表，见 ARCHITECTURE 7.8） */
export async function listAll(): Promise<WordState[]> {
  return db.wordStates.toArray();
}

/**
 * 收藏 / 取消收藏（写 WordState.isStarred，事务内标脏对应分片）。
 *
 * 词尚未开始学习时状态不存在：这里创建一条「未进入调度」的初始状态
 * （L=0、dueAt=0，口径与 sessionStore.initialWordState 一致），只补上收藏标记。
 *
 * @param stateKey 学习身份键
 * @param wordId 词条 ID（`${bookId}:${norm}`）
 */
export async function setStarred(stateKey: string, wordId: string, starred: boolean): Promise<void> {
  try {
    await db.transaction('rw', db.wordStates, db.syncMeta, async () => {
      const stamp = now();
      const existing = await db.wordStates.get(stateKey);
      if (existing) {
        await db.wordStates.put({ ...existing, isStarred: starred, updatedAt: stamp });
      } else {
        const sepIndex = wordId.indexOf(':');
        const created: WordState = {
          stateKey,
          wordId,
          bookId: sepIndex >= 0 ? wordId.slice(0, sepIndex) : '',
          level: 0,
          dueAt: 0,
          lastRating: null,
          lastReviewAt: null,
          firstLearnedAt: null,
          reviewCount: 0,
          correctCount: 0,
          wrongCount: 0,
          lapseCount: 0,
          retryCountToday: 0,
          retryDay: studyDayOf(stamp, DAY_START_HOUR),
          unstable: false,
          isStarred: starred,
          masteredAt: null,
          updatedAt: stamp,
          deletedAt: null,
        };
        await db.wordStates.put(created);
      }
      await markDirty(wordStateEntityOf(stateKey), 1);
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 学习状态总数 */
export async function countAll(): Promise<number> {
  return db.wordStates.count();
}

/** 不稳定词（达重现上限仍答错，次日首页提示）。boolean 无法建索引，这里内存过滤。 */
export async function listUnstable(): Promise<WordState[]> {
  const rows = await db.wordStates.toArray();
  return rows.filter((state) => state.unstable && state.deletedAt === null);
}

/**
 * 把过期的「今日重现次数」清零。
 *
 * retryCountToday 只在同一个学习日内有效（WordState.retryDay 记录归属日）。
 * 会话启动时调用一次即可，写成批量事务避免逐条写。
 */
export async function resetStaleRetryCounts(studyDay: string): Promise<number> {
  try {
    return await db.transaction('rw', db.wordStates, db.syncMeta, async () => {
      const stale = (await db.wordStates.toArray()).filter(
        (state) => state.retryCountToday > 0 && state.retryDay !== studyDay,
      );
      if (stale.length === 0) {
        return 0;
      }
      const stamp = now();
      const patched = stale.map<WordState>((state) => ({
        ...state,
        retryCountToday: 0,
        retryDay: studyDay,
        updatedAt: stamp,
      }));
      await db.wordStates.bulkPut(patched);
      const countPerEntity = new Map<string, number>();
      for (const state of patched) {
        const entity = wordStateEntityOf(state.stateKey);
        countPerEntity.set(entity, (countPerEntity.get(entity) ?? 0) + 1);
      }
      for (const [entity, count] of countPerEntity) {
        await markDirty(entity, count);
      }
      return patched.length;
    });
  } catch (error) {
    throw toDbError(error);
  }
}
