/**
 * 全库备份（导出/导入）：桌面迁移与日常备份的双用途。
 *
 * 设计：
 * - 一份 JSON 搞定全部 19 张表，恢复即「清空 + 全量写回」，不搞逐表合并
 *   （备份语义就该是快照还原；合并交给 WebDAV 同步的三向策略）；
 * - 导入必须显式确认（Dialog），因为会覆盖当前库；
 * - secrets 表包含 WebDAV 密码：导出前用 Dialog 提示文件要保管好。
 *
 * 形态适配：
 * - 桌面（Electron）：走主进程系统另存为/打开对话框；
 * - Web/PWA：Blob 下载 + <input type="file"> 读取。
 */
import { db } from '@/db/index';

import { desktopApi } from './desktop';
import { dayjs } from './dayjs';
import { now } from './time';

export const BACKUP_FORMAT = 'tdxl-english-prep-backup';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  /** 导出时刻（UTC 毫秒，全项目时间约定） */
  exportedAt: number;
  /** 每张表行数，导入前展示用 */
  counts: Record<string, number>;
  tables: Record<string, unknown[]>;
}

export interface ExportResult {
  /** 保存到的文件路径（桌面）或 null（浏览器下载） */
  savedTo: string | null;
  totalRows: number;
}

/** 导出全部表为备份对象 */
export async function buildBackup(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  // db.tables 按 schema 定义顺序，读写一次到位
  for (const table of db.tables) {
    const rows = await table.toArray();
    tables[table.name] = rows;
    counts[table.name] = rows.length;
  }
  return {
    format: BACKUP_FORMAT,
    schemaVersion: db.verno,
    exportedAt: now(),
    counts,
    tables,
  };
}

/** 导出并落盘（桌面走系统对话框；Web 触发下载） */
export async function exportAll(): Promise<ExportResult> {
  const backup = await buildBackup();
  const totalRows = Object.values(backup.counts).reduce((sum, n) => sum + n, 0);
  const contents = JSON.stringify(backup);
  const defaultName = `tdxl-backup-${dayjs(now()).format('YYYY-MM-DD')}.json`;

  const api = desktopApi();
  if (api) {
    const savedTo = await api.exportFile(defaultName, contents);
    return { savedTo, totalRows };
  }

  // Web 形态：Blob 下载
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = defaultName;
  anchor.click();
  URL.revokeObjectURL(url);
  return { savedTo: null, totalRows };
}

export interface ImportSummary {
  tables: number;
  rows: number;
}

/**
 * 从备份对象恢复（清空 + 写回，单事务）。
 * @throws Error 格式不符或 schema 版本过新
 */
export async function importAll(raw: string): Promise<ImportSummary> {
  let parsed: BackupFile;
  try {
    parsed = JSON.parse(raw) as BackupFile;
  } catch {
    throw new Error('文件不是合法的 JSON。');
  }
  if (parsed.format !== BACKUP_FORMAT) {
    throw new Error('不是本应用的备份文件（缺少格式标识）。');
  }
  if (parsed.schemaVersion > db.verno) {
    throw new Error(`备份来自更新版本（schema v${parsed.schemaVersion} > 当前 v${db.verno}），请先升级应用。`);
  }

  let rows = 0;
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      const data = parsed.tables[table.name];
      if (!Array.isArray(data)) {
        continue; // 旧备份缺表：跳过，保持当前空表
      }
      await table.clear();
      if (data.length > 0) {
        // 类型断言：备份由本应用导出，schema 校验在仓库层
        await table.bulkPut(data as never[]);
        rows += data.length;
      }
    }
  });
  return { tables: Object.keys(parsed.tables).length, rows };
}
