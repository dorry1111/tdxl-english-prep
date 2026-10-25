/**
 * AnswerSheet 组件测试（T14）：
 * - 77 格按 7 区段分组（Ⅰ 口语 … Ⅶ 写作），主观题两格标「译」「写」；
 * - 三态（未答 / 已答 / 已标记）与当前题高亮；
 * - 点击跳题回调；「只看标记」筛选生效。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { EXAMS } from '@/constants';
import { AnswerSheet } from './AnswerSheet';
import type { AnswerDraft } from '@/store/attemptStore';
import { buildStandardExamJson } from '@/test/fixtures/examJsonFixture';
import type { Question } from '@/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const QUESTIONS = buildStandardExamJson().questions as unknown as Question[];

/** 按 1 起下标取题（noUncheckedIndexedAccess 友好） */
function qAt(index1: number): Question {
  const question = QUESTIONS[index1 - 1];
  if (!question) {
    throw new Error(`question #${index1} not found`);
  }
  return question;
}

function makeAnswer(choice: string | null, flagged = false): AnswerDraft {
  return { choice, text: null, flagged, answeredAt: 0 };
}

function mountSheet(answers: Record<string, AnswerDraft>, currentSeq: number | null = null) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const onJump = vi.fn();
  act(() => {
    root.render(
      <AnswerSheet questions={QUESTIONS} answers={answers} currentSeq={currentSeq} onJump={onJump} />,
    );
  });
  return {
    container,
    onJump,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('AnswerSheet', () => {
  it('渲染 77 格、7 个区段分组，主观题两格标「译」「写」', () => {
    const page = mountSheet({});
    const cells = page.container.querySelectorAll('button[aria-label^="跳到第"]');
    expect(cells).toHaveLength(77);
    const groups = page.container.querySelectorAll('[data-section]');
    expect(groups).toHaveLength(7);
    const groupTitles = Array.from(page.container.querySelectorAll('h3')).map((h) => h.textContent ?? '');
    expect(groupTitles.some((title) => title.includes('Ⅰ'))).toBe(true);
    expect(groupTitles.some((title) => title.includes('Ⅶ'))).toBe(true);
    const labels = Array.from(cells).map((cell) => cell.textContent ?? '');
    expect(labels).toContain(EXAMS.sheetSubjectiveTranslation);
    expect(labels).toContain(EXAMS.sheetSubjectiveWriting);
    page.unmount();
  });

  it('三态：已答实心、标记描边、当前题 outline', () => {
    const answered = makeAnswer('A');
    const flagged = makeAnswer(null, true);
    const page = mountSheet(
      {
        [qAt(1).id]: answered,
        [qAt(2).id]: flagged,
      },
      3,
    );
    const cellOf = (seq: number): HTMLElement =>
      page.container.querySelector(`button[aria-label="跳到第 ${seq} 题"]`) as HTMLElement;
    expect(cellOf(1).className).toContain('bg-exam-answered');
    expect(cellOf(2).className).toContain('border-exam-flagged');
    expect(cellOf(3).getAttribute('aria-current')).toBe('true');
    expect(cellOf(4).className).toContain('bg-exam-unanswered');
    page.unmount();
  });

  it('点击格子触发跳题回调（携带对应题目）', () => {
    const page = mountSheet({});
    const cell = page.container.querySelector(
      'button[aria-label="跳到第 42 题"]',
    ) as HTMLButtonElement;
    act(() => {
      cell.click();
    });
    expect(page.onJump).toHaveBeenCalledTimes(1);
    const firstCall = page.onJump.mock.calls[0] as unknown as [Question];
    expect(firstCall[0].seq).toBe(42);
    page.unmount();
  });

  it('「只看标记」筛选：只渲染 flagged 格', () => {
    const page = mountSheet({
      [qAt(1).id]: makeAnswer('A', true),
      [qAt(2).id]: makeAnswer('B', false),
      [qAt(3).id]: makeAnswer('C', true),
    });
    let cells = page.container.querySelectorAll('button[aria-label^="跳到第"]');
    expect(cells).toHaveLength(77);
    const toggle = Array.from(page.container.querySelectorAll('button')).find((button) =>
      (button.textContent ?? '').includes(EXAMS.sheetFlaggedOnly),
    ) as HTMLButtonElement;
    act(() => {
      toggle.click();
    });
    cells = page.container.querySelectorAll('button[aria-label^="跳到第"]');
    expect(cells).toHaveLength(2);
    page.unmount();
  });

  it('主观题有文本内容也算「已答」', () => {
    const page = mountSheet({
      [qAt(76).id]: { choice: null, text: '我的翻译', flagged: false, answeredAt: 0 },
    });
    const cell = page.container.querySelector(
      `button[aria-label="跳到第 76 题"]`,
    ) as HTMLElement;
    expect(cell.className).toContain('bg-exam-answered');
    page.unmount();
  });
});
