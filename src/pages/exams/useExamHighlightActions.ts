/**
 * 真题划词高亮 actions hook（P3）：把 textHighlightRepo 与 toast 接成
 * PassageView / QuestionView 需要的动作对象。
 *
 * - onAddWord：normalizeWord 归一 → 生词本（source='imported'，不记 attempt）；
 * - 所有落库失败统一 toastError(toUserMessage)，成功给轻提示；
 * - 返回对象用 useMemo 稳定引用，避免子组件重渲染风暴。
 */
import { useMemo } from 'react';

import { BUILTIN_BOOK_ID, EXAMS } from '@/constants';
import { add as addNotebook } from '@/db/repos/notebookRepo';
import {
  addTextHighlight,
  softDeleteTextHighlight,
  updateTextHighlight,
} from '@/db/repos/textHighlightRepo';
import { toUserMessage } from '@/lib/errors';
import { normalizeWord, wordIdOf } from '@/lib/wordbookCache';
import { useUiStore } from '@/store/uiStore';
import type { HighlightColor, TextAnchorKind } from '@/types';

/** 页面级动作对象（anchorKind/anchorId/blockKey 由视图绑定） */
export interface ExamHighlightPageActions {
  onAdd: (args: {
    anchorKind: TextAnchorKind;
    anchorId: string;
    blockKey: string;
    text: string;
    start: number | null;
    color: HighlightColor;
    note: string | null;
  }) => Promise<void>;
  onAddWord: (word: string) => Promise<void>;
  onUpdate: (id: string, patch: { color?: HighlightColor; note?: string | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function useExamHighlightActions(): ExamHighlightPageActions {
  const toastSuccess = useUiStore((state) => state.toast.success);
  const toastError = useUiStore((state) => state.toast.error);

  return useMemo(
    () => ({
      onAdd: async (args) => {
        try {
          await addTextHighlight({
            anchorKind: args.anchorKind,
            anchorId: args.anchorId,
            blockKey: args.blockKey,
            text: args.text,
            start: args.start,
            color: args.color,
            note: args.note,
            wordNorm: /^[A-Za-z][A-Za-z'-]*$/.test(args.text) ? normalizeWord(args.text) || null : null,
          });
          toastSuccess(EXAMS.examHighlightSaved);
        } catch (error) {
          toastError(toUserMessage(error));
        }
      },
      onAddWord: async (word) => {
        const norm = normalizeWord(word);
        if (norm === '') {
          toastError(EXAMS.reviewWordInvalid);
          return;
        }
        try {
          await addNotebook({
            wordId: wordIdOf(BUILTIN_BOOK_ID, norm),
            headword: word,
            source: 'imported',
            sourceRef: null,
          });
          toastSuccess(EXAMS.reviewWordAdded(word));
        } catch (error) {
          toastError(toUserMessage(error));
        }
      },
      onUpdate: async (id, patch) => {
        try {
          const updated = await updateTextHighlight(id, patch);
          if (updated) {
            toastSuccess(EXAMS.examHighlightSaved);
          }
        } catch (error) {
          toastError(toUserMessage(error));
        }
      },
      onDelete: async (id) => {
        try {
          await softDeleteTextHighlight(id);
        } catch (error) {
          toastError(toUserMessage(error));
        }
      },
    }),
    [toastError, toastSuccess],
  );
}
