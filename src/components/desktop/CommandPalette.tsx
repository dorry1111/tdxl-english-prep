/**
 * 命令面板（Ctrl+K，桌面版）。
 *
 * 简约实现：一个输入框 + 常用页面跳转列表，键盘 ↑↓ 选择、Enter 跳转、Esc 关闭。
 * 刻意不做全局搜索（那是 /search 页的事），只做「快速去哪儿」。
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';

import { Icon, type IconName } from '@/components/ui/Icon';
import { ROUTES } from '@/constants';

interface PaletteEntry {
  path: string;
  label: string;
  hint: string;
  icon: IconName;
}

/** 常用目的地（比一级导航多几个高频二级页；标签与一级导航保持同名） */
const ENTRIES: readonly PaletteEntry[] = [
  { path: ROUTES.home, label: '学习', hint: '任务与进度', icon: 'today' },
  { path: ROUTES.study, label: '背单词', hint: '进入学习会话', icon: 'today' },
  { path: ROUTES.books, label: '选词', hint: '词库与生词本', icon: 'words' },
  { path: ROUTES.stats, label: '统计', hint: '词汇与学习数据', icon: 'stats' },
  { path: ROUTES.notebook, label: '生词本', hint: '收藏的词与笔记', icon: 'words' },
  { path: ROUTES.exams, label: '真题', hint: '试卷与错题', icon: 'exams' },
  { path: ROUTES.wrongBook, label: '错题本', hint: '重做错题', icon: 'exams' },
  { path: ROUTES.statsVocab, label: '单词统计', hint: '学习数据', icon: 'today' },
  { path: ROUTES.statsExams, label: '真题成绩', hint: '成绩与分析', icon: 'exams' },
  { path: ROUTES.settingsBackup, label: '导出与导入', hint: '数据备份', icon: 'settings' },
  { path: ROUTES.settings, label: '我的', hint: '设置与同步', icon: 'settings' },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement | null {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return ENTRIES;
    }
    return ENTRIES.filter(
      (entry) => entry.label.toLowerCase().includes(q) || entry.hint.toLowerCase().includes(q),
    );
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // 等挂载后聚焦
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const go = (index: number): void => {
    const entry = filtered[index];
    if (!entry) {
      return;
    }
    onClose();
    navigate(entry.path);
  };

  return (
    <div
      className="tdxl-palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="tdxl-palette" role="dialog" aria-label="快速跳转">
        <input
          ref={inputRef}
          value={query}
          placeholder="输入页面名，↑↓ 选择，Enter 跳转"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((prev) => Math.min(prev + 1, filtered.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((prev) => Math.max(prev - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              go(active);
            }
          }}
        />
        <div className="tdxl-palette-list">
          {filtered.length === 0 ? <p className="px-3 py-6 text-center text-sm text-text-3">没有匹配的页面</p> : null}
          {filtered.map((entry, index) => (
            <button
              key={entry.path}
              type="button"
              className={`tdxl-palette-item${index === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => go(index)}
            >
              <Icon name={entry.icon} size={16} />
              <span className="font-medium">{entry.label}</span>
              <span className="text-xs text-text-3">{entry.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
