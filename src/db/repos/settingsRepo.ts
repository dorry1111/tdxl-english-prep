/**
 * 设置与密钥仓库。
 *
 * 两条硬约束（ARCHITECTURE 3.6 / 4.2 C7）：
 * - Settings 是单条记录，主键固定 'global'；
 * - WebDAV 密码存在独立的 `secrets` 表，**不参与同步、不进入导出、不打印日志**。
 */
import { REMOTE_FILES } from '@/constants';
import { db, markDirty, toDbError } from '@/db';
import { now } from '@/lib/time';
import type { SecretRecord, Settings } from '@/types';

const ENTITY = REMOTE_FILES.settings;

/** 取全局设置 */
export async function getSettings(): Promise<Settings | undefined> {
  return db.settings.get('global');
}

/** 读取设置，不存在时写入给定的默认值（seed 与 settingsStore 启动时调用） */
export async function ensureSettings(fallback: Settings): Promise<Settings> {
  const existing = await getSettings();
  if (existing) {
    return existing;
  }
  try {
    await db.transaction('rw', db.settings, db.syncMeta, async () => {
      await db.settings.put(fallback);
      await markDirty(ENTITY, 1);
    });
    return fallback;
  } catch (error) {
    throw toDbError(error);
  }
}

/** 局部更新设置（写库成功后再返回新值，不做乐观更新） */
export async function patchSettings(partial: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
  try {
    return await db.transaction('rw', db.settings, db.syncMeta, async () => {
      const existing = await db.settings.get('global');
      if (!existing) {
        throw new Error('settings 尚未初始化');
      }
      const next: Settings = { ...existing, ...partial, id: 'global', updatedAt: now() };
      await db.settings.put(next);
      await markDirty(ENTITY, 1);
      return next;
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/**
 * 本机默认值写入（seed 一次性迁移专用，v1.10.1）：
 * 落库但**不顶 updatedAt、不标脏**——迁移写入的是「本机默认口径」而非用户意图，
 * 若顶时间戳会让本机设置在 settings.json 的整条 LWW 中永久胜出，
 * 远端用户在其它设备改的真实配置（如每日学习量）永远无法同步进来（LWW 死锁）。
 */
export async function applyLocalDefaults(partial: Partial<Omit<Settings, 'id'>>): Promise<void> {
  try {
    await db.transaction('rw', db.settings, async () => {
      const existing = await db.settings.get('global');
      if (!existing) {
        return;
      }
      await db.settings.put({ ...existing, ...partial, id: 'global' });
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/**
 * 读取 WebDAV 应用密码。
 * 只返回给需要发起请求的同步模块，任何地方都不得把它写进日志或导出文件。
 */
export async function getSecret(): Promise<string | null> {
  const record = await db.secrets.get('webdav-pass');
  return record?.value ?? null;
}

/** 写入/更新 WebDAV 应用密码（本地表，不标记脏） */
export async function setSecret(value: string): Promise<void> {
  const record: SecretRecord = { id: 'webdav-pass', value, updatedAt: now() };
  try {
    await db.transaction('rw', db.secrets, async () => {
      await db.secrets.put(record);
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 清除 WebDAV 应用密码 */
export async function clearSecret(): Promise<void> {
  try {
    await db.transaction('rw', db.secrets, async () => {
      await db.secrets.delete('webdav-pass');
    });
  } catch (error) {
    throw toDbError(error);
  }
}

// ---------------------------------------------------------------------------
// 大模型 API Key（搜索弹窗 AI 释义用）
//
// 与 WebDAV 密码同一安全口径：只存本机 secrets 表、不进 Settings、不参与
// 同步与导出 —— 换设备需要各填一次，换来的是 key 永不出本机。
// ---------------------------------------------------------------------------

const LLM_KEY_ID = 'llm-key';

/** 读取大模型 API Key（null = 未配置） */
export async function getLlmKey(): Promise<string | null> {
  const record = await db.secrets.get(LLM_KEY_ID);
  return record?.value ?? null;
}

/** 写入/更新大模型 API Key（本地表，不标记脏） */
export async function setLlmKey(value: string): Promise<void> {
  const record: SecretRecord = { id: LLM_KEY_ID, value, updatedAt: now() };
  try {
    await db.transaction('rw', db.secrets, async () => {
      await db.secrets.put(record);
    });
  } catch (error) {
    throw toDbError(error);
  }
}

/** 清除大模型 API Key */
export async function clearLlmKey(): Promise<void> {
  try {
    await db.transaction('rw', db.secrets, async () => {
      await db.secrets.delete(LLM_KEY_ID);
    });
  } catch (error) {
    throw toDbError(error);
  }
}
