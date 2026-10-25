/**
 * T13 页面测试：试卷库 / 录入页 / 校对页。
 *
 * - ExamsPage：状态徽标（草稿/待校对/可模拟）；未 verified 卷「开始模拟」拦截；
 * - ExamEditPage：粘贴 77 题文本自动切题 → 跳校对页；手动录入草稿刷新恢复；
 *   非法 answerKey JSON 错误清单（带字段路径）且零写入；
 * - ParseReviewPage：7 区段全列出（10/10/25/10/20/1/1）；拖题改区段；
 *   确认保存 → parseStatus='verified'。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EXAMS } from '@/constants';
import { db } from '@/db';
import { getExam, getQuestions, upsertExam } from '@/db/repos/examRepo';
import { importExamJson } from '@/db/seed';
import ExamEditPage from './ExamEditPage';
import ExamsPage from './ExamsPage';
import ParseReviewPage from './ParseReviewPage';
import { buildStandardExamJson } from '@/test/fixtures/examJsonFixture';
import { PAPER_2013_TEXT } from '@/test/fixtures/paperText';
import { useParseDraftStore } from '@/store/parseDraftStore';
import { useUiStore } from '@/store/uiStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
});

beforeEach(() => {
  window.localStorage.clear();
  useParseDraftStore.getState().clear();
  useUiStore.setState({ toasts: [] });
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

/** 挂载 试卷库→录入→校对 联动路由 */
function mountExamRoutes(initialPath: string, startCapture?: { path: string | null }): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  function Capture(): null {
    const location = useLocation();
    if (startCapture) {
      startCapture.path = location.pathname;
    }
    return null;
  }
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/exams" element={<ExamsPage />} />
          <Route path="/exams/:id/edit" element={<ExamEditPage />} />
          <Route path="/exams/:id/review-parse" element={<ParseReviewPage />} />
          <Route path="/exams/:id/start" element={<Capture />} />
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

/** 把标准卷 JSON 导入并降级为 parsed（走校对流程用） */
async function seedParsedPaper(paperId: string, title: string): Promise<void> {
  await importExamJson(buildStandardExamJson(title), { paperId });
  const exam = (await getExam(paperId)) as NonNullable<Awaited<ReturnType<typeof getExam>>>;
  await upsertExam({ ...exam, parseStatus: 'parsed' });
}

describe('ExamsPage：试卷库', () => {
  it('列表不展示解析状态与缺答案徽标；未校对卷也能进入组卷页', async () => {
    await importExamJson(buildStandardExamJson('可模拟卷'), { paperId: 'ok-paper' });
    await seedParsedPaper('parsed-paper', '待校对卷');
    const capture = { path: null as string | null };
    const page = mountExamRoutes('/exams', capture);
    try {
      await waitFor(() => (page.container.textContent ?? '').includes('可模拟卷'), '列表渲染');
      // 状态列已移除：表头不含「状态」，也没有缺答案徽标
      const headers = Array.from(page.container.querySelectorAll('th')).map(
        (th) => th.textContent ?? '',
      );
      expect(headers).not.toContain('状态');
      expect(page.container.textContent).not.toContain('缺答案');

      const rows = Array.from(page.container.querySelectorAll('tr'));
      const parsedRow = rows.find((row) => (row.textContent ?? '').includes('待校对卷'));
      expect(parsedRow).toBeDefined();
      const startBtn = Array.from(parsedRow?.querySelectorAll('button') ?? []).find((button) =>
        (button.textContent ?? '').includes(EXAMS.startMock),
      ) as HTMLButtonElement;
      act(() => {
        startBtn.click();
      });
      // 拦截已下沉到组卷页确认框：列表页直接跳转
      await waitFor(() => (capture.path !== null && capture.path.includes('/start') ? capture.path : false), '跳转组卷页');
      expect(capture.path).toBe('/exams/parsed-paper/start');
    } finally {
      page.unmount();
    }
  });

  it('verified 卷「开始模拟」跳转组卷页', async () => {
    await importExamJson(buildStandardExamJson('可模拟卷 B'), { paperId: 'ok-paper-2' });
    const capture = { path: null as string | null };
    const page = mountExamRoutes('/exams', capture);
    try {
      await waitFor(() => (page.container.textContent ?? '').includes('可模拟卷 B'), '列表渲染');
      const row = Array.from(page.container.querySelectorAll('tr')).find((row) =>
        (row.textContent ?? '').includes('可模拟卷 B'),
      );
      const startBtn = Array.from(row?.querySelectorAll('button') ?? []).find((button) =>
        (button.textContent ?? '').includes(EXAMS.startMock),
      ) as HTMLButtonElement;
      act(() => {
        startBtn.click();
      });
      await waitFor(() => (capture.path !== null && capture.path.includes('/start') ? capture.path : false), '跳转组卷页');
      expect(capture.path).toBe('/exams/ok-paper-2/start');
    } finally {
      page.unmount();
    }
  });
});

describe('ExamEditPage：粘贴切题与手动录入', () => {
  it('粘贴 77 题文本 → 自动切题 → 跳校对页且整卷落库（parseStatus=parsed）', async () => {
    const page = mountExamRoutes('/exams/new/edit');
    try {
      await waitFor(() => page.container.querySelector('#paste-input') !== null, '粘贴框出现');
      const textarea = page.container.querySelector('#paste-input') as HTMLTextAreaElement;
      act(() => {
        setInputValue(textarea, PAPER_2013_TEXT);
      });
      expect(page.container.textContent).toContain(EXAMS.charCount(PAPER_2013_TEXT.length));

      act(() => {
        findButton(page.container, EXAMS.autoSplit).click();
      });
      await waitFor(
        () => (page.container.textContent ?? '').includes(EXAMS.reviewTitle),
        '进入校对页',
      );
      const pastedExamId = (await db.exams.toArray()).find((exam) => exam.source === 'pasted')?.id ?? '';
      const exam = await getExam(pastedExamId);
      expect(exam?.parseStatus).toBe('parsed');
      expect(exam?.totalQuestions).toBe(77);
    } finally {
      page.unmount();
    }
  });

  it('手动录入 3 题后强制刷新，重新进入草稿不丢', async () => {
    const page = mountExamRoutes('/exams/new/edit');
    try {
      await waitFor(() => page.container.querySelector('#paste-input') !== null, '录入页出现');
      act(() => {
        findButton(page.container, EXAMS.tabManual).click();
      });
      await waitFor(() => page.container.querySelector('#manual-title') !== null, '手动表单出现');
      const title = page.container.querySelector('#manual-title') as HTMLInputElement;
      act(() => {
        setInputValue(title, '我的手录卷');
      });
      for (let index = 1; index <= 3; index += 1) {
        const stem = page.container.querySelector('#manual-stem') as HTMLTextAreaElement;
        act(() => {
          setInputValue(stem, `手动题干 ${index}`);
        });
        // 客观题需至少一个选项（答案校验要求 answerKey ∈ options）
        const optionA = page.container.querySelector(
          'input[aria-label="选项 A"]',
        ) as HTMLInputElement;
        act(() => {
          setInputValue(optionA, `选项 A 内容 ${index}`);
        });
        act(() => {
          findButton(page.container, EXAMS.saveAndNext).click();
        });
      }
      expect(page.container.textContent).toContain('（3）');

      // 强制刷新：卸载后重新挂载
      page.unmount();
      const page2 = mountExamRoutes('/exams/new/edit');
      try {
        await waitFor(() => page2.container.querySelector('#paste-input') !== null, '重新进入');
        act(() => {
          findButton(page2.container, EXAMS.tabManual).click();
        });
        await waitFor(
          () => (page2.container.textContent ?? '').includes('（3）'),
          '草稿恢复 3 题',
        );
        // input 的 value 不进 textContent，单独断言标题输入框
        const title2 = page2.container.querySelector('#manual-title') as HTMLInputElement;
        expect(title2.value).toBe('我的手录卷');
      } finally {
        page2.unmount();
      }
    } finally {
      page.unmount();
    }
  });

  it('导入 answerKey 非法的 JSON：错误清单带字段路径，且不写入任何数据', async () => {
    const examsBefore = await db.exams.count();
    const questionsBefore = await db.questions.count();
    const page = mountExamRoutes('/exams/new/edit');
    try {
      await waitFor(() => page.container.querySelector('#paste-input') !== null, '录入页出现');
      act(() => {
        findButton(page.container, EXAMS.tabJson).click();
      });
      const input = page.container.querySelector('input[type="file"]') as HTMLInputElement;
      const bad = buildStandardExamJson('坏答案卷');
      (bad.questions[3] as { answerKey: string }).answerKey = 'Z';
      const raw = JSON.stringify(bad);
      const file = new File([raw], 'bad.json', { type: 'application/json' });
      // jsdom 未实现 Blob.text()，打桩返回原内容
      Object.defineProperty(file, 'text', { value: async () => raw });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(50);
      });
      await waitFor(
        () => (page.container.textContent ?? '').includes('questions[3].answerKey'),
        '错误清单出现',
      );
      expect(await db.exams.count()).toBe(examsBefore);
      expect(await db.questions.count()).toBe(questionsBefore);
    } finally {
      page.unmount();
    }
  });
});

describe('ParseReviewPage：校对', () => {
  it('7 区段全列出且题量 10/10/25/10/20/1/1；确认保存 → verified', async () => {
    await seedParsedPaper('review-paper', '校对流卷');

    // 模拟来自录入页的跳转：注入原文与草稿
    const { parsePastedPaper } = await import('@/lib/exam/parse/buildDraft');
    const { draft } = parsePastedPaper(PAPER_2013_TEXT);
    useParseDraftStore.getState().setDraft('review-paper', PAPER_2013_TEXT, draft);

    const page = mountExamRoutes('/exams/review-paper/review-parse');
    try {
      await waitFor(
        () => page.container.querySelector('[data-section="dialogue"]') !== null,
        '结构树渲染',
      );
      for (const name of ['口语交际', '词汇', '阅读理解', '完形填空', '短文完成', '英译汉', '写作']) {
        expect(page.container.textContent).toContain(name);
      }
      const counts = [
        'dialogue',
        'vocabulary',
        'reading',
        'cloze',
        'short-completion',
        'translation',
        'writing',
      ].map((section) => page.container.querySelectorAll(`[data-section="${section}"] li`).length);
      expect(counts).toEqual([10, 10, 25, 10, 20, 1, 1]);
      expect(page.container.textContent).toContain(EXAMS.reviewNoUnresolved);

      act(() => {
        findButton(page.container, EXAMS.reviewConfirmSave).click();
      });
      await waitFor(() => (getExam('review-paper').then((exam) => exam?.parseStatus === 'verified') as unknown as boolean), 'verified');
      expect((await getExam('review-paper'))?.parseStatus).toBe('verified');
    } finally {
      page.unmount();
    }
  });

  it('拖动题目到另一区段 → 保存后 sectionType 随之改变', async () => {
    await seedParsedPaper('drag-paper', '拖拽卷');
    const page = mountExamRoutes('/exams/drag-paper/review-parse');
    try {
      await waitFor(
        () => page.container.querySelector('[data-section="dialogue"]') !== null,
        '结构树渲染',
      );
      const draggable = page.container.querySelector(
        '[data-section="dialogue"] button[draggable="true"]',
      ) as HTMLElement;
      const target = page.container.querySelector('[data-section="vocabulary"]') as HTMLElement;
      // 分开 act：dragstart 的 state（draggingId）必须先 flush，drop 闭包才能读到
      act(() => {
        draggable.dispatchEvent(new Event('dragstart', { bubbles: true }));
      });
      act(() => {
        target.dispatchEvent(new Event('dragover', { bubbles: true }));
      });
      act(() => {
        target.dispatchEvent(new Event('drop', { bubbles: true }));
      });
      act(() => {
        draggable.dispatchEvent(new Event('dragend', { bubbles: true }));
      });
      act(() => {
        findButton(page.container, EXAMS.reviewConfirmSave).click();
      });
      await waitFor(() => (getExam('drag-paper').then((exam) => exam?.parseStatus === 'verified') as unknown as boolean), 'verified');
      const questions = await getQuestions('drag-paper');
      const q1 = questions.find((question) => question.seq === 1);
      expect(q1?.sectionType).toBe('vocabulary');
      expect(questions.filter((question) => question.sectionType === 'vocabulary')).toHaveLength(11);
    } finally {
      page.unmount();
    }
  });
});
