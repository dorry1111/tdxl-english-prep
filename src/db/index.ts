/**
 * Dexie 实例与同步脏标记（全项目唯一入口）。
 *
 * 分层约束（ARCHITECTURE 7.2）：只有 `db/repos/*` 可以 import `db`，
 * 组件与页面一律通过仓库访问数据。
 */
import Dexie from 'dexie';

import { AppError, toAppError } from '@/lib/errors';
import { traceAsync } from '@/lib/perf';
import { now } from '@/lib/time';
import type { SyncMeta } from '@/types';

import { TdxlDB } from './schema';

/** 全项目唯一的数据库实例 */
export const db = new TdxlDB();

/**
 * 打开数据库。
 *
 * iOS 无痕模式下 IndexedDB 可能「打开成功但写入失败」，因此光 open 不够，
 * 真正的可用性判断由 `runDbSelfTest()` 完成（ARCHITECTURE 8.3）。
 *
 * 耗时用 `traceAsync` 打点：冷启动（重启电脑后）首次开库要读盘，是
 * 「第一次点击慢」的嫌疑之一，带 `?perf=1` 打开即可看到真实数字。
 */
export async function openDb(): Promise<void> {
  if (db.isOpen()) {
    return;
  }
  try {
    await traceAsync('db:open', async () => {
      await db.open();
    });
  } catch (error) {
    throw new AppError('DB_OPEN_FAILED', toAppError(error));
  }
}

/** 关闭数据库（备份导入前、测试清理时使用） */
export async function closeDb(): Promise<void> {
  db.close();
}

/** 读取单条同步元信息 */
export async function getSyncMeta(entity: string): Promise<SyncMeta | undefined> {
  return db.syncMeta.get(entity);
}

/** 读取全部同步元信息（同步页展示待上传数用） */
export async function listSyncMeta(): Promise<SyncMeta[]> {
  return db.syncMeta.toArray();
}

/**
 * 把一个远端实体文件标记为「待上传」。
 *
 * 必须在写操作所在的事务内调用（同步时依赖同一个事务快照），
 * 因此这里不做二次事务，只做一次 put。
 *
 * @param entity 远端文件名，如 'wordstate-3.json'
 * @param deltaCount 本次变更的主键条数（同一主键多次变更会重复计数，同步时按主键去重）
 */
export async function markDirty(entity: string, deltaCount = 1): Promise<void> {
  const stamp = now();
  const existing = await db.syncMeta.get(entity);
  const next: SyncMeta = {
    entity,
    dirtyAt: stamp,
    lastPulledAt: existing?.lastPulledAt ?? null,
    lastEtag: existing?.lastEtag ?? null,
    pendingCount: Math.max(0, (existing?.pendingCount ?? 0) + deltaCount),
  };
  await db.syncMeta.put(next);
}

/** 上传成功后清除脏标记（T17 使用） */
export async function clearDirty(entity: string, etag: string | null): Promise<void> {
  const existing = await db.syncMeta.get(entity);
  await db.syncMeta.put({
    entity,
    dirtyAt: null,
    lastPulledAt: existing?.lastPulledAt ?? null,
    lastEtag: etag,
    pendingCount: 0,
  });
}

/**
 * 把 Dexie 异常翻译成 AppError（ARCHITECTURE 7.4：仓库层负责这一转换）。
 * 页面只要 catch 一次就能拿到可直接展示的中文文案。
 */
export function toDbError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof Dexie.QuotaExceededError) {
    return new AppError('DB_QUOTA_EXCEEDED', error);
  }
  if (error instanceof Dexie.AbortError) {
    return new AppError('DB_WRITE_FAILED', error);
  }
  if (error instanceof Dexie.DatabaseClosedError) {
    return new AppError('DB_UNAVAILABLE', error);
  }
  return toAppError(error, 'DB_WRITE_FAILED');
}
