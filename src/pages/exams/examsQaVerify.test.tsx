/**
 * QA 二层验证（T11-T15 真题模块）：用真实管线产物 2013 年真题 JSON 做 UI 闭环实测。
 *
 * A. 导入真题 → 试卷库可见且 verified → 组卷页不拦截 → 开始模拟；
 * B. 整卷流：答题（对/错/标记/答题卡跳题）→ 暂停冻结/恢复 → 刷新恢复
 *    → 交卷 → 成绩单客观分 → 错题本 → 重做答对 resolved；
 * C. 边界反例：超时自动交卷、未 verified 拦截、非法 JSON 零写入、
 *    倒计时剩 5 分钟变红（含 300s 边界）。
 *
 * 数据源：public/data/exams/2013.json（77 题 / 75 客观 ×1 分 / 限时 9000s）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ACTIONS, EXAMS } from '@/constants';
import { db } from '@/db';
import { listExams, upsertExam } from '@/db/repos/examRepo';
import { getAnswers, getAttempt } from '@/db/repos/attemptRepo';
import { countPending, listPending } from '@/db/repos/wrongRepo';
import { importExamJson } from '@/db/seed';
import { Countdown } from '@/components/exam/Countdown';
import AnswerSheetPage from './AnswerSheetPage';
import AttemptPage from './AttemptPage';
import ExamStartPage from './ExamStartPage';
import ResultPage from './ResultPage';
import WrongBookPage from './WrongBookPage';
import { useAttemptStore } from '@/store/attemptStore';
import { useUiStore } from '@/store/uiStore';
import type { AppError } from '@/lib/errors';
import type { ExamJsonFile } from '@/lib/importers/examJson';
import type { Exam } from '@/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAPER_ID = 'qa-exam-2013';
const RAW_2013: ExamJsonFile = JSON.parse(
  readFileSync(join(process.cwd(), 'public', 'data', 'exams', '2013.json'), 'utf-8'),
) as ExamJsonFile;

/** 真实 2013 卷的答案速查：seq → answerKey */
const REAL_ANSWER = new Map<number, string>(
  RAW_2013.questions.map((q) => [q.seq, q.answerKey as string]),
);

async function importRealExam(): Promise<void> {
  const exams = await listExams();
  if (!exams.some((exam) => exam.id === PAPER_ID)) {
    await importExamJson(RAW_2013, { paperId: PAPER_ID });
  }
}

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

beforeEach(async () => {
  window.localStorage.clear();
  useAttemptStore.getState().reset();
  useUiStore.setState({ toasts: [] });
  await importRealExam();
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

/**
 * 点击指定题号的选项。
 *
 * 口语交际整组同页渲染后，页面会同时存在多道口语题的选项，
 * 因此必须按 `aria-label="第 N 题选项"` 的 radiogroup 限定范围再找字母。
 */
function clickChoice(container: HTMLElement, key: string, seq: number): void {
  const group = container.querySelector(`[role="radiogroup"][aria-label="第 ${seq} 题选项"]`);
  if (!group) {
    throw new Error(`未找到第 ${seq} 题的选项组`);
  }
  const radios = Array.from(group.querySelectorAll('[role="radio"]'));
  const target = radios.find(
    (radio) => (radio.querySelector('span')?.textContent ?? '') === key,
  );
  if (!target) {
    throw new Error(`未找到第 ${seq} 题的选项 ${key}`);
  }
  act(() => {
    (target as HTMLButtonElement).click();
  });
}

describe('B1：导入真题 → 试卷库 → 开始模拟', () => {
  it('2013.json 导入成功且 verified，组卷页不拦截、整卷 77 题开考', async () => {
    // ---- 试卷库可见且 verified ----
    const exams = await listExams();
    const imported = exams.find((exam) => exam.id === PAPER_ID);
    expect(imported).toBeDefined();
    expect(imported?.parseStatus).toBe('verified');
    expect(imported?.title).toContain('2013');
    expect(imported?.totalQuestions).toBe(77);
    expect(imported?.totalScore).toBe(100);
    expect(imported?.timeLimitSec).toBe(9000);
    // 落库题数与答案与 JSON 一致
    const questions = await db.questions.where('paperId').equals(PAPER_ID).toArray();
    expect(questions).toHaveLength(77);
    expect(questions.filter((q) => q.isObjective)).toHaveLength(75);
    expect(questions.every((q) => REAL_ANSWER.get(q.seq) === null || q.answerKey === REAL_ANSWER.get(q.seq))).toBe(
      true,
    );

    // ---- 组卷页不拦截 ----
    const page = mountFlow(`/exams/${PAPER_ID}/start`);
    try {
      await waitFor(() => (page.container.textContent ?? '').includes(EXAMS.beginAttempt), '组卷页');
      expect(page.container.textContent).not.toContain(EXAMS.startBlocked);
      act(() => {
        findButton(page.container, EXAMS.beginAttempt).click();
      });
      await waitFor(() => useAttemptStore.getState().status === 'active', '进入答题');
      const state = useAttemptStore.getState();
      expect(state.questions).toHaveLength(77);
      expect(state.meta?.deadlineTs).not.toBeNull(); // 整卷限时模式
    } finally {
      page.unmount();
    }
  });
});

describe('B2：整卷流（答题 → 暂停恢复 → 刷新恢复 → 交卷 → 成绩 → 错题重做）', () => {
  it('全链路：2 对 1 错 74 未答，客观分 2、错题入本、重做 resolved', async () => {
    const page = mountFlow(`/exams/${PAPER_ID}/start`);
    const page2Ref: { current: Mounted | null } = { current: null };
    let attemptId = '';
    try {
      await waitFor(() => (page.container.textContent ?? '').includes(EXAMS.beginAttempt), '组卷页');
      act(() => {
        findButton(page.container, EXAMS.beginAttempt).click();
      });
      await waitFor(() => useAttemptStore.getState().status === 'active', '进入答题');
      attemptId = useAttemptStore.getState().attemptId as string;
      const qIds = useAttemptStore.getState().questions.map((q) => ({ id: q.id, seq: q.seq }));
      const q1Id = qIds[0]!.id;
      const q2Id = qIds[1]!.id;
      const q3Id = qIds[2]!.id;

      // 第 1 题：答对 + 标记
      act(() => {
        clickChoice(page.container, REAL_ANSWER.get(1) as string, 1);
      });
      expect(useAttemptStore.getState().answers[q1Id]?.choice).toBe(REAL_ANSWER.get(1));
      act(() => {
        useAttemptStore.getState().toggleFlag(q1Id);
      });
      expect(useAttemptStore.getState().answers[q1Id]?.flagged).toBe(true);

      // 第 2 题：答错（选一个非答案字母）
      act(() => {
        useAttemptStore.getState().setCurrentSeq(2);
      });
      const wrongKey = REAL_ANSWER.get(2) === 'A' ? 'B' : 'A';
      act(() => {
        clickChoice(page.container, wrongKey, 2);
      });
      expect(useAttemptStore.getState().answers[q2Id]?.choice).toBe(wrongKey);

      // 答题卡抽屉：跳到第 3 题再答对
      act(() => {
        findButton(page.container, EXAMS.attemptSheet).click();
      });
      const cell3 = (await waitFor(
        () => document.body.querySelector('button[aria-label="跳到第 3 题"]') as HTMLButtonElement | null,
        '答题卡抽屉',
      )) as HTMLButtonElement;
      expect(document.body.querySelectorAll('[role="dialog"] button[aria-label^="跳到第"]')).toHaveLength(77);
      act(() => {
        cell3.click();
      });
      expect(useAttemptStore.getState().currentSeq).toBe(3);
      await waitFor(
        () => page.container.querySelector('[role="radiogroup"]') !== null,
        '第 3 题渲染',
      );
      act(() => {
        clickChoice(page.container, REAL_ANSWER.get(3) as string, 3);
      });

      // 暂停：倒计时冻结 → 恢复
      const before = useAttemptStore.getState().remainingSec;
      act(() => {
        useAttemptStore.getState().togglePause();
      });
      expect(useAttemptStore.getState().paused).toBe(true);
      await act(async () => {
        await sleep(1100);
      });
      expect(useAttemptStore.getState().remainingSec).toBe(before); // 冻结不流逝
      act(() => {
        useAttemptStore.getState().togglePause();
      });
      expect(useAttemptStore.getState().paused).toBe(false);
      expect(useAttemptStore.getState().remainingSec).toBeGreaterThan(8990);

      // 落库 → 模拟刷新（杀内存）→ 恢复
      await useAttemptStore.getState().flush();
      useAttemptStore.getState().reset();
      page.unmount();
      const page2 = mountFlow(`/attempt/${attemptId}`);
      page2Ref.current = page2;
      await waitFor(() => useAttemptStore.getState().status === 'active', '刷新后恢复');
      const restored = useAttemptStore.getState().answers;
      expect(restored[q1Id]?.choice).toBe(REAL_ANSWER.get(1));
      expect(restored[q1Id]?.flagged).toBe(true);
      expect(restored[q2Id]?.choice).toBe(wrongKey);
      expect(restored[q3Id]?.choice).toBe(REAL_ANSWER.get(3));

      // 交卷确认
      act(() => {
        findButton(page2.container, EXAMS.attemptSubmit).click();
      });
      expect(page2.container.querySelector('dialog[open]')).not.toBeNull();
      act(() => {
        findButton(page2.container, ACTIONS.confirm).click();
      });
      await waitFor(() => useAttemptStore.getState().status === 'submitted', '交卷完成');

      // 判分：2 对 ×1 分 = 2；75 客观 - 2 对 = 73 错题
      const attemptRow = await getAttempt(attemptId);
      expect(attemptRow?.objectiveScore).toBe(2);
      expect(attemptRow?.totalScore).toBe(2);
      expect(await countPending()).toBe(73);
      const savedRows = await getAnswers(attemptId);
      expect(savedRows.find((row) => row.questionId === q1Id)?.isCorrect).toBe(true);
      expect(savedRows.find((row) => row.questionId === q2Id)?.isCorrect).toBe(false);
    } finally {
      page.unmount();
      page2Ref.current?.unmount();
    }

    // ---- 成绩单：客观分 2/75、主观区 /25、总分 /100 ----
    const page3 = mountFlow(`/attempt/${attemptId}/result`);
    try {
      await waitFor(
        () => (page3.container.textContent ?? '').includes(EXAMS.resultObjective),
        '成绩单',
      );
      expect(page3.container.textContent).toContain('/75');
      expect(page3.container.textContent).toContain('/25');
      expect(page3.container.textContent).toContain('/100');
    } finally {
      page3.unmount();
    }

    // ---- 错题本：重做答对 → resolved ----
    const page4 = mountFlow('/wrong');
    try {
      await waitFor(() => (page4.container.textContent ?? '').includes('第'), '错题本列表');
      expect(await countPending()).toBe(73);
      const wrongItem = (await listPending()).find((item) => item.sectionType === 'vocabulary');
      expect(wrongItem).toBeDefined();
      const { getQuestions } = await import('@/db/repos/examRepo');
      const wrongQuestion = (await getQuestions(PAPER_ID)).find(
        (question) => question.id === wrongItem?.questionId,
      );
      expect(wrongQuestion).toBeDefined();
      const stemPrefix = (wrongQuestion as { stem: string }).stem.slice(0, 12);
      const card = Array.from(page4.container.querySelectorAll('li')).find((li) =>
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
      const redoQuestion = useAttemptStore.getState().questions[0]!;
      expect(redoQuestion.id).toBe(wrongItem?.questionId);
      act(() => {
        useAttemptStore.getState().setChoice(redoQuestion.id, redoQuestion.answerKey as string); // 答对
      });
      await useAttemptStore.getState().flush();
      await useAttemptStore.getState().submit();
      expect((await getAttempt(redoAttemptId))?.objectiveScore).toBe(1);
      await waitFor(async () => (await countPending()) === 72, 'resolved 移出');
      const pendingAfter = await listPending();
      expect(pendingAfter.find((item) => item.questionId === redoQuestion.id)).toBeUndefined();
    } finally {
      page4.unmount();
    }
  });
});

describe('B3：边界反例', () => {
  it('超时自动交卷：倒计时归零 tick() 自动 submit 且判分', async () => {
    const detail = await db.exams.get(PAPER_ID);
    const questions = await db.questions.where('paperId').equals(PAPER_ID).toArray();
    const attemptId = await useAttemptStore.getState().start({
      exam: detail as Exam,
      passages: [],
      questions,
      mode: 'full',
      sectionType: null,
      timeLimitSec: 1,
    });
    const q1 = useAttemptStore.getState().questions[0]!;
    act(() => {
      useAttemptStore.getState().setChoice(q1.id, q1.answerKey as string);
    });
    await act(async () => {
      await sleep(1100); // 越过 1s 时限
    });
    await useAttemptStore.getState().tick();
    const state = useAttemptStore.getState();
    expect(state.status).toBe('submitted');
    expect(state.timeoutSubmitted).toBe(true);
    expect(state.remainingSec).toBe(0);
    const row = await getAttempt(attemptId);
    expect(row?.submittedAt).not.toBeNull();
    expect(row?.objectiveScore).toBe(1); // 只答对 1 题
    expect(await countPending()).toBe(74);
  });

  it('未 verified 卷：开考前弹确认框，不直接开考', async () => {
    const exam = (await listExams()).find((e) => e.id === PAPER_ID) as Exam;
    await upsertExam({ ...exam, parseStatus: 'parsed' });
    const page = mountFlow(`/exams/${PAPER_ID}/start`);
    try {
      await waitFor(
        () => (page.container.textContent ?? '').includes(EXAMS.beginAttempt),
        '组卷页渲染',
      );
      // 不再展示拦截文案，组卷表单可用
      expect(page.container.textContent).not.toContain(EXAMS.startBlocked);
      act(() => {
        findButton(page.container, EXAMS.beginAttempt).click();
      });
      // 开考前先出确认框，此时还没建答卷
      await waitFor(
        () => (page.container.textContent ?? '').includes(EXAMS.startConfirmUnverified),
        '开考确认框',
      );
      expect(useAttemptStore.getState().status).not.toBe('active');
    } finally {
      page.unmount();
    }
  });

  it('非法 JSON 导入：抛 INVALID_INPUT（带字段路径）且零写入', async () => {
    const countBefore = {
      exams: await db.exams.count(),
      passages: await db.passages.count(),
      questions: await db.questions.count(),
    };
    expect(countBefore.exams).toBe(1); // beforeEach 导入的 2013 卷
    expect(countBefore.questions).toBe(77);

    const badPayloads: unknown[] = [
      42, // 根节点非对象
      { ...RAW_2013, schemaVersion: 2 }, // schemaVersion 非法
      {
        ...RAW_2013,
        questions: RAW_2013.questions.map((q) =>
          q.seq === 5 ? { ...q, answerKey: 'E' } : q, // 答案不在选项集合
        ),
      },
      {
        ...RAW_2013,
        questions: RAW_2013.questions.filter((q) => q.seq !== 40), // seq 断档
      },
      {
        ...RAW_2013,
        paper: { ...RAW_2013.paper, sections: RAW_2013.paper.sections.map((s) => ({ ...s, score: s.score + 1 })) }, // Σscore ≠ 100
      },
    ];
    for (const payload of badPayloads) {
      await expect(importExamJson(payload)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
    }
    // 错误信息带字段路径
    try {
      await importExamJson(badPayloads[2]);
    } catch (error) {
      const appError = error as AppError;
      const detail = Array.isArray(appError.detail) ? appError.detail.join(' | ') : String(appError.detail);
      expect(detail).toContain('answerKey');
    }
    // 零写入
    expect(await db.exams.count()).toBe(countBefore.exams);
    expect(await db.passages.count()).toBe(countBefore.passages);
    expect(await db.questions.count()).toBe(countBefore.questions);
  });

  it('倒计时剩 5 分钟（300s）变红：≤300 danger，>300 正常色', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = (sec: number) => {
      act(() => {
        root.render(<Countdown remainingSec={sec} paused={false} />);
      });
      return container.querySelector('output') as HTMLOutputElement;
    };
    try {
      const normal = render(301);
      expect(normal.className).not.toContain('text-danger');
      const boundary = render(300); // 恰好 300 也要变红
      expect(boundary.className).toContain('text-danger');
      expect(boundary.className).toContain('border-danger');
      expect(boundary.textContent).toBe('05:00');
      const low = render(299);
      expect(low.className).toContain('text-danger');
      expect(low.textContent).toBe('04:59');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
