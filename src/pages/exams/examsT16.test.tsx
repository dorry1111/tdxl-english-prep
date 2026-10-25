/**
 * T16 做题页三项 UI 改进测试。
 *
 * ① 口语交际：一段对话一屏（正文只出现一次 + 各空位选项），翻页按组走；
 * ② 词汇题：从解析反推考点词并加粗+主题色+下划线，无解析不标；
 * ③ 完形 / 口语空位：长下划线（inline-flex + 2px 下边框 + 最小宽度），当前空主题色。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { EXAMS } from '@/constants';
import { DialogueGroupView } from '@/components/exam/DialogueGroupView';
import { PassageView } from '@/components/exam/PassageView';
import { QuestionView } from '@/components/exam/QuestionView';
import { getPaperDetail } from '@/db/repos/examRepo';
import { importExamJson } from '@/db/seed';
import { groupDialogueQuestions } from '@/lib/exam/dialogueGroup';
import { buildStandardExamJson } from '@/test/fixtures/examJsonFixture';
import { useAttemptStore } from '@/store/attemptStore';
import { useUiStore } from '@/store/uiStore';
import AttemptPage from './AttemptPage';
import ReviewPage from './ReviewPage';
import type { Passage, Question } from '@/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAPER_ID = 't16-paper';

beforeAll(() => {
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function showModal(): void {
      this.setAttribute('open', '');
    };
  }
  if (typeof HTMLDialogElement.prototype.close !== 'function') {
    HTMLDialogElement.prototype.close = function close(): void {
      this.removeAttribute('open');
    };
  }
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = function scrollIntoView(): void {};
  }
});

beforeEach(() => {
  window.localStorage.clear();
  useAttemptStore.getState().reset();
  useUiStore.setState({ toasts: [] });
  vi.useRealTimers();
});

interface Mounted {
  container: HTMLElement;
  unmount: () => void;
}

function mount(node: React.ReactNode): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(<MemoryRouter>{node}</MemoryRouter>);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (button) => (button.textContent ?? '').includes(label),
  );
  if (!found) {
    throw new Error(`未找到按钮: ${label}`);
  }
  return found;
}

/** 把标准卷的前三道口语题改成「一段对话 + 三个空位」（2019 型数据） */
function buildDialogueExamJson() {
  const json = buildStandardExamJson('T16 口语卷');
  // 校验要求 answerKey 必须落在选项里（答案按 seq 循环 A-D），故四个选项都给全
  const options = [
    { key: 'A', text: "You've been saying that forever!" },
    { key: 'B', text: 'There must be ten here.' },
    { key: 'C', text: "Let's read this book." },
    { key: 'D', text: 'I will read it later.' },
  ];
  const stems = [
    '（第 1 空）Girl:  ____ ',
    "（第 2 空）Girl: That's boring.  ____  It's about a bear and a cat. Dad: Whoa, I thought you said one book. 3",
    "（第 3 空）Girl: That's boring. 2 It's about a bear and a cat. Dad: Whoa, I thought you said one book.  ____ ",
  ];
  for (let index = 0; index < 3; index += 1) {
    const question = json.questions[index];
    if (!question) {
      continue;
    }
    question.stem = stems[index] ?? question.stem;
    question.options = options.map((option) => ({ ...option }));
  }
  return json;
}

describe('T16 ①：口语交际一段对话一屏', () => {
  it('答题页：3 个空位同屏、对话正文只出现一次、翻页按组跳到第 4 题', async () => {
    await importExamJson(buildDialogueExamJson(), { paperId: PAPER_ID });
    const detail = await getPaperDetail(PAPER_ID);
    const attemptId = await useAttemptStore.getState().start({
      exam: detail.exam as NonNullable<typeof detail.exam>,
      passages: detail.passages,
      questions: detail.questions,
      mode: 'full',
      sectionType: null,
      timeLimitSec: 9000,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`/attempt/${attemptId}`]}>
          <Routes>
            <Route path="/attempt/:id" element={<AttemptPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    try {
      // 一屏渲染 3 个空位的选项块
      expect(container.querySelectorAll('[data-blank-block]')).toHaveLength(3);
      // 对话正文只出现一次（"That's boring" 在 3 个 stem 里各有一份）
      const text = container.textContent ?? '';
      expect(text.split("That's boring").length - 1).toBe(1);
      // 三个空位标记都在正文里
      expect(container.querySelector('[data-blank="1"]')).not.toBeNull();
      expect(container.querySelector('[data-blank="2"]')).not.toBeNull();
      expect(container.querySelector('[data-blank="3"]')).not.toBeNull();
      expect(text).toContain(EXAMS.dialogueScriptTitle);

      // 翻页：口语整组一屏 → 下一屏直接到第 4 题
      act(() => {
        findButton(container, EXAMS.attemptNext).click();
      });
      expect(useAttemptStore.getState().currentSeq).toBe(4);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('DialogueGroupView：空位按序渲染，当前空位主题色高亮', () => {
    const group = groupDialogueQuestions(
      buildDialogueExamJson().questions.map((question, index) => ({
        ...question,
        id: `t16-q${index + 1}`,
      })) as unknown as Question[],
    )[0];
    expect(group).toBeDefined();
    if (!group) {
      return;
    }
    const mounted = mount(
      <DialogueGroupView
        group={group}
        stateOf={() => ({ choice: null, flagged: false })}
        onChoice={() => undefined}
        onToggleFlag={() => undefined}
        activeBlank={2}
      />,
    );
    try {
      expect(mounted.container.querySelectorAll('[data-blank-block]')).toHaveLength(3);
      const activeMarker = mounted.container.querySelector('[data-blank="2"]');
      const idleMarker = mounted.container.querySelector('[data-blank="1"]');
      expect(activeMarker?.getAttribute('data-blank-active')).toBe('true');
      expect(idleMarker?.getAttribute('data-blank-active')).toBe('false');
      expect(activeMarker?.className).toContain('border-primary');
      expect(idleMarker?.className).toContain('border-text-3');
    } finally {
      mounted.unmount();
    }
  });

  it('解析回看页同样是整组呈现（正文一次 + 各空位对错）', async () => {
    await importExamJson(buildDialogueExamJson(), { paperId: PAPER_ID });
    const detail = await getPaperDetail(PAPER_ID);
    const attemptId = await useAttemptStore.getState().start({
      exam: detail.exam as NonNullable<typeof detail.exam>,
      passages: detail.passages,
      questions: detail.questions,
      mode: 'full',
      sectionType: null,
      timeLimitSec: 9000,
    });
    // 三题全选 A（第 1 题正确答案 B → 错；第 2 题 C → 错；第 3 题 D → 错）
    const state = useAttemptStore.getState();
    for (const question of state.questions.slice(0, 3)) {
      state.setChoice(question.id, 'A');
    }
    await state.submit();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`/attempt/${attemptId}/review`]}>
          <Routes>
            <Route path="/attempt/:id/review" element={<ReviewPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    try {
      // 等待异步加载（getAttempt + getPaperDetail + getAnswers）
      const deadline = Date.now() + 8000;
      while ((container.querySelectorAll('[data-blank-block]') ?? []).length === 0) {
        if (Date.now() > deadline) {
          throw new Error('解析回看页未渲染口语组');
        }
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }
      expect(container.querySelectorAll('[data-blank-block]')).toHaveLength(3);
      // 左侧题目列表逐题列出 stem，故只在「对话正文」那段里数：同一句只能出现一次
      const scriptNode = Array.from(container.querySelectorAll('p')).find((node) =>
        (node.textContent ?? '').includes("That's boring"),
      );
      expect((scriptNode?.textContent ?? '').split("That's boring").length - 1).toBe(1);
      // 只读模式下选项禁用 + 标出对错
      expect(container.querySelectorAll('button[role="radio"][disabled]').length).toBeGreaterThan(0);
      expect(container.textContent).toContain(EXAMS.reviewWrong);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});

describe('T16 ②：词汇题考点词高亮', () => {
  const vocabQuestion: Question = {
    id: 't16-v1',
    paperId: PAPER_ID,
    sectionType: 'vocabulary',
    passageId: null,
    seq: 11,
    stem: 'The supply of silver in the mine had diminished, causing great concern.',
    blankIndex: null,
    options: [
      { key: 'A', text: 'expired' },
      { key: 'B', text: 'declined' },
    ],
    answerKey: 'B',
    referenceAnswer: null,
    explanation: '【解析】句中词 diminished 减少;削弱。',
    score: 1,
    isObjective: true,
    updatedAt: 0,
    deletedAt: null,
  };

  it('命中解析里的「句中词」时加粗 + 主题色 + 下划线', () => {
    const mounted = mount(<QuestionView question={vocabQuestion} />);
    try {
      const target = mounted.container.querySelector('strong[data-vocab-target="true"]');
      expect(target).not.toBeNull();
      expect(target?.textContent).toBe('diminished');
      expect(target?.className).toContain('font-bold');
      expect(target?.className).toContain('text-exam-target');
      expect(target?.className).toContain('underline');
    } finally {
      mounted.unmount();
    }
  });

  it('无解析线索（回忆版）不标注，题干原样输出', () => {
    const mounted = mount(
      <QuestionView question={{ ...vocabQuestion, explanation: '【解析】通读句子可知选 B。' }} />,
    );
    try {
      expect(mounted.container.querySelector('[data-vocab-target]')).toBeNull();
      expect(mounted.container.textContent).toContain(vocabQuestion.stem);
    } finally {
      mounted.unmount();
    }
  });
});

describe('T16 ③：完形空位长下划线', () => {
  const passage: Passage = {
    id: 't16-p-cloze',
    paperId: PAPER_ID,
    sectionType: 'cloze',
    order: 1,
    content: 'A hard drive is a storage device. It 46 computing over a network of 47 nodes.',
    updatedAt: 0,
    deletedAt: null,
  };

  it('空位数字渲染成长下划线，当前空主题色', () => {
    const mounted = mount(
      <PassageView
        passage={passage}
        defaultCollapsed={false}
        blankNumbers={new Set([46, 47])}
        activeBlank={46}
      />,
    );
    try {
      const active = mounted.container.querySelector('[data-blank="46"]');
      const idle = mounted.container.querySelector('[data-blank="47"]');
      expect(active).not.toBeNull();
      expect(idle).not.toBeNull();
      expect(active?.className).toContain('inline-flex');
      expect(active?.className).toContain('border-b-2');
      expect(active?.className).toContain('min-w-[3.25rem]');
      expect(active?.textContent).toBe('46');
      expect(active?.className).toContain('border-primary');
      expect(idle?.className).toContain('border-text-3');
      // 正文里的普通数字（network 这类无数字）不受影响：原文完整保留
      expect((mounted.container.textContent ?? '').replace(/\s+/g, ' ')).toContain(
        'A hard drive is a storage device.',
      );
    } finally {
      mounted.unmount();
    }
  });
});
