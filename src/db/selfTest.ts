/**
 * 数据层自检：验证「开库 → 写一条 → 读回 → 删除」这条链路真的通。
 *
 * 用途：
 * 1. 开发模式下在浏览器控制台手动调用（`__tdxlDbSelfTest()`）；
 * 2. 启动时探测「无痕模式 / 存储受限」场景（ARCHITECTURE 8.3）。
 *
 * 自检写入 `sessionSnapshots` 表的一条临时记录（不参与任何统计口径），
 * 用完立即删除，不会污染业务数据。
 */
import { AppError, toAppError } from '@/lib/errors';
import { now } from '@/lib/time';
import type { SessionSnapshot } from '@/types';

import { db, openDb } from './index';

const PROBE_SESSION_ID = '__selftest__';

export interface DbSelfTestResult {
  ok: boolean;
  /** 每一步的真实结果，便于在控制台确认到底卡在哪一步 */
  steps: string[];
  /** 失败原因（开发模式可见，不展示给用户） */
  failure?: string;
}

/** 构造一条临时快照，仅用于自检 */
function buildProbeSnapshot(): SessionSnapshot {
  const stamp = now();
  return {
    sessionId: PROBE_SESSION_ID,
    studyDay: '1970-01-01',
    startedAt: stamp,
    updatedAt: stamp,
    answeredCount: 0,
    retryPool: {},
    ratingCounts: { '1': 0, '2': 0, '3': 0, '4': 0 },
    carryOverWordIds: [],
  };
}

/**
 * 执行自检。任何一步失败都返回 ok=false，不抛异常（调用方据此决定是否降级提示）。
 */
export async function runDbSelfTest(): Promise<DbSelfTestResult> {
  const steps: string[] = [];
  try {
    await openDb();
    steps.push('开库成功');

    const probe = buildProbeSnapshot();
    await db.sessionSnapshots.put(probe);
    steps.push('写入成功');

    const readBack = await db.sessionSnapshots.get(PROBE_SESSION_ID);
    if (!readBack || readBack.sessionId !== PROBE_SESSION_ID) {
      throw new AppError('DB_WRITE_FAILED', '读回内容与写入不一致');
    }
    steps.push('读回成功');

    await db.sessionSnapshots.delete(PROBE_SESSION_ID);
    steps.push('删除成功');

    const gone = await db.sessionSnapshots.get(PROBE_SESSION_ID);
    if (gone) {
      throw new AppError('DB_WRITE_FAILED', '删除后仍能读到记录');
    }
    steps.push('删除后确认已不存在');
    return { ok: true, steps };
  } catch (error) {
    const appError = toAppError(error, 'DB_OPEN_FAILED');
    steps.push(`失败：${appError.message}`);
    return { ok: false, steps, failure: String(appError.detail ?? appError.code) };
  }
}

declare global {
  interface Window {
    /** 开发模式下由 main.tsx 挂载，便于控制台自检 */
    __tdxlDbSelfTest?: () => Promise<DbSelfTestResult>;
  }
}
