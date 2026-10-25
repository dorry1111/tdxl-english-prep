/**
 * 真题划词高亮文本块（P3 核心组件，PassageView / QuestionView 共用）。
 *
 * 职责：
 * 1. 还原：把传入的 TextHighlight（本块的）按「文本定位」叠回原文渲染分段；
 * 2. 新增：划选（单词或句子片段）→ 浮动动作条——
 *    单词：生词本 / 笔记 / 4 色高亮；句子片段：笔记 / 4 色高亮；
 * 3. 编辑：点击已有高亮 → 动作条（笔记 / 删除 / 4 色换色）。
 *
 * 防误触：选区 < 2 字符不响应；触屏 touchend 位移 < 8px 视为轻点并收起浮层。
 * 动作条 position:fixed（视口坐标），不受卡片 overflow 裁剪。
 * 错误处理：actions 的 Promise reject 由父组件 catch + toast，组件只负责触发。
 */
import clsx from 'clsx';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ElementType,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { EXAMS, highlightColorLabel } from '@/constants';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import {
  buildTextSegments,
  classifySelection,
  type ExamTextSegment,
} from '@/components/exam/highlightSegments';
import type { HighlightColor, TextHighlight } from '@/types';

/** 高亮档位 → Tailwind 背景类（静态映射，避免动态类名被 purge） */
const HL_BG: Record<HighlightColor, string> = {
  1: 'bg-hl-1',
  2: 'bg-hl-2',
  3: 'bg-hl-3',
  4: 'bg-hl-4',
};

const COLORS: readonly HighlightColor[] = [1, 2, 3, 4];

/** 划选/编辑动作由父组件落库（textHighlightRepo） */
export interface ExamHighlightActions {
  /** 添加高亮（text 为归一后的选区文本，start 为块内起点提示） */
  onAdd: (text: string, start: number | null, color: HighlightColor, note: string | null) => Promise<void>;
  /** 单词加入生词本（仅单词且提供时显示按钮） */
  onAddWord?: (word: string) => Promise<void>;
  /** 更新已有高亮的颜色/笔记 */
  onUpdate: (id: string, patch: { color?: HighlightColor; note?: string | null }) => Promise<void>;
  /** 删除高亮 */
  onDelete: (id: string) => Promise<void>;
}

/** 浮动动作条状态 */
interface PaletteState {
  /** new = 划选新内容；edit = 操作已有高亮 */
  mode: 'new' | 'edit';
  /** mode=new 时的选区文本 */
  text: string;
  /** mode=new 时的块内起点 */
  start: number | null;
  /** mode=new 且选区是单词 */
  isWord: boolean;
  /** mode=edit 时的目标高亮 */
  targetId: string;
  x: number;
  y: number;
}

/** 笔记弹窗状态（new = 随新高亮创建；edit = 编辑已有高亮的笔记） */
interface NoteDialogState {
  mode: 'new' | 'edit';
  initial: string;
  /** mode=new 时的划选内容（保存时随高亮一起落库） */
  draftText: string | null;
  draftStart: number | null;
  targetId: string | null;
}

export interface ExamHighlightableProps {
  /** 块内原文 */
  text: string;
  /** 本块已有的高亮记录（父组件按 anchorId + blockKey 过滤后传入） */
  highlights: TextHighlight[];
  /** 交互动作；缺省 = 只渲染还原，不启交互（打印/蒙层等场景） */
  actions?: ExamHighlightActions;
  /** 渲染标签，默认 p */
  as?: 'p' | 'span' | 'div';
  className?: string;
  /** 追加内容（如译文块），不参与高亮分段 */
  extra?: ReactNode;
  /** 分段文本的自定义渲染（如完形空位数字 → BlankMarker）；缺省原样输出 */
  renderSegment?: (text: string) => ReactNode;
}

/** 计算选区在块文本中的起点（遍历分段 span 累加长度） */
function computeStart(container: HTMLElement, range: Range): number | null {
  const node = range.startContainer;
  const element =
    node.nodeType === node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
  if (!element || !container.contains(element)) {
    return null;
  }
  let offset = 0;
  for (const child of Array.from(container.children)) {
    if (child === element || child.contains(element)) {
      return offset + range.startOffset;
    }
    offset += (child.textContent ?? '').length;
  }
  return null;
}

export function ExamHighlightable({
  text,
  highlights,
  actions,
  as = 'p',
  className,
  extra,
  renderSegment,
}: ExamHighlightableProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  /** 动作条按下中：防止 mousedown 清空 selection 导致动作条先消失 */
  const pressingRef = useRef(false);
  /** 触摸起点（防误触 8px 阈值） */
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const [noteDialog, setNoteDialog] = useState<NoteDialogState | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const interactive = actions !== undefined;
  const segments = useMemo(() => buildTextSegments(text, highlights), [text, highlights]);

  // ---------- 划选 → 动作条 ----------
  const evaluateSelection = useCallback((): void => {
    if (!actions || pressingRef.current) {
      return;
    }
    const container = containerRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      setPalette(null);
      return;
    }
    // 选区必须落在当前块内（跨块选择不建高亮）
    const ancestor = selection.getRangeAt(0).commonAncestorContainer;
    const element =
      ancestor.nodeType === ancestor.TEXT_NODE
        ? ancestor.parentElement
        : (ancestor as HTMLElement);
    if (!element || !container.contains(element)) {
      setPalette(null);
      return;
    }
    const picked = classifySelection(selection.toString());
    if (picked.kind === 'invalid') {
      setPalette(null);
      return;
    }
    const range = selection.getRangeAt(0);
    let x = window.innerWidth / 2;
    let y = 120;
    try {
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        x = rect.left + rect.width / 2;
        y = rect.bottom;
      }
    } catch {
      // 定位退化，不影响功能
    }
    setPalette({
      mode: 'new',
      text: picked.text,
      start: computeStart(container, range),
      isWord: picked.kind === 'word',
      targetId: '',
      x,
      y,
    });
  }, [actions]);

  useEffect(() => {
    if (!interactive) {
      return;
    }
    const onChange = (): void => evaluateSelection();
    const onTouchStart = (event: TouchEvent): void => {
      const touch = event.touches[0];
      touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onTouchEnd = (event: TouchEvent): void => {
      const start = touchStartRef.current;
      const touch = event.changedTouches[0];
      // 位移 < 8px 视为轻点：收起浮层（轻点不产生有效选区，防误开）
      if (
        start &&
        touch &&
        Math.abs(touch.clientX - start.x) < 8 &&
        Math.abs(touch.clientY - start.y) < 8
      ) {
        setPalette(null);
        return;
      }
      // 松手后选区句柄还会调整，延迟一帧再读
      window.setTimeout(evaluateSelection, 50);
    };
    const onHide = (): void => setPalette(null);
    document.addEventListener('selectionchange', onChange);
    window.addEventListener('mouseup', onChange);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('scroll', onHide, true);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      window.removeEventListener('mouseup', onChange);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('scroll', onHide, true);
    };
  }, [interactive, evaluateSelection]);

  // ---------- 点空白处收起编辑动作条 ----------
  useEffect(() => {
    if (palette === null || palette.mode !== 'edit') {
      return;
    }
    const onMouseDown = (event: Event): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-thl-id],[data-thl-bar]')) {
        return;
      }
      setPalette(null);
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [palette]);

  const handleSegmentClick = (event: MouseEvent<HTMLElement>, id: string): void => {
    if (!actions) {
      return;
    }
    event.stopPropagation();
    setPalette((prev) => {
      if (prev?.mode === 'edit' && prev.targetId === id) {
        return null;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const below = rect.top < 48;
      return {
        mode: 'edit',
        text: '',
        start: null,
        isWord: false,
        targetId: id,
        x: rect.left + rect.width / 2,
        y: below ? rect.bottom + 6 : rect.top - 44,
      };
    });
  };

  const handleColorPick = (event: MouseEvent<HTMLButtonElement>, color: HighlightColor): void => {
    event.stopPropagation();
    const current = palette;
    if (!current || !actions) {
      return;
    }
    if (current.mode === 'new') {
      window.getSelection()?.removeAllRanges();
      setPalette(null);
      void actions.onAdd(current.text, current.start, color, null);
      return;
    }
    setPalette(null);
    void actions.onUpdate(current.targetId, { color });
  };

  const handleAddWord = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    const current = palette;
    if (!current || current.mode !== 'new' || !actions?.onAddWord) {
      return;
    }
    window.getSelection()?.removeAllRanges();
    setPalette(null);
    void actions.onAddWord(current.text);
  };

  const openNoteDialog = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    const current = palette;
    if (!current || !actions) {
      return;
    }
    if (current.mode === 'new') {
      window.getSelection()?.removeAllRanges();
      setPalette(null);
      setNoteDraft('');
      setNoteDialog({
        mode: 'new',
        initial: '',
        draftText: current.text,
        draftStart: current.start,
        targetId: null,
      });
      return;
    }
    setPalette(null);
    const existing = highlights.find((item) => item.id === current.targetId);
    setNoteDraft(existing?.note ?? '');
    setNoteDialog({
      mode: 'edit',
      initial: existing?.note ?? '',
      draftText: null,
      draftStart: null,
      targetId: current.targetId,
    });
  };

  const handleDeleteClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    const id = palette?.targetId ?? '';
    setPalette(null);
    if (id && actions) {
      void actions.onDelete(id);
    }
  };

  const saveNote = (): void => {
    const current = noteDialog;
    if (!current || !actions) {
      return;
    }
    const trimmed = noteDraft.trim();
    setNoteDialog(null);
    if (current.mode === 'new' && current.draftText !== null) {
      // 随新高亮创建：颜色用默认档 2，之后可换色
      void actions.onAdd(current.draftText, current.draftStart, 2, trimmed !== '' ? trimmed : null);
      return;
    }
    if (current.mode === 'edit' && current.targetId) {
      void actions.onUpdate(current.targetId, { note: trimmed !== '' ? trimmed : null });
    }
  };

  const Tag = as as ElementType;

  return (
    <Tag ref={containerRef} className={clsx('relative', className)}>
      {segments.map((segment: ExamTextSegment, index: number) => {
        const content = renderSegment ? renderSegment(segment.text) : segment.text;
        if (!segment.highlight) {
          return <span key={index}>{content}</span>;
        }
        return (
          <span
            key={index}
            data-thl-id={segment.highlight.id}
            onClick={(event: MouseEvent<HTMLElement>) =>
              handleSegmentClick(event, segment.highlight?.id ?? '')
            }
            className={clsx('rounded-sm', HL_BG[segment.highlight.color], interactive && 'cursor-pointer')}
          >
            {content}
          </span>
        );
      })}
      {extra}

      {palette && actions ? (
        <div
          role="toolbar"
          aria-label={EXAMS.examHighlightBarLabel}
          data-thl-bar="true"
          onMouseDown={(event) => {
            event.preventDefault();
            pressingRef.current = true;
          }}
          onMouseUp={() => {
            pressingRef.current = false;
          }}
          className="fixed z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-1 shadow-e2"
          style={{ left: palette.x, top: palette.y + 6 }}
        >
          {palette.mode === 'new' && palette.isWord && actions.onAddWord ? (
            <button
              type="button"
              onClick={handleAddWord}
              className="app-tappable rounded-full px-2 py-1 text-xs font-medium text-primary"
            >
              {EXAMS.examHighlightAddWord}
            </button>
          ) : null}
          <button
            type="button"
            onClick={openNoteDialog}
            className="app-tappable rounded-full px-2 py-1 text-xs font-medium text-text"
          >
            {EXAMS.examHighlightNote}
          </button>
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={highlightColorLabel(color)}
              onClick={(event) => handleColorPick(event, color)}
              className={clsx(
                'app-tappable h-7 w-7 rounded-full border border-border transition-transform duration-fast hover:scale-110',
                HL_BG[color],
              )}
            />
          ))}
          {palette.mode === 'edit' ? (
            <>
              <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
              <button
                type="button"
                onClick={handleDeleteClick}
                className="app-tappable rounded-full px-2 py-1 text-xs font-medium text-danger"
              >
                {EXAMS.examHighlightDelete}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <Dialog
        open={noteDialog !== null}
        title={EXAMS.examHighlightNoteTitle}
        onClose={() => setNoteDialog(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setNoteDialog(null)}>
              {EXAMS.examHighlightNoteCancel}
            </Button>
            <Button size="sm" onClick={saveNote}>
              {EXAMS.examHighlightNoteSave}
            </Button>
          </div>
        }
      >
        <textarea
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          placeholder={EXAMS.examHighlightNotePlaceholder}
          rows={4}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-3"
        />
      </Dialog>
    </Tag>
  );
}
