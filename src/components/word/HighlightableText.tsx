/**
 * 可高亮文本段（笔记与高亮批次核心组件）。
 *
 * 职责：
 * 1. 还原：把传进来的高亮记录按「文本子串匹配」叠回原文，
 *    逐字符取 createdAt 最新的记录，分段用 <span> 包裹渲染（不破坏文本节点结构）；
 * 2. 新增：鼠标/触摸划选文本（window.getSelection）后浮动 4 色色板，
 *    选色回调 onAddHighlight(选中文本, 颜色档位)；
 * 3. 删除：点击已有高亮段落 → 浮动「删除高亮」按钮（再次点击段落收起，移动端友好）。
 *
 * 兼容性说明：桌面依赖 mouseup + selectionchange；移动端依赖
 * selectionchange（iOS 划选手柄调整时持续触发），touchend 仅作补充。
 * 色板/删除按钮用 position:fixed（视口坐标），不受卡片 overflow 裁剪。
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
} from 'react';

import { highlightColorLabel, NOTES } from '@/constants';
import type { HighlightColor, WordHighlight } from '@/types';

/** 高亮档位 → Tailwind 背景类（静态映射，避免动态类名被 purge） */
const HL_BG: Record<HighlightColor, string> = {
  1: 'bg-hl-1',
  2: 'bg-hl-2',
  3: 'bg-hl-3',
  4: 'bg-hl-4',
};

const COLORS: readonly HighlightColor[] = [1, 2, 3, 4];

/** 渲染分段：一段原文 + 应用其上的高亮（null = 未高亮） */
export interface HighlightSegment {
  text: string;
  highlight: WordHighlight | null;
}

/**
 * 纯函数：把高亮记录叠到原文上，产出渲染分段。
 *
 * 规则：
 * - 每条高亮按 `text.indexOf` 定位（可能出现多次则全部覆盖）；
 * - 同一字符被多条覆盖时取 createdAt 最新的一条；
 * - 相邻字符高亮相同则合并为一段。
 */
export function buildSegments(text: string, highlights: WordHighlight[]): HighlightSegment[] {
  if (text.length === 0) {
    return [];
  }
  const cover = new Map<number, WordHighlight>();
  for (const highlight of highlights) {
    if (highlight.text.length === 0) {
      continue;
    }
    let from = text.indexOf(highlight.text);
    while (from !== -1) {
      for (let index = from; index < from + highlight.text.length; index += 1) {
        const prev = cover.get(index);
        if (!prev || prev.createdAt <= highlight.createdAt) {
          cover.set(index, highlight);
        }
      }
      from = text.indexOf(highlight.text, from + 1);
    }
  }
  const segments: HighlightSegment[] = [];
  let index = 0;
  while (index < text.length) {
    const highlight = cover.get(index) ?? null;
    let end = index + 1;
    while (end < text.length && (cover.get(end) ?? null) === highlight) {
      end += 1;
    }
    segments.push({ text: text.slice(index, end), highlight });
    index = end;
  }
  return segments;
}

/** 色板浮动状态（视口坐标） */
interface PaletteState {
  text: string;
  x: number;
  y: number;
}

/** 删除按钮浮动状态（视口坐标） */
interface DeleteTarget {
  id: string;
  x: number;
  y: number;
}

export interface HighlightableTextProps {
  /** 原文 */
  text: string;
  /** 该文本段已有高亮记录 */
  highlights: WordHighlight[];
  /** 划选 + 选色回调；缺省 = 只渲染还原，不启交互（做题页复用时可用） */
  onAddHighlight?: (text: string, color: HighlightColor) => void;
  /** 删除已有高亮回调；缺省 = 高亮不可删 */
  onDeleteHighlight?: (id: string) => void;
  /** 渲染标签，默认 p */
  as?: 'p' | 'span' | 'h2' | 'h3';
  className?: string;
  /** 无障碍名称 */
  ariaLabel?: string;
}

function HighlightableTextImpl({
  text,
  highlights,
  onAddHighlight,
  onDeleteHighlight,
  as = 'p',
  className,
  ariaLabel,
}: HighlightableTextProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  /** 色板按钮按下中：防止 mousedown 清空 selection 导致色板先消失 */
  const pressingRef = useRef(false);
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const interactive = onAddHighlight !== undefined;

  const segments = useMemo(() => buildSegments(text, highlights), [text, highlights]);

  // ---------- 划选 → 色板 ----------
  const evaluateSelection = useCallback((): void => {
    if (!onAddHighlight || pressingRef.current) {
      return;
    }
    const container = containerRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      setPalette(null);
      return;
    }
    // 选区必须落在当前文本段内（跨块选择不建高亮）
    const ancestor = selection.getRangeAt(0).commonAncestorContainer;
    const element =
      ancestor.nodeType === ancestor.TEXT_NODE
        ? ancestor.parentElement
        : (ancestor as HTMLElement);
    if (!element || !container.contains(element)) {
      setPalette(null);
      return;
    }
    const selected = selection.toString().trim();
    if (!selected) {
      setPalette(null);
      return;
    }
    // 色板定位用视口坐标；jsdom 等环境没有 Range.getBoundingClientRect，回落 (0,0)
    let left = 0;
    let width = 0;
    let bottom = 0;
    try {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      left = rect.left;
      width = rect.width;
      bottom = rect.bottom;
    } catch {
      // 忽略：定位退化，不影响功能
    }
    setPalette({ text: selected, x: left + width / 2, y: bottom });
  }, [onAddHighlight]);

  useEffect(() => {
    if (!interactive) {
      return;
    }
    const onChange = (): void => evaluateSelection();
    // touchend 用 passive 无法阻止默认，这里只是读取选区
    const onTouchEnd = (): void => {
      // 移动端松手后选区句柄还会出现，延迟一帧再读
      window.setTimeout(evaluateSelection, 50);
    };
    const onHide = (): void => setPalette(null);
    document.addEventListener('selectionchange', onChange);
    window.addEventListener('mouseup', onChange);
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('scroll', onHide, true);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      window.removeEventListener('mouseup', onChange);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('scroll', onHide, true);
    };
  }, [interactive, evaluateSelection]);

  // ---------- 点空白处收起删除按钮 ----------
  useEffect(() => {
    if (deleteTarget === null) {
      return;
    }
    const onMouseDown = (event: Event): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-whl-id],[data-whl-delete]')) {
        return;
      }
      setDeleteTarget(null);
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [deleteTarget]);

  const handleSegmentClick = (event: MouseEvent<HTMLElement>, id: string): void => {
    if (!onDeleteHighlight) {
      return;
    }
    event.stopPropagation();
    setDeleteTarget((prev) => {
      if (prev?.id === id) {
        return null;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const below = rect.top < 36;
      return {
        id,
        x: rect.left + rect.width / 2,
        y: below ? rect.bottom + 6 : rect.top - 34,
      };
    });
  };

  const handleColorPick = (event: MouseEvent<HTMLButtonElement>, color: HighlightColor): void => {
    event.stopPropagation();
    const selected = palette?.text ?? '';
    window.getSelection()?.removeAllRanges();
    setPalette(null);
    if (selected && onAddHighlight) {
      onAddHighlight(selected, color);
    }
  };

  const handleDeleteClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    const id = deleteTarget?.id ?? null;
    setDeleteTarget(null);
    if (id && onDeleteHighlight) {
      onDeleteHighlight(id);
    }
  };

  const Tag = as as ElementType;

  return (
    <Tag ref={containerRef} aria-label={ariaLabel} className={clsx('relative', className)}>
      {segments.map((segment, index) => {
        if (!segment.highlight) {
          return <span key={index}>{segment.text}</span>;
        }
        return (
          <span
            key={index}
            data-whl-id={segment.highlight.id}
            onClick={(event: MouseEvent<HTMLElement>) =>
              handleSegmentClick(event, segment.highlight?.id ?? '')
            }
            className={clsx('rounded-sm', HL_BG[segment.highlight.color], onDeleteHighlight && 'cursor-pointer')}
          >
            {segment.text}
          </span>
        );
      })}

      {palette && onAddHighlight ? (
        <div
          role="toolbar"
          aria-label={NOTES.paletteLabel}
          onMouseDown={(event) => {
            // 阻止 mousedown 默认行为：保留选区，色板按钮才能点得到
            event.preventDefault();
            pressingRef.current = true;
          }}
          onMouseUp={() => {
            pressingRef.current = false;
          }}
          className="fixed z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-1 shadow-e2"
          style={{ left: palette.x, top: palette.y + 6 }}
        >
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={highlightColorLabel(color)}
              onClick={(event) => handleColorPick(event, color)}
              className={clsx(
                'app-tappable h-8 w-8 rounded-full border border-border transition-transform duration-fast hover:scale-110',
                HL_BG[color],
              )}
            />
          ))}
        </div>
      ) : null}

      {deleteTarget && onDeleteHighlight ? (
        <button
          type="button"
          data-whl-delete="true"
          aria-label={NOTES.deleteHighlightLabel}
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleDeleteClick}
          className="fixed z-50 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-surface px-3 py-1 text-xs text-danger shadow-e2"
          style={{ left: deleteTarget.x, top: deleteTarget.y }}
        >
          {NOTES.deleteHighlightLabel}
        </button>
      ) : null}
    </Tag>
  );
}

export const HighlightableText = HighlightableTextImpl;
