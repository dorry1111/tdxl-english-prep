/**
 * 同步合并器（纯函数，ARCHITECTURE 4.2 冲突规则 C1~C6）。
 *
 * 设计要点：
 * - 记录级 LWW（后写优先），不做字段级合并；
 * - `updatedAt` 相同时取本地，避免合并结果在双端之间抖动（C3）；
 * - 墓碑（deletedAt 非 null）参与比较且不被旧数据复活（C4）：
 *   胜出方是墓碑就保留墓碑，胜出方是活记录才允许「复活」
 *   ——那是另一端在删除之后又真实地重建了记录，属于合法行为；
 * - 追加型实体（ReviewLog）按 id 取并集去重（C5）；
 * - Settings 整条 LWW，但 deviceId / lastSyncAt / lastExportAt 永不被对端覆盖（C6）。
 */
import type { Settings, Syncable, WrongItem } from '@/types';

/** 合并结果：merged 是合并后的完整集合；toApply 是需要写回本地库的记录 */
export interface MergeResult<T> {
  merged: T[];
  toApply: T[];
  /** 发生 LWW 冲突并被自动解决的次数（双端同主键且 updatedAt 不同） */
  conflicts: number;
}

/** 单条比较：本地 updatedAt >= 远端 updatedAt 时本地胜出（C2/C3） */
export function pickWinner<T extends Syncable>(local: T, remote: T): T {
  return local.updatedAt >= remote.updatedAt ? local : remote;
}

/**
 * 记录级 LWW 合并。
 *
 * @param local 本地记录（作为合并结果的基底，保持原有顺序）
 * @param remote 远端记录（可能来自多台设备，同主键时应已先合并）
 * @param keyOf 主键提取函数（wordStates 用 stateKey，其余用 id/studyDay）
 */
export function mergeRecords<T extends Syncable>(
  local: readonly T[],
  remote: readonly T[],
  keyOf: (item: T) => string,
): MergeResult<T> {
  const localByKey = new Map<string, T>();
  for (const item of local) {
    localByKey.set(keyOf(item), item);
  }

  const merged: T[] = [...local];
  const indexOf = new Map<string, number>();
  merged.forEach((item, index) => {
    indexOf.set(keyOf(item), index);
  });

  const toApply: T[] = [];
  let conflicts = 0;

  for (const remoteItem of remote) {
    const key = keyOf(remoteItem);
    const localIndex = indexOf.get(key);
    // 远端独有：直接并入（可能是新记录，也可能是远端墓碑先于本地见过这条）
    if (localIndex === undefined) {
      indexOf.set(key, merged.length);
      merged.push(remoteItem);
      toApply.push(remoteItem);
      continue;
    }
    const localItem = merged[localIndex];
    if (localItem === undefined) {
      continue; // 理论不可达（indexOf 与 merged 同步维护），防御性跳过
    }
    if (remoteItem.updatedAt > localItem.updatedAt) {
      // 远端胜出：无论胜出方是活记录还是墓碑，都按 updatedAt 说话（C4）
      merged[localIndex] = remoteItem;
      toApply.push(remoteItem);
      conflicts += 1;
    } else if (remoteItem.updatedAt < localItem.updatedAt) {
      // 本地胜出：同样是一次 LWW 冲突解决（C2）
      conflicts += 1;
    }
    // updatedAt 相同 → 本地胜出（C3），不计数
  }

  return { merged, toApply, conflicts };
}

/** 以 `id` 为主键的 LWW 合并（sessions / studyDays / books / words / notebook） */
export function lwwById<T extends Syncable & { id: string }>(
  local: readonly T[],
  remote: readonly T[],
): MergeResult<T> {
  return mergeRecords(local, remote, (item) => item.id);
}

/**
 * 追加型实体合并（ReviewLog，C5）：按 id 取并集去重。
 * 同一 id 双端内容理论上完全一致，重复时保留先出现的一侧，不产生冲突计数。
 */
export function mergeAppendOnly<T extends { id: string }>(
  local: readonly T[],
  remote: readonly T[],
): MergeResult<T> {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of local) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }
  const toApply: T[] = [];
  for (const item of remote) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
      toApply.push(item);
    }
  }
  return { merged, toApply, conflicts: 0 };
}

export interface SettingsMergeResult {
  merged: Settings;
  /** 本地库是否需要写回（远端胜出时为 true） */
  changed: boolean;
}

/**
 * 错题本合并（真题域，v1.8.0）：在 LWW 之上叠加「宁多勿删」规则。
 *
 * - 同 id 且双侧生存状态一致（都在册 / 都是墓碑）：按 updatedAt LWW，相同时间本地胜；
 * - 「一侧墓碑一侧在册」：**一律保留在册方**（无视 updatedAt）——
 *   错题删除可能来自误操作或旧端数据损毁，多留一条错题的代价远低于
 *   误删一条真实错题，因此墓碑永远不能压过在册记录；
 * - 远端独有记录（含墓碑）直接并入，与 mergeRecords 行为一致。
 */
export function mergeWrongItems(
  local: readonly WrongItem[],
  remote: readonly WrongItem[],
): MergeResult<WrongItem> {
  const isAlive = (item: WrongItem): boolean => item.deletedAt === null;

  const merged: WrongItem[] = [...local];
  const indexOf = new Map<string, number>();
  merged.forEach((item, index) => {
    indexOf.set(item.id, index);
  });

  const toApply: WrongItem[] = [];
  let conflicts = 0;

  for (const remoteItem of remote) {
    const localIndex = indexOf.get(remoteItem.id);
    // 远端独有：直接并入（含远端墓碑，与其他实体行为一致）
    if (localIndex === undefined) {
      indexOf.set(remoteItem.id, merged.length);
      merged.push(remoteItem);
      toApply.push(remoteItem);
      continue;
    }
    const localItem = merged[localIndex];
    if (localItem === undefined) {
      continue; // 理论不可达（indexOf 与 merged 同步维护），防御性跳过
    }
    let winner: WrongItem;
    if (isAlive(localItem) !== isAlive(remoteItem)) {
      // 生存状态分歧：在册方无条件胜出（宁多勿删），计入一次冲突
      winner = isAlive(localItem) ? localItem : remoteItem;
      conflicts += 1;
    } else {
      winner = pickWinner(localItem, remoteItem);
      if (remoteItem.updatedAt !== localItem.updatedAt) {
        conflicts += 1;
      }
    }
    if (winner !== localItem) {
      merged[localIndex] = winner;
      toApply.push(winner);
    }
  }

  return { merged, toApply, conflicts };
}

/**
 * Settings 合并（C6）：整条后写优先，但本机字段永不覆盖。
 *
 * - deviceId：只读展示，永不被对端覆盖（PRD 9.2 C6）；
 * - lastSyncAt / lastExportAt：本机运维字段，不随远端回退。
 */
export function mergeSettings(local: Settings, remote: Settings | null): SettingsMergeResult {
  if (remote === null || remote.id !== 'global') {
    return { merged: local, changed: false };
  }
  if (remote.updatedAt <= local.updatedAt) {
    return { merged: local, changed: false };
  }
  const merged: Settings = {
    ...remote,
    id: 'global',
    deviceId: local.deviceId,
    lastSyncAt: local.lastSyncAt,
    lastExportAt: local.lastExportAt,
  };
  return { merged, changed: true };
}
