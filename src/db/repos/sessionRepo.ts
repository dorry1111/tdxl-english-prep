/**
 * 学习会话仓库：StudySession 累计值 + SessionSnapshot 快照。
 *
 * 远端实体：`study.json`（StudyDay[] + StudySession[]）
 * 分层约束：组件只能通过这里读写会话数据。
 */
import { REMOTE_FILES } from '@/constants';
import { db, markDirty, toDbError } from '@/db';
import { now } from '@/lib/time';
import type { SessionSnapshot, StudySession } from '@/types';

const ENTITY = REMOTE_FILES.study;

/** 新建一条会话记录 */
export async function createSession(session: StudySession): Promise<void> {
  try {
    await db.transaction('rw', db.sessions, db.syncMeta, async () => {
      await db.sessions.put(session);
      await markDirty(ENTITY, 1);
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 取会话 */
export async function getSession(id: string): Promise<StudySession | undefined> {
  return db.sessions.get(id);
}

/** 局部更新会话（累计答题数、四档分布等） */
export async function patchSession(
  id: string,
  partial: Partial<Omit<StudySession, 'id'>>,
): Promise<StudySession | undefined> {
  try {
    return await db.transaction('rw', db.sessions, db.syncMeta, async () => {
      const existing = await db.sessions.get(id);
      if (!existing) {
        return undefined;
      }
      const next: StudySession = { ...existing, ...partial, updatedAt: now() };
      await db.sessions.put(next);
      await markDirty(ENTITY, 1);
      return next;
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 结束会话：写入 endedAt 与实际用时 */
export async function finishSession(id: string, endedAt: number, durationSec: number) {
  return patchSession(id, { endedAt, durationSec });
}

/** 取某个学习日的会话列表（按开始时间升序） */
export async function listByStudyDay(studyDay: string): Promise<StudySession[]> {
  const sessions = await db.sessions.where('studyDay').equals(studyDay).toArray();
  return sessions.sort((left, right) => left.startedAt - right.startedAt);
}

/** 取最近一次会话（首页「继续背单词」判断用） */
export async function getLatestSession(): Promise<StudySession | undefined> {
  const sessions = await db.sessions.orderBy('startedAt').reverse().limit(1).toArray();
  return sessions[0];
}

/** 最近 N 条会话（统计用） */
export async function listRecent(limit = 20): Promise<StudySession[]> {
  return db.sessions.orderBy('startedAt').reverse().limit(limit).toArray();
}

/** 写入/覆盖会话快照（每次作答后覆盖，用于异常退出恢复） */
export async function putSnapshot(snapshot: SessionSnapshot): Promise<void> {
  try {
    await db.transaction('rw', db.sessionSnapshots, async () => {
      await db.sessionSnapshots.put(snapshot);
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 取最近一次快照（按 updatedAt 倒序，跨会话遗留词依赖它） */
export async function getLatestSnapshot(): Promise<SessionSnapshot | undefined> {
  const snapshots = await db.sessionSnapshots.toArray();
  return snapshots.sort((left, right) => right.updatedAt - left.updatedAt)[0];
}

/** 取某个会话的快照 */
export async function getSnapshot(sessionId: string): Promise<SessionSnapshot | undefined> {
  return db.sessionSnapshots.get(sessionId);
}

/** 删除快照（会话正常结束后清理） */
export async function clearSnapshot(sessionId: string): Promise<void> {
  try {
    await db.transaction('rw', db.sessionSnapshots, async () => {
      await db.sessionSnapshots.delete(sessionId);
    });
  } catch (error) {
    throw toDbError(error);
  }
}
