/**
 * T14/T15 全链路页面测试：
 * 组卷（整卷/专项）→ 答题页（选择 / 快捷键 / 3s 落库 / 刷新恢复 / 暂停蒙层）
 * → 答题卡（77 格三态跳题 / 只看标记）→ 交卷 → 成绩单（三段分值 + 自评合并）
 * → 解析回看（选词入生词本）→ 错题本（筛选 + 重做 resolved）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACTIONS, EXAMS } from '@/constants';
import { db } from '@/db';
import { getPaperDetail } from '@/db/repos/examRepo';
import { getAnswers, getAttempt } from '@/db/repos/attemptRepo';
import { listExams, upsertExam } from '@/db/repos/examRepo';
import { countPending, listPending } from '@/db/repos/wrongRepo';
import AnswerSheetPage from './AnswerSheetPage';
import AttemptPage from './AttemptPage';
import ExamStartPage from './ExamStartPage';
import ResultPage from './ResultPage';
import ReviewPage from './ReviewPage';
import WrongBookPage from './WrongBookPage';
import { buildStandardExamJson, standardAnswerKeyOf } from '@/test/fixtures/examJsonFixture';
import { importExamJson } from '@/db/seed';
import { useAttemptStore } from '@/store/attemptStore';
import { useUiStore } from '@/store/uiStore';
import type { Exam } from '@/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAPER_ID = 'flow-paper';

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
  // jsdom 未实现（Sheet 开关 / PassageView 滚动定位会触发）
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = function scrollIntoView(): void {};
  }
});

beforeEach(async () => {
  window.localStorage.clear();
  useAttemptStore.getState().reset();
  useUiStore.setState({ toasts: [] });
  vi.useRealTimers();
  const exams = await listExams();
  if (!exams.some((exam) => exam.id === PAPER_ID)) {
    await importExamJson(buildStandardExamJson('全链路测试卷'), { paperId: PAPER_ID });
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(check: () => T | Promise<T>, label: string): Promise<T> {
  const deadline = Date.now() + 8000;
  let value = await check();
  while (!value) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor 超时: ${label}`);
    }
    await act(async () => {
      await sleep(10);
    });
    value = await check();
  }
  return value;
}

interface Mounted {
  container: HTMLElement;
  unmount: () => void;
}

function mountFlow(initialPath: string): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/exams/:id/start" element={<ExamStartPage />} />
          <Route path="/attempt/:id" element={<AttemptPage />} />
          <Route path="/attempt/:id/subjective" element={<AttemptPage />} />
          <Route path="/attempt/:id/sheet" element={<AnswerSheetPage />} />
          <Route path="/attempt/:id/result" element={<ResultPage />} />
          <Route path="/attempt/:id/review" element={<ReviewPage />} />
          <Route path="/wrong" element={<WrongBookPage />} />
        </Routes>
      </MemoryRouter>,
    );
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

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 快捷键：target 传入实际聚焦元素（useHotkeys 对输入目标会忽略） */
function pressKey(key: string, target: HTMLElement | Window = window): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('T14/T15：整卷模拟全链路', () => {
  it('组卷 → 答题 → 落库恢复 → 交卷 → 成绩 → 自评 → 解析 → 错题本', async () => {
    const page = mountFlow(`/exams/${PAPER_ID}/start`);
    try {
      // ---- 组卷页 ----
      await waitFor(() => (page.container.textContent ?? '').includes(EXAMS.beginAttempt), '组卷页');
      act(() => {
        findButton(page.container, EXAMS.beginAttempt).click();
      });

      // ---- 答题页 ----
      await waitFor(() => useAttemptStore.getState().status === 'active', '进入答题');
      const attemptId = useAttemptStore.getState().attemptId as string;
      await waitFor(() => page.container.querySelector('[role="radiogroup"]') !== null, '选项渲染');

      const state0 = useAttemptStore.getState();
      const q1Id = (state0.questions[0] as { id: string }).id;
      const q2Id = (state0.questions[1] as { id: string }).id;

      // 第 1 题快捷键 2 选 B（第 1 题正确答案 = B）
      pressKey('2');
      expect(useAttemptStore.getState().answers[q1Id]?.choice).toBe('B');
      // F 标记当前题
      pressKey('f');
      expect(useAttemptStore.getState().answers[q1Id]?.flagged).toBe(true);

      // 第 2 题（口语交际）：整组同页渲染，切到第 2 题后点击其选项（正确答案 C）
      act(() => {
        useAttemptStore.getState().setCurrentSeq(2);
      });
      await waitFor(
        () => page.container.querySelector('[role="radiogroup"][aria-label="第 2 题选项"]') !== null,
        '第 2 题渲染',
      );
      act(() => {
        findButton(page.container, '选项 C-2').click();
      });
      expect(useAttemptStore.getState().answers[q2Id]?.choice).toBe('C');

      // 主观题（第 76 题英译汉）：聚焦输入框时快捷键忽略
      const translation = (useAttemptStore.getState().questions[75] as { id: string }).id;
      act(() => {
        useAttemptStore.getState().setCurrentSeq(76);
      });
      const textarea = (await waitFor(
        () => page.container.querySelector('textarea[aria-label*="76"]') as HTMLTextAreaElement | null,
        '主观题文本域',
      )) as HTMLTextAreaElement;
      textarea.focus();
      act(() => {
        setInputValue(textarea, '我的译文');
      });
      pressKey('1', textarea); // 输入框聚焦：不触发选择
      expect(useAttemptStore.getState().answers[translation]?.choice ?? null).toBeNull();
      expect(useAttemptStore.getState().answers[translation]?.text).toBe('我的译文');

      // 3s 落库：页面 interval 每 1s tick，tick 内按 3s 节流 flush
      await act(async () => {
        await sleep(3400);
      });
      const savedRows = await getAnswers(attemptId);
      expect(savedRows.length).toBeGreaterThanOrEqual(3);
      expect(savedRows.find((row) => row.questionId === translation)?.text).toBe('我的译文');

      // 刷新恢复：彻底重置内存（模拟杀进程），重新挂载
      useAttemptStore.getState().reset();
      page.unmount();
      const page2 = mountFlow(`/attempt/${attemptId}`);
      try {
        await waitFor(() => useAttemptStore.getState().status === 'active', '刷新后恢复');
        const restored = useAttemptStore.getState().answers;
        expect(restored[q1Id]?.choice).toBe('B');
        expect(restored[q1Id]?.flagged).toBe(true);
        expect(restored[translation]?.text).toBe('我的译文');
        expect(useAttemptStore.getState().remainingSec).toBeGreaterThan(8900);

        // ---- 答题卡抽屉（Sheet 传送门在 document.body）----
        act(() => {
          findButton(page2.container, EXAMS.attemptSheet).click();
        });
        await waitFor(
          () => document.body.querySelector('button[aria-label="跳到第 77 题"]') !== null,
          '答题卡抽屉',
        );
        const cell77 = document.body.querySelector(
          'button[aria-label="跳到第 77 题"]',
        ) as HTMLButtonElement;
        expect(cell77.textContent).toBe(EXAMS.sheetSubjectiveWriting);
        expect(
          document.body.querySelectorAll('[role="dialog"] button[aria-label^="跳到第"]'),
        ).toHaveLength(77);
        act(() => {
          (
            document.body.querySelector('button[aria-label="跳到第 50 题"]') as HTMLButtonElement
          ).click();
        });
        expect(useAttemptStore.getState().currentSeq).toBe(50);

        // ---- 交卷确认 ----
        act(() => {
          findButton(page2.container, EXAMS.attemptSubmit).click();
        });
        expect(page2.container.querySelector('dialog[open]')).not.toBeNull();
        act(() => {
          findButton(page2.container, ACTIONS.confirm).click();
        });
        await waitFor(() => useAttemptStore.getState().status === 'submitted', '交卷完成');

        // 判分：第 1 题 B 对、第 2 题 C 对，其余客观题未答按错 → 客观 2 分
        const attemptRow = await getAttempt(attemptId);
        expect(attemptRow?.objectiveScore).toBe(2);
        expect(attemptRow?.totalScore).toBe(2);
        expect(await countPending()).toBe(73); // 75 客观 - 2 对
      } finally {
        page2.unmount();
      }

      // ---- 成绩单：三段分值 + 自评合并 ----
      const page3 = mountFlow(`/attempt/${attemptId}/result`);
      try {
        await waitFor(
          () => (page3.container.textContent ?? '').includes(EXAMS.resultObjective),
          '成绩单',
        );
        expect(page3.container.textContent).toContain('/75');
        expect(page3.container.textContent).toContain('/25');
        expect(page3.container.textContent).toContain('/100');
        expect(page3.container.textContent).toContain(EXAMS.resultSectionBreakdown);

        const evalTranslation = page3.container.querySelector('#eval-std-q76') as HTMLInputElement;
        const evalWriting = page3.container.querySelector('#eval-std-q77') as HTMLInputElement;
        expect(evalTranslation).not.toBeNull();
        expect(evalWriting).not.toBeNull();
        act(() => {
          setInputValue(evalTranslation, '7');
        });
        act(() => {
          setInputValue(evalWriting, '12');
        });
        act(() => {
          findButton(page3.container, EXAMS.resultSelfEvalSave).click();
        });
        await waitFor(
          async () => (await getAttempt(attemptId))?.totalScore === 21,
          '总分合并 2+19',
        );
        expect((await getAttempt(attemptId))?.totalScore).toBe(21);
        expect((await getAttempt(attemptId))?.subjectiveScore).toBe(19);
      } finally {
        page3.unmount();
      }

      // ---- 解析回看：选词加入生词本 ----
      const page4 = mountFlow(`/attempt/${attemptId}/review`);
      try {
        await waitFor(
          () => (page4.container.textContent ?? '').includes('Question 1'),
          '解析页渲染',
        );
        // 第 1 题是口语交际（DialogueGroupView 渲染对话，不走划词高亮），
        // 先切到第 21 题（阅读第 1 题）：题干支持划词高亮
        act(() => {
          findButton(page4.container, 'Question 21').click();
        });
        await waitFor(
          () => (page4.container.textContent ?? '').includes('Question 21'),
          '阅读题渲染',
        );
        const stemNode = Array.from(page4.container.querySelectorAll('p')).find((p) =>
          (p.textContent ?? '').includes('Question 21'),
        );
        expect(stemNode).not.toBeNull();
        // 划词高亮渲染后，题干文本包在分段 span 里，向下递归取第一个非空文本节点
        function firstTextNode(node: Node): Node | null {
          if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').length > 0) {
            return node;
          }
          for (const child of Array.from(node.childNodes)) {
            const found = firstTextNode(child);
            if (found) {
              return found;
            }
          }
          return null;
        }
        const textNode = firstTextNode(stemNode as Node);
        expect(textNode?.textContent ?? '').toContain('Question');
        const range = document.createRange();
        range.setStart(textNode as Node, 0);
        range.setEnd(textNode as Node, 8); // "Question"
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        // mouseup 必须派发到 React 树内的元素上，才能冒泡到页面的 onMouseUp
        act(() => {
          (stemNode as HTMLElement).dispatchEvent(
            new MouseEvent('mouseup', { bubbles: true }),
          );
        });
        const popupBtn = (await waitFor(
          () =>
            Array.from(page4.container.querySelectorAll('button')).find((button) =>
              (button.textContent ?? '').includes(EXAMS.examHighlightAddWord),
            ) ?? false,
          '选词浮层按钮',
        )) as HTMLButtonElement;
        act(() => {
          popupBtn.click();
        });
        await waitFor(async () => (await db.notebook.count()) === 1, '生词本写入');
        const entries = await db.notebook.toArray();
        expect(entries).toHaveLength(1);
        const entry = entries[0] as (typeof entries)[number];
        expect(entry.headword.toLowerCase()).toBe('question');
        expect(entry.source).toBe('imported');
      } finally {
        page4.unmount();
      }

      // ---- 错题本：列表 + 重做 resolved ----
      const page5 = mountFlow('/wrong');
      try {
        await waitFor(() => (page5.container.textContent ?? '').includes('Question'), '错题本列表');
        expect(await countPending()).toBe(73);

        const wrongItem = (await listPending()).find((item) => item.sectionType === 'dialogue');
        expect(wrongItem).toBeDefined();
        // 按目标题的题干前缀定位卡片（避免 Question 3 误匹配 Question 3x）
        const { getQuestions } = await import('@/db/repos/examRepo');
        const wrongQuestion = (await getQuestions(PAPER_ID)).find(
          (question) => question.id === wrongItem?.questionId,
        );
        expect(wrongQuestion).toBeDefined();
        const stemPrefix = (wrongQuestion as { stem: string }).stem.slice(0, 12);
        const card = Array.from(page5.container.querySelectorAll('li')).find((li) =>
          (li.textContent ?? '').includes(stemPrefix),
        );
        expect(card).toBeDefined();
        const redoBtn = Array.from(card?.querySelectorAll('button') ?? []).find(
          (button) =>
            (button.textContent ?? '').includes(EXAMS.wrongRedo) &&
            !(button.textContent ?? '').includes(EXAMS.wrongRedoBatch),
        ) as HTMLButtonElement;
        act(() => {
          redoBtn.click();
        });
        await waitFor(() => useAttemptStore.getState().status === 'active', '重开答题');
        const redoAttemptId = useAttemptStore.getState().attemptId as string;
        expect(useAttemptStore.getState().questions).toHaveLength(1);
        const q3 = useAttemptStore.getState().questions[0] as { id: string; seq: number };
        expect(q3.id).toBe(wrongItem?.questionId); // 重做的确是目标题
        act(() => {
          useAttemptStore.getState().setChoice(q3.id, standardAnswerKeyOf(q3.seq)); // 答对
        });
        await useAttemptStore.getState().flush();
        await useAttemptStore.getState().submit();
        expect((await getAttempt(redoAttemptId))?.objectiveScore).toBe(1);
        await waitFor(async () => (await countPending()) === 72, 'resolved 移出');
        const pendingAfter = await listPending();
        expect(pendingAfter.find((item) => item.questionId === q3.id)).toBeUndefined();
      } finally {
        page5.unmount();
      }
    } finally {
      page.unmount();
    }
  });
});

describe('T14：专项组卷', () => {
  it('专项：选题型 + 题量 + 不限时 → 抽题数正确', async () => {
    const page = mountFlow(`/exams/${PAPER_ID}/start`);
    try {
      await waitFor(() => (page.container.textContent ?? '').includes(EXAMS.modeSection), '组卷页');
      act(() => {
        findButton(page.container, EXAMS.modeSection).click();
      });
      act(() => {
        findButton(page.container, '阅读理解').click();
      });
      act(() => {
        findButton(page.container, EXAMS.sectionTimedOn).click(); // 当前为限时(开)，点击切到不限时
      });
      act(() => {
        findButton(page.container, EXAMS.beginAttempt).click();
      });
      await waitFor(() => useAttemptStore.getState().status === 'active', '进入答题');
      const state = useAttemptStore.getState();
      expect(state.questions).toHaveLength(10);
      expect(state.questions.every((question) => question.sectionType === 'reading')).toBe(true);
      expect(state.meta?.deadlineTs).toBeNull(); // 不限时
    } finally {
      page.unmount();
    }
  });

  it('未 verified 卷组卷页弹确认框而非拦截', async () => {
    const exam = (await listExams())[0] as Exam;
    await upsertExam({ ...exam, parseStatus: 'parsed' });
    const page = mountFlow(`/exams/${PAPER_ID}/start`);
    try {
      await waitFor(
        () => (page.container.textContent ?? '').includes(EXAMS.beginAttempt),
        '组卷页渲染',
      );
      expect(page.container.textContent).not.toContain(EXAMS.startBlocked);
      const beginButton = Array.from(page.container.querySelectorAll('button')).find((button) =>
        (button.textContent ?? '').includes(EXAMS.beginAttempt),
      ) as HTMLButtonElement;
      act(() => {
        beginButton.click();
      });
      await waitFor(
        () => (page.container.textContent ?? '').includes(EXAMS.startConfirmAnyway),
        '开考确认框',
      );
    } finally {
      page.unmount();
    }
  });
});

describe('T14：答题卡独立页', () => {
  it('77 格渲染 + 点击跳回答题页（?q= 恢复题位）', async () => {
    const detail = await getPaperDetail(PAPER_ID);
    const attemptId = await useAttemptStore.getState().start({
      exam: detail.exam as NonNullable<typeof detail.exam>,
      passages: detail.passages,
      questions: detail.questions,
      mode: 'full',
      sectionType: null,
      timeLimitSec: 9000,
    });
    useAttemptStore.getState().reset(); // 模拟「答题卡页是新入口」
    const page = mountFlow(`/attempt/${attemptId}/sheet`);
    try {
      await waitFor(
        () => page.container.querySelectorAll('button[aria-label^="跳到第"]').length === 77,
        '答题卡 77 格',
      );
      const cells = page.container.querySelectorAll('button[aria-label^="跳到第"]');
      expect(cells).toHaveLength(77);
      act(() => {
        (page.container.querySelector('button[aria-label="跳到第 33 题"]') as HTMLButtonElement).click();
      });
      // 跳回答题页后 ?q=33 恢复题位
      await waitFor(() => useAttemptStore.getState().currentSeq === 33, '跳题恢复');
    } finally {
      page.unmount();
    }
  });
});
