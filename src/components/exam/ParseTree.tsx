/**
 * 切题结构树（T13 校对页右栏）。
 *
 * 区段 →（文章数）→ 题目列表；题目行可拖拽到目标区段（HTML5 DnD），
 * 松手回调 onMoveQuestion(questionId, 目标区段类型)。unresolved 清单由页面渲染。
 */
import { useState } from 'react';
import clsx from 'clsx';

import { EXAMS, SECTION_ROMAN, SECTION_TYPES_BY_ORDER } from '@/constants';
import { SECTION_META } from '@/constants';
import type { Passage, Question, Section } from '@/types';

export interface ParseTreeProps {
  sections: Section[];
  questions: Question[];
  passages: Passage[];
  /** 当前选中的题目（左栏定位高亮） */
  activeQuestionId: string | null;
  onSelectQuestion: (question: Question) => void;
  onMoveQuestion: (questionId: string, targetSection: Section['type']) => void;
  className?: string;
}

export function ParseTree({
  sections,
  questions,
  passages,
  activeQuestionId,
  onSelectQuestion,
  onMoveQuestion,
  className,
}: ParseTreeProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // 按「当前区段声明顺序」分组；拖动改归属后由页面重算 sections
  const groups = sections
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((section) => {
      const meta = SECTION_META[section.type];
      const inSection = questions
        .filter((question) => question.sectionType === section.type)
        .sort((left, right) => left.seq - right.seq);
      const passageCount = passages.filter((passage) => passage.sectionType === section.type).length;
      return { type: section.type, meta, inSection, passageCount };
    });
  // 题目可能被移到未在 sections 里声明过的题型（极端情况），兜底补一组
  const knownTypes = new Set(sections.map((section) => section.type));
  const extraGroups = SECTION_TYPES_BY_ORDER.filter((type) => !knownTypes.has(type))
    .map((type) => {
      const inSection = questions.filter((question) => question.sectionType === type);
      return inSection.length > 0
        ? { type, meta: SECTION_META[type], inSection, passageCount: 0 }
        : null;
    })
    .filter((group): group is NonNullable<typeof group> => group !== null);

  return (
    <div className={clsx('flex flex-col gap-3', className)}>
      {[...groups, ...extraGroups].map((group) => {
        const roman = SECTION_ROMAN[group.meta.order - 1] ?? String(group.meta.order);
        const isDropTarget = dropTarget === group.type;
        return (
          <section
            key={group.type}
            data-section={group.type}
            onDragOver={(event) => {
              event.preventDefault();
              setDropTarget(group.type);
            }}
            onDragLeave={() => setDropTarget((prev) => (prev === group.type ? null : prev))}
            onDrop={(event) => {
              event.preventDefault();
              setDropTarget(null);
              if (draggingId !== null) {
                onMoveQuestion(draggingId, group.type);
                setDraggingId(null);
              }
            }}
            className={clsx(
              'rounded-md border bg-surface px-2 py-2',
              isDropTarget ? 'border-primary bg-primary-soft' : 'border-border',
            )}
          >
            <header className="flex items-center gap-2 px-1">
              <h3 className="text-sm font-semibold text-text">
                {roman} {group.meta.name}
              </h3>
              <span className="text-xs text-text-3">
                {EXAMS.parseTreeSectionMeta(group.inSection.length, group.passageCount)}
              </span>
            </header>
            <ul className="mt-1 flex flex-col">
              {group.inSection.map((question) => {
                const active = question.id === activeQuestionId;
                return (
                  <li key={question.id}>
                    <button
                      type="button"
                      draggable
                      onDragStart={() => setDraggingId(question.id)}
                      onDragEnd={() => setDraggingId(null)}
                      onClick={() => onSelectQuestion(question)}
                      aria-label={EXAMS.parseTreeQuestionLabel(question.seq)}
                      className={clsx(
                        'app-tappable flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm',
                        'cursor-grab active:cursor-grabbing',
                        active ? 'bg-primary-soft text-text' : 'text-text-2 hover:bg-surface-2',
                      )}
                    >
                      <span className="w-8 shrink-0 tabular-nums font-semibold text-text-3">
                        {question.seq}
                      </span>
                      <span className="line-clamp-1 flex-1">{question.stem}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
