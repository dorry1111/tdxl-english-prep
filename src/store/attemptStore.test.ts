/**
 * attemptStore 单元测试（T14 核心）：
 * - start 建 Attempt 行 + 倒计时基准；
 * - 选择写内存，flush / tick（3s 节流）落库；
 * - 刷新恢复（restore：答案 + 剩余时间 + 抽题结果）；
 * - 暂停冻结 / 恢复重算；
 * - 超时自动交卷（系统时间前移 + 手动 tick）；
 * - 交卷：gradeAttempt 分数与手算一致、未答按错处理、错题入本、答对移出。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { importExamJson } from '@/db/seed';
import { getAttempt, getAnswers } from '@/db/repos/attemptRepo';
import { getPaperDetail } from '@/db/repos/examRepo';
import { countPending, listPending } from '@/db/repos/wrongRepo';
import { standardAnswerKeyOf } from '@/test/fixtures/examJsonFixture';
import { now } from '@/lib/time';
import type { Exam, Passage, Question } from '@/types';
import {
  answerDraftOf,
  useAttemptStore,
  type AttemptMeta,
} from './attemptStore';

interface SeededPaper {
  exam: Exam;
  passages: Passage[];
  questions: Question[];
}

async function seedPaper(paperId = 'store-test-paper'): Promise<SeededPaper> {
  const json = (await import('@/test/fixtures/examJsonFixture')).buildStandardExamJson('attemptStore 测试卷');
  await importExamJson(json, { paperId });
  const detail = await getPaperDetail(paperId);
  if (!detail.exam) {
    throw new Error('seed failed');
  }
  return { exam: detail.exam, passages: detail.passages, questions: detail.questions };
}

/** 按 seq 取题（noUncheckedIndexedAccess 友好） */
function qAt(questions: Question[], seq: number): Question {
  const question = questions.find((item) => item.seq === seq);
  if (!question) {
    throw new Error(`question seq=${seq} not found`);
  }
  return question;
}

beforeEach(async () => {
  useAttemptStore.getState().reset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('attemptStore：开卷与落库', () => {
  it('start 建 Attempt 行、初始化倒计时与题集', async () => {
    const detail = await seedPaper();
    const attemptId = await useAttemptStore.getState().start({
      exam: detail.exam,
      passages: detail.passages,
      questions: detail.questions,
      mode: 'full',
      sectionType: null,
      timeLimitSec: 9000,
    });
    const row = await getAttempt(attemptId);
    expect(row).toBeDefined();
    expect(row?.paperId).toBe('store-test-paper');
    expect(row?.submittedAt).toBeNull();
    const state = useAttemptStore.getState();
    expect(state.status).toBe('active');
    expect(state.questions).toHaveLength(77);
    expect(state.remainingSec).toBe(9000);
    expect(state.meta?.deadlineTs).not.toBeNull();
  });

  it('setChoice 写内存；flush 落库并清 dirty；再次 setChoice 后 tick 到 3s 节拍落库', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const detail = await seedPaper();
    const store = useAttemptStore.getState();
    const attemptId = await store.start({
      exam: detail.exam,
      passages: detail.passages,
      questions: detail.questions,
      mode: 'full',
      sectionType: null,
      timeLimitSec: 9000,
    });
    const q1 = qAt(detail.questions, 1);
    const q2 = qAt(detail.questions, 2);
    useAttemptStore.getState().setChoice(q1.id, 'A');
    useAttemptStore.getState().toggleFlag(q2.id);

    // 落库前：attemptAnswers 无记录
    expect(await getAnswers(attemptId)).toHaveLength(0);

    await useAttemptStore.getState().flush();
    let rows = await getAnswers(attemptId);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.questionId === q1.id)?.choice).toBe('A');
    expect(rows.find((row) => row.questionId === q2.id)?.flagged).toBe(true);
    expect(useAttemptStore.getState().dirtyIds).toHaveLength(0);

    // 再改一题，时间前进 3s → tick 触发节流落库
    useAttemptStore.getState().setChoice(q2.id, 'B');
    vi.setSystemTime(Date.now() + 3100);
    await useAttemptStore.getState().tick();
    rows = await getAnswers(attemptId);
    expect(rows.find((row) => row.questionId === q2.id)?.choice).toBe('B');
  });
});

describe('attemptStore：刷新恢复', () => {
  it('restore 恢复已落库答案、剩余时间与抽题结果', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const detail = await seedPaper();
    const store = useAttemptStore.getState();
    const attemptId = await store.start({
      exam: detail.exam,
      passages: detail.passages,
      questions: detail.questions.slice(0, 5), // 专项抽题结果
      mode: 'section',
      sectionType: 'dialogue',
      timeLimitSec: 600,
    });
    const q1 = qAt(detail.questions, 1);
    useAttemptStore.getState().setChoice(q1.id, 'C');
    await useAttemptStore.getState().flush();

    // 模拟刷新：重置内存 → 重新恢复
    useAttemptStore.getState().reset();
    const ok = await useAttemptStore.getState().restore(attemptId);
    expect(ok).toBe(true);

    const state = useAttemptStore.getState();
    expect(state.status).toBe('active');
    expect(state.questions).toHaveLength(5); // 抽题结果恢复
    expect(state.answers[q1.id]?.choice).toBe('C');
    expect(state.remainingSec).toBeGreaterThan(590); // 倒计时从截止时间戳重算
    expect(state.remainingSec).toBeLessThanOrEqual(600);
  });

  it('restore 已交卷的 attempt 返回 false', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const detail = await seedPaper();
    const attemptId = await useAttemptStore.getState().start({
      exam: detail.exam,
      passages: detail.passages,
      questions: detail.questions.slice(0, 2),
      mode: 'section',
      sectionType: 'dialogue',
      timeLimitSec: null,
    });
    await useAttemptStore.getState().submit();
    useAttemptStore.getState().reset();
    const ok = await useAttemptStore.getState().restore(attemptId);
    expect(ok).toBe(false);
  });
});

describe('attemptStore：倒计时', () => {
  it('暂停冻结剩余时间，恢复后继续递减', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const detail = await seedPaper();
    await useAttemptStore.getState().start({
      exam: detail.exam,
      passages: detail.passages,
      questions: detail.questions.slice(0, 3),
      mode: 'section',
      sectionType: 'dialogue',
      timeLimitSec: 600,
    });
    const store = useAttemptStore.getState();

    vi.setSystemTime(Date.now() + 60_000);
    await store.tick();
    expect(useAttemptStore.getState().remainingSec).toBe(540);

    useAttemptStore.getState().togglePause();
    expect(useAttemptStore.getState().paused).toBe(true);

    vi.setSystemTime(Date.now() + 60_000);
    await useAttemptStore.getState().tick();
    expect(useAttemptStore.getState().remainingSec).toBe(540); // 暂停期间不减少

    useAttemptStore.getState().togglePause();
    await useAttemptStore.getState().tick();
    expect(useAttemptStore.getState().remainingSec).toBe(540); // 刚恢复
    vi.setSystemTime(Date.now() + 5_000);
    await useAttemptStore.getState().tick();
    expect(useAttemptStore.getState().remainingSec).toBe(535);
  });

  it('超时自动交卷', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const detail = await seedPaper();
    const attemptId = await useAttemptStore.getState().start({
      exam: detail.exam,
      passages: detail.passages,
      questions: detail.questions.slice(0, 3),
      mode: 'section',
      sectionType: 'dialogue',
      timeLimitSec: 5,
    });
    const q1 = qAt(detail.questions, 1);
    useAttemptStore.getState().setChoice(q1.id, standardAnswerKeyOf(1));
    vi.setSystemTime(Date.now() + 6_000);
    await useAttemptStore.getState().tick();
    expect(useAttemptStore.getState().status).toBe('submitted');
    expect(useAttemptStore.getState().timeoutSubmitted).toBe(true);
    const row = await getAttempt(attemptId);
    expect(row?.submittedAt).not.toBeNull();
    expect(row?.objectiveScore).toBe(1);
  });
});

describe('attemptStore：交卷与判分', () => {
  it('objectiveScore 与手算一致；未答客观题进错题本；自评后 totalScore 合并', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const detail = await seedPaper();
    const attemptId = await useAttemptStore.getState().start({
      exam: detail.exam,
      passages: detail.passages,
      questions: detail.questions,
      mode: 'full',
      sectionType: null,
      timeLimitSec: 9000,
    });
    const store = useAttemptStore.getState();
    // 前 10 题作答：1-5 题答对，6-10 题答错
    for (let seq = 1; seq <= 10; seq += 1) {
      const question = qAt(detail.questions, seq);
      const answerKey = standardAnswerKeyOf(seq);
      const wrongKey = answerKey === 'A' ? 'B' : 'A';
      store.setChoice(question.id, seq <= 5 ? answerKey : wrongKey);
    }
    // 主观题作答文本
    const translation = qAt(detail.questions, 76);
    const writing = qAt(detail.questions, 77);
    store.setText(translation.id, '我的翻译');
    store.setText(writing.id, 'My essay.');

    const grade = await store.submit();
    expect(grade).not.toBeNull();
    expect(grade?.objectiveScore).toBe(5); // 1×5

    const row = await getAttempt(attemptId);
    expect(row?.objectiveScore).toBe(5);
    expect(row?.totalScore).toBe(5);
    expect(row?.submittedAt).not.toBeNull();

    // 75 道客观题全部判分：5 对 + 5 错答 + 65 未答 → 70 道进错题本
    expect(grade?.wrongQuestionIds).toHaveLength(70);
    expect(await countPending()).toBe(70);

    // 明细：客观题 isCorrect 落库；主观题 null
    const answers = await getAnswers(attemptId);
    expect(answers.find((a) => a.questionId === translation.id)?.isCorrect).toBeNull();
    expect(answers.find((a) => a.questionId === qAt(detail.questions, 1).id)?.isCorrect).toBe(true);

    // 自评合并走 ResultPage 页面路径（见 examsFlow 页面测试），此处只验证客观段
    const updated = await getAttempt(attemptId);
    expect(updated?.totalScore).toBe(5);
  });

  it('重做答对的题 resolved=true 移出错题本', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const detail = await seedPaper();
    // 第一次：整卷交卷，题 1 答错
    const attemptId1 = await useAttemptStore.getState().start({
      exam: detail.exam,
      passages: detail.passages,
      questions: detail.questions,
      mode: 'full',
      sectionType: null,
      timeLimitSec: 9000,
    });
    const q1 = qAt(detail.questions, 1);
    const wrongKey = standardAnswerKeyOf(1) === 'A' ? 'B' : 'A';
    useAttemptStore.getState().setChoice(q1.id, wrongKey);
    await useAttemptStore.getState().submit();
    expect(await countPending()).toBe(75);
    void attemptId1;

    // 第二次（重做）：题 1 答对 → resolved=true 移出
    useAttemptStore.getState().reset();
    window.localStorage.clear();
    await useAttemptStore.getState().start({
      exam: detail.exam,
      passages: detail.passages,
      questions: [q1],
      mode: 'section',
      sectionType: 'dialogue',
      timeLimitSec: null,
    });
    useAttemptStore.getState().setChoice(q1.id, standardAnswerKeyOf(1));
    await useAttemptStore.getState().submit();
    const pending = await listPending();
    expect(pending.find((item) => item.questionId === q1.id)).toBeUndefined();
  });

  it('answerDraftOf / AttemptMeta 兜底结构', () => {
    const state = useAttemptStore.getState();
    const draft = answerDraftOf(state, 'no-such');
    expect(draft.choice).toBeNull();
    expect(draft.flagged).toBe(false);
    const meta: AttemptMeta = {
      deadlineTs: null,
      pausedRemaining: null,
      startedAtTs: now(),
      questionIds: [],
    };
    expect(meta.deadlineTs).toBeNull();
  });
});
