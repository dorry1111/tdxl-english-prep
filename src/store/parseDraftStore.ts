/**
 * 切题草稿的中转 store（T13）。
 *
 * ExamEditPage「自动切题」的产物（原文 + 草稿）不落库（ARCHITECTURE：
 * ParsedPaperDraft 仅校对页内存态），通过本 store 在「录入页 → 校对页」之间传递。
 * 刷新页面后丢失 rawText，校对页降级为「仅结构树」模式并给出提示。
 */
import { create } from 'zustand';

import type { ParsedPaperDraft } from '@/types';

interface ParseDraftState {
  /** 草稿所属试卷 ID（与 DB 中 Exam.id 一致） */
  paperId: string | null;
  /** 粘贴的原始文本（校对页左栏展示与定位用） */
  rawText: string;
  draft: ParsedPaperDraft | null;
  setDraft: (paperId: string, rawText: string, draft: ParsedPaperDraft) => void;
  clear: () => void;
}

export const useParseDraftStore = create<ParseDraftState>()((set) => ({
  paperId: null,
  rawText: '',
  draft: null,
  setDraft: (paperId, rawText, draft) => set({ paperId, rawText, draft }),
  clear: () => set({ paperId: null, rawText: '', draft: null }),
}));
