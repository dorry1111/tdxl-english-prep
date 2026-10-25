/**
 * 备注与收藏区（WordDetailPanel 底部功能区）。
 *
 * 功能：
 * ① 收藏按钮：写 WordState.isStarred（经 stateRepo 事务标脏，乐观更新）；
 * ② 单一「备注」框：textarea + 同行保存按钮（每词一条 kind='note'，upsert 语义，
 *    清空保存 = 删除）。历史三类结构化笔记（串记/联想/谐音）UI 已移除，
 *    加载时把仍有内容的旧三类按行合并进备注框兜底展示，保存后落为 note。
 *
 * 数据自治：组件内部按 stateKey 加载/写回 noteRepo 与 stateRepo，
 * 上层只需传入当前词条。
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import clsx from 'clsx';

import { BingDictLink } from '@/components/word/BingDictLink';
import { Button } from '@/components/ui/Button';
import { ACTIONS, ERROR_MESSAGES, NOTES } from '@/constants';
import { deleteNote, listNotesByStateKey, upsertNote } from '@/db/repos/noteRepo';
import { getState, setStarred as persistStarred } from '@/db/repos/stateRepo';
import { stateKeyOfNorm } from '@/lib/hash';
import { useUiStore } from '@/store/uiStore';
import type { Word } from '@/types';

/** 历史三类结构化笔记（UI 已移除，仅作加载兜底合并） */
const LEGACY_KINDS = ['chunk', 'assoc', 'homophone'] as const;

export interface WordNotesSectionProps {
  /** 当前词条（stateKey 由 norm 推导，跨词库共享同一份笔记） */
  word: Word;
  /** 紧凑模式（单栏一屏无滚动）：收藏与必应词典同行、textarea 收窄 */
  compact?: boolean;
}

export function WordNotesSection({ word, compact = false }: WordNotesSectionProps) {
  const showInfo = useUiStore((state) => state.toast.info);
  const showError = useUiStore((state) => state.toast.error);

  const stateKey = stateKeyOfNorm(word.norm);

  const [starred, setStarred] = useState(false);
  const [draft, setDraft] = useState('');
  /** 当前备注在库中的行 id；null = 尚未保存过（或为旧三类合并内容） */
  const [noteId, setNoteId] = useState<string | null>(null);
  /** 用户本挂载周期内点过收藏：加载回包不得覆盖乐观更新 */
  const starTouchedRef = useRef(false);

  // ---------- 加载：备注（旧三类合并兜底）+ 收藏状态 ----------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const notes = await listNotesByStateKey(stateKey);
      if (cancelled) {
        return;
      }
      const own = notes.find((note) => note.kind === 'note');
      if (own) {
        setDraft(own.content);
        setNoteId(own.id);
        return;
      }
      // 兜底：把历史三类结构化笔记按行合并显示（保存后落为 kind='note'）
      const legacy = LEGACY_KINDS.map((kind) =>
        notes.find((note) => note.kind === kind)?.content ?? '',
      )
        .filter((content) => content.length > 0)
        .join('\n');
      setDraft(legacy);
      setNoteId(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [stateKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await getState(stateKey);
      if (!cancelled && !starTouchedRef.current) {
        setStarred(state?.isStarred ?? false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stateKey]);

  // ---------- 收藏 ----------
  const handleToggleStar = useCallback(async (): Promise<void> => {
    const next = !starred;
    starTouchedRef.current = true;
    setStarred(next); // 乐观更新，失败回滚
    try {
      await persistStarred(stateKey, word.id, next);
    } catch {
      setStarred(!next);
      showError(ERROR_MESSAGES.DB_WRITE_FAILED);
    }
  }, [starred, stateKey, word.id, showError]);

  // ---------- 备注编辑 ----------
  const handleDraftChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setDraft(event.target.value);
  };

  const handleSaveNote = useCallback(async (): Promise<void> => {
    const content = draft.trim();
    try {
      if (!content) {
        // 清空保存 = 删除备注
        if (noteId) {
          await deleteNote(noteId);
          setNoteId(null);
          showInfo(NOTES.noteDeleted);
        }
        return;
      }
      const saved = await upsertNote({ stateKey, wordId: word.id, kind: 'note', content });
      setNoteId(saved.id);
      setDraft(content);
      showInfo(NOTES.saved);
    } catch {
      showError(ERROR_MESSAGES.DB_WRITE_FAILED);
    }
  }, [draft, noteId, stateKey, word.id, showInfo, showError]);

  return (
    <section
      aria-label={NOTES.notesTitle}
      className={clsx(
        'mt-2 flex flex-col border-t border-border pt-3',
        compact ? 'gap-2' : 'gap-4',
        // 单栏（紧凑）模式：卡片新增记忆区后整体变长，收藏/备注区限高内部滚动，不撑破一屏
        compact && 'app-no-scrollbar max-h-[28vh] overflow-y-auto',
      )}
    >
      {/* 收藏（紧凑模式与必应词典同行） */}
      <div className="flex items-center gap-2">
        <Button
          variant={starred ? 'primary' : 'secondary'}
          size="sm"
          aria-pressed={starred}
          className={compact ? 'h-9 min-w-0 flex-1' : undefined}
          onClick={() => void handleToggleStar()}
        >
          {starred ? NOTES.starred : NOTES.star}
        </Button>
        {compact ? <BingDictLink headword={word.headword} className="h-9 min-w-0 flex-1" /> : null}
      </div>

      {/* 备注：标题 + 输入框与保存按钮同一行（按钮贴右） */}
      <div className="flex flex-col gap-1">
        <h4 className="text-xs font-medium text-text-3">{NOTES.noteLabel}</h4>
        <div className="flex items-end gap-2">
          <textarea
            aria-label={NOTES.noteLabel}
            value={draft}
            onChange={handleDraftChange}
            placeholder={NOTES.placeholderNote}
            rows={compact ? 2 : 3}
            className="min-w-0 flex-1 resize-none rounded-md border border-border bg-surface-2 p-3 text-sm text-text placeholder:text-text-3 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <Button size="sm" variant="secondary" className="shrink-0" onClick={() => void handleSaveNote()}>
            {ACTIONS.save}
          </Button>
        </div>
      </div>
    </section>
  );
}
