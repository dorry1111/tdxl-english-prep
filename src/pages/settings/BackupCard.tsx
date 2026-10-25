/**
 * 数据备份卡片：全库导出 / 导入。
 *
 * 用途：
 * 1. 旧 PWA → 桌面版的一次性迁移（旧端导出、新端导入）；
 * 2. 日常备份（快照语义：导入即覆盖还原，二次确认防误触）；
 * 3. secrets 表含 WebDAV 密码，导出前提示保管好文件。
 */
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { desktopApi, IS_DESKTOP } from '@/lib/desktop';
import { exportAll, importAll } from '@/lib/backup';
import { useUiStore } from '@/store/uiStore';

export function BackupCard() {
  const showSuccess = useUiStore((state) => state.toast.success);
  const showError = useUiStore((state) => state.toast.error);

  const [exporting, setExporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ name: string; content: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const webFileRef = useRef<HTMLInputElement>(null);

  const handleExport = async (): Promise<void> => {
    setExporting(true);
    try {
      const result = await exportAll();
      showSuccess(
        result.savedTo ? `已导出 ${result.totalRows} 条 → ${result.savedTo}` : `已导出 ${result.totalRows} 条，浏览器开始下载。`,
      );
    } catch (error) {
      showError(error instanceof Error ? error.message : '导出失败。');
    } finally {
      setExporting(false);
    }
  };

  const handlePick = async (): Promise<void> => {
    const api = desktopApi();
    if (api) {
      const picked = await api.pickImportFile();
      if (picked) {
        setPendingImport(picked);
      }
      return;
    }
    webFileRef.current?.click();
  };

  const handleWebFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    void file.text().then((content) => setPendingImport({ name: file.name, content }));
    event.target.value = '';
  };

  const confirmImport = async (): Promise<void> => {
    if (!pendingImport) {
      return;
    }
    setImporting(true);
    try {
      const summary = await importAll(pendingImport.content);
      showSuccess(`已导入 ${summary.tables} 张表 / ${summary.rows} 条，即将刷新…`);
      setPendingImport(null);
      // 快照还原后内存里的 Zustand/Dexie 缓存已过期，整页刷新最稳
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      showError(error instanceof Error ? error.message : '导入失败。');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card title="数据备份">
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Button onClick={() => void handleExport()} disabled={exporting} block>
            {exporting ? '导出中…' : '导出全部数据'}
          </Button>
          <Button variant="secondary" onClick={() => void handlePick()} disabled={importing} block>
            导入数据
          </Button>
        </div>
        {IS_DESKTOP ? (
          <Button variant="ghost" onClick={() => void desktopApi()?.openDataDir()}>
            打开数据目录（IndexedDB 存放位置）
          </Button>
        ) : null}
        <p className="text-xs text-text-3">
          导出文件包含全部学习记录、真题与笔记，可作为跨设备迁移或快照备份；文件含 WebDAV
          凭据，请妥善保管。导入会<b>覆盖当前全部数据</b>，操作前请先导出一份。
        </p>
        {!IS_DESKTOP ? <input ref={webFileRef} type="file" accept=".json,application/json" hidden onChange={handleWebFile} /> : null}
      </div>

      <Dialog
        open={pendingImport !== null}
        title="确认导入"
        description={`将从「${pendingImport?.name ?? ''}」恢复数据，当前库中的全部内容会被覆盖。`}
        onClose={() => setPendingImport(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingImport(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={() => void confirmImport()} disabled={importing}>
              {importing ? '导入中…' : '覆盖导入'}
            </Button>
          </>
        }
      />
    </Card>
  );
}
