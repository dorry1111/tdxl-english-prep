/**
 * 原文视图（T14 答题页左栏 / T15 解析回看）。
 *
 * - 可折叠：做题时先收起，点标题展开，节省竖向空间；
 * - 双语对照开关：Passage 带 translation 时出现，展开译文对照；
 * - 内容按空行分段渲染（Passage.content 保留换行与空行）；
 * - 空位下划线：传入 blankNumbers 时，原文中对应的裸数字（如完形的 46~55）
 *   渲染成「长下划线 + 数字居中」（BlankMarker），当前作答的空位用主题色；
 * - 划词高亮（P3）：传入 highlights + highlightActions 时，每段支持划选高亮/笔记，
 *   高亮记录锚 `p:<段落序号>`（splitParagraphs 下标）。
 */
import { useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';

import { EXAMS } from '@/constants';
import { BlankMarker } from '@/components/exam/BlankMarker';
import { ExamHighlightable, type ExamHighlightActions } from '@/components/exam/ExamHighlightable';
import { Icon } from '@/components/ui/Icon';
import type { Passage, TextHighlight } from '@/types';
import type { ExamHighlightPageActions } from '@/pages/exams/useExamHighlightActions';

export interface PassageViewProps {
  passage: Passage | undefined;
  /** 初始是否折叠，默认 true（答题时先看题） */
  defaultCollapsed?: boolean;
  /** 空位序号集合（如完形 46~55）；原文中这些数字会长下划线高亮 */
  blankNumbers?: ReadonlySet<number>;
  /** 当前正在作答的空位序号（主题色高亮，其余中性） */
  activeBlank?: number | null;
  /** 本 passage 的划词高亮记录（anchorKind='passage'） */
  highlights?: TextHighlight[];
  /** 划词动作（页面级，anchorKind/anchorId 在这里绑定）；缺省 = 不启交互 */
  highlightActions?: ExamHighlightPageActions;
  className?: string;
}

/** 把原文按空行切成段落；连续单换行保留为段内换行（供测试与高亮分桶复用） */
function splitParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

/** 把段落中的空位数字渲染为长下划线标记；其余文本原样返回 */
function renderWithBlanks(
  paragraph: string,
  blanks: ReadonlySet<number> | undefined,
  activeBlank: number | null,
): ReactNode {
  if (!blanks || blanks.size === 0) {
    return paragraph;
  }
  // 捕获组让 split 保留数字本身：偶数位是普通文本，奇数位是数字
  const parts = paragraph.split(/\b(\d{1,3})\b/g);
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      const value = Number(part);
      if (blanks.has(value)) {
        return <BlankMarker key={index} value={value} active={value === activeBlank} />;
      }
    }
    return part;
  });
}

export function PassageView({
  passage,
  defaultCollapsed = true,
  blankNumbers,
  activeBlank = null,
  highlights,
  highlightActions,
  className,
}: PassageViewProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [showTranslation, setShowTranslation] = useState(false);

  const paragraphs = useMemo(
    () => (passage ? splitParagraphs(passage.content) : []),
    [passage],
  );

  /** 本 passage 的高亮按段落分桶（blockKey=`p:<下标>`） */
  const highlightsByParagraph = useMemo(() => {
    const map = new Map<number, TextHighlight[]>();
    if (!highlights) {
      return map;
    }
    for (const item of highlights) {
      const match = /^p:(\d+)$/.exec(item.blockKey);
      if (!match) {
        continue;
      }
      const index = Number(match[1]);
      if (!Number.isInteger(index) || index < 0 || index >= paragraphs.length) {
        continue;
      }
      const bucket = map.get(index);
      if (bucket) {
        bucket.push(item);
      } else {
        map.set(index, [item]);
      }
    }
    return map;
  }, [highlights, paragraphs]);

  if (!passage) {
    return null;
  }

  return (
    <section className={clsx('rounded-md border border-border bg-surface-2', className)}>
      <header className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-expanded={!collapsed}
          className="app-tappable flex min-h-[44px] flex-1 items-center gap-1 text-left text-sm font-semibold text-text"
        >
          <Icon
            name="chevron-right"
            size={16}
            className={clsx('transition-transform duration-fast', !collapsed && 'rotate-90')}
          />
          {EXAMS.examPassageTitle}
        </button>
        {passage.translation ? (
          <button
            type="button"
            onClick={() => setShowTranslation((prev) => !prev)}
            aria-pressed={showTranslation}
            className={clsx(
              'app-tappable rounded-sm border px-2 py-1 text-xs font-medium',
              showTranslation
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-border bg-surface text-text-2',
            )}
          >
            {EXAMS.examPassageBilingual}
          </button>
        ) : null}
      </header>
      {!collapsed ? (
        <div className="space-y-3 px-3 pb-3">
          {paragraphs.map((paragraph, index) => {
            const blockKey = `p:${index}`;
            const blockActions: ExamHighlightActions | undefined = highlightActions
              ? {
                  onAdd: (text, start, color, note) =>
                    highlightActions.onAdd({
                      anchorKind: 'passage',
                      anchorId: passage.id,
                      blockKey,
                      text,
                      start,
                      color,
                      note,
                    }),
                  onAddWord: highlightActions.onAddWord,
                  onUpdate: highlightActions.onUpdate,
                  onDelete: highlightActions.onDelete,
                }
              : undefined;
            return (
              <ExamHighlightable
                key={index}
                as="p"
                text={paragraph}
                highlights={highlightsByParagraph.get(index) ?? []}
                actions={blockActions}
                className="text-sm leading-relaxed text-text"
                renderSegment={(segmentText) =>
                  renderWithBlanks(segmentText, blankNumbers, activeBlank)
                }
                extra={
                  showTranslation && passage.translation ? (
                    <span className="mt-1 block border-t border-border pt-1 text-xs text-text-2">
                      {passage.translation}
                    </span>
                  ) : null
                }
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
