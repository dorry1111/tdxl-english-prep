/**
 * 数据更新模块：从 NAS WebDAV 的 `datasets/` 目录拉取词库 / 真题更新包。
 *
 * 设计：NAS 上放一份 `datasets/manifest.json`（含整体 version + 条目列表），
 * app / 桌面 / PWA 共用同一条 WebDAV 连接。检测到远端版本高于本地已应用的
 * `datasetVersion` 时，下载对应 JSON 并入库：
 * - type='exam'：走 `importExamJson`（与打包内置卷同一落库通道）；
 * - type='words'：数组直接 `db.words.bulkPut`。
 * 全部走 `nativeAwareFetch`，iOS 原生层免 CORS。新增词包 / 新卷 = 往 NAS 丢 JSON，
 * 不用重发 app。
 */
import { getSecret, getSettings, patchSettings } from '@/db/repos/settingsRepo';
import { WebdavClient } from '@/lib/sync/webdav';
import { nativeAwareFetch } from '@/lib/http';
import { importExamJson } from '@/db/seed';
import { db } from '@/db';
import type { Word } from '@/types';

export interface DatasetManifestItem {
  type: 'exam' | 'words';
  /** 入库主键：试卷用 paperId，词包用 bookId */
  id: string;
  /** datasets/ 下的相对路径，如 exams/2026.json、words/extra-pack.json */
  file: string;
  /** 该项所属的数据集版本（用于增量判断） */
  version: number;
  note?: string;
  /**
   * 仅 exam 用：是否走回忆版宽容校验。
   * 回忆版卷（如 2026）客观题允许缺答案，必须置 true，
   * 否则 importExamJson 默认严格校验会在已安装 app（未发版）上直接失败。
   */
  recalled?: boolean;
}

export interface DatasetManifest {
  version: number;
  updatedAt: number;
  items: DatasetManifestItem[];
}

export interface DatasetUpdateResult {
  checked: boolean;
  /** 实际应用的条目数 */
  applied: number;
  /** 跳过（本地已最新 / 远端缺文件 / 解析失败）的条目数 */
  skipped: number;
  error: string | null;
}

/** 由 WebDAV 根地址推导出 datasets/ 目录地址（末尾带 /） */
function datasetsBase(webdavUrl: string): string {
  const trimmed = webdavUrl.replace(/\/+$/, '');
  return `${trimmed}/datasets/`;
}

/**
 * 检查并应用 NAS 上的数据更新。无 NAS 配置 / 未启用同步时静默返回。
 * 调用方（设置页按钮 / 启动后定时）负责展示结果。
 */
export async function checkAndApplyDatasetUpdates(): Promise<DatasetUpdateResult> {
  const result: DatasetUpdateResult = { checked: false, applied: 0, skipped: 0, error: null };
  const settings = await getSettings();
  if (!settings || !settings.syncEnabled) {
    return result;
  }
  const password = await getSecret();
  if (password === null) {
    return result;
  }
  const client = new WebdavClient(
    { baseUrl: datasetsBase(settings.webdavUrl), username: settings.webdavUser, password },
    nativeAwareFetch,
  );
  try {
    const raw = await client.getText('manifest.json');
    if (raw === null) {
      // NAS 上没有 datasets/manifest.json：视为无更新源，不算错误
      return result;
    }
    const manifest = JSON.parse(raw) as DatasetManifest;
    if (typeof manifest.version !== 'number' || !Array.isArray(manifest.items)) {
      result.error = 'manifest.json 格式不正确';
      return result;
    }
    result.checked = true;
    const localVersion = settings.datasetVersion ?? 0;
    if (manifest.version <= localVersion) {
      result.skipped = manifest.items.length;
      return result;
    }
    for (const item of manifest.items) {
      if (item.version <= localVersion) {
        result.skipped += 1;
        continue;
      }
      const data = await client.getText(item.file);
      if (data === null) {
        result.skipped += 1;
        continue;
      }
      try {
        if (item.type === 'exam') {
          await importExamJson(JSON.parse(data), {
            paperId: item.id,
            ...(item.recalled ? { recalled: true } : {}),
          });
        } else if (item.type === 'words') {
          await db.words.bulkPut(JSON.parse(data) as Word[]);
        }
        result.applied += 1;
      } catch {
        result.skipped += 1;
      }
    }
    await patchSettings({ datasetVersion: manifest.version });
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}
