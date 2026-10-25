/**
 * 答题会话 store（T14，对标 sessionStore 的「先内存后落库」编排层）。
 *
 * 职责边界（ARCHITECTURE T14）：
 * - 每次选择「先写内存」（毫秒级响应），每 3s 由 tick() 触发一次
 *   attemptRepo.updateAnswer 落库（防杀进程丢答案）；
 * - 倒计时以「截止时间戳」为唯一事实源：暂停冻结、恢复重算、刷新后从
 *   localStorage 恢复基准，不随 interval 漂移；
 * - 剩余 0 自动交卷；交卷 = gradeAttempt → Attempt + AttemptAnswer[] +
 *   WrongItem[] → 跳成绩单；
 * - 重做答对的题自动 setResolved(true)（错题本移出，T15）。
 */
import { create } from 'zustand';

import { ATTEMPT_FLUSH_INTERVAL_MS } from '@/constants';
import { attemptMetaKey } from '@/constants/storage';
import {
  createAttempt,
  getAnswers,
  getAttempt,
  patchAttempt,
  putAnswers,
  updateAnswer,
} from '@/db/repos/attemptRepo';
import { getExam, getPassages, getQuestions } from '@/db/repos/examRepo';
import { getSettings } from '@/db/repos/settingsRepo';
import { setResolved, upsertWrongMany } from '@/db/repos/wrongRepo';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/id';
import { now } from '@/lib/time';
import { gradeAttempt } from '@/lib/exam/grade';
import type {
  Attempt,
  AttemptAnswer,
  EntityId,
  Exam,
  GradingResult,
  Passage,
  Question,
  SectionType,
} from '@/types';

/** 内存里的一题作答草稿 */
export interface AnswerDraft {
  choice: string | null;
  text: string | null;
  flagged: boolean;
  /** 首次作答的时间戳（落库 answeredAt 用） */
  answeredAt: number;
}

/** localStorage 里持久化的会话元信息（刷新恢复倒计时与抽题结果） */
export interface AttemptMeta {
  /** 限时模式的截止时间戳（毫秒）；不限时为 null */
  deadlineTs: number | null;
  /** 暂停时冻结的剩余秒数 */
  pausedRemaining: number | null;
  /** 开考时间戳（毫秒，算用时用） */
  startedAtTs: number;
  /** 本卷的题目 ID 顺序（专项/重做模式的抽题结果） */
  questionIds: EntityId[];
}

export interface StartAttemptInput {
  exam: Exam;
  passages: Passage[];
  questions: Question[];
  mode: Attempt['mode'];
  sectionType: SectionType | null;
  /** 限时秒数；null = 不限时 */
  timeLimitSec: number | null;
}

interface AttemptState {
  status: 'idle' | 'loading' | 'active' | 'submitting' | 'submitted';
  attemptId: string | null;
  attempt: Attempt | null;
  paperId: string | null;
  exam: Exam | null;
  questions: Question[];
  passages: Passage[];
  currentSeq: number;
  answers: Record<EntityId, AnswerDraft>;
  /** 自上次落库后有改动的题目 ID */
  dirtyIds: EntityId[];
  /** 剩余秒数（限时模式；不限时恒为 0） */
  remainingSec: number;
  paused: boolean;
  /** 本次 tick 是否触发了超时自动交卷（页面据此提示） */
  timeoutSubmitted: boolean;
  /** 上次落库时间戳（3s 节流用） */
  lastFlushAt: number;
  meta: AttemptMeta | null;
  error: string | null;

  start: (input: StartAttemptInput) => Promise<string>;
  restore: (attemptId: string) => Promise<boolean>;
  setCurrentSeq: (seq: number) => void;
  setChoice: (questionId: EntityId, key: string) => void;
  setText: (questionId: EntityId, text: string) => void;
  toggleFlag: (questionId: EntityId) => void;
  /** 每秒由页面调用：推进倒计时、按 3s 节流落库、超时自动交卷 */
  tick: () => Promise<void>;
  togglePause: () => void;
  /** 立即把 dirty 作答写入 IndexedDB */
  flush: () => Promise<void>;
  submit: () => Promise<GradingResult | null>;
  reset: () => void;
}

/** 初始（空）状态，reset 用 */
function initialState() {
  return {
    status: 'idle' as const,
    attemptId: null,
    attempt: null,
    paperId: null,
    exam: null,
    questions: [],
    passages: [],
    currentSeq: 1,
    answers: {} as Record<EntityId, AnswerDraft>,
    dirtyIds: [] as EntityId[],
    remainingSec: 0,
    paused: false,
    timeoutSubmitted: false,
    lastFlushAt: 0,
    meta: null,
    error: null,
  };
}

/** 读 localStorage 元信息；损坏时返回 null */
function readMeta(attemptId: string): AttemptMeta | null {
  try {
    const raw = window.localStorage.getItem(attemptMetaKey(attemptId));
    return raw ? (JSON.parse(raw) as AttemptMeta) : null;
  } catch {
    return null;
  }
}

function writeMeta(attemptId: string, meta: AttemptMeta): void {
  try {
    window.localStorage.setItem(attemptMetaKey(attemptId), JSON.stringify(meta));
  } catch {
    // 存储不可用（隐私模式等）：降级为仅内存，不阻塞答题
  }
}

function removeMeta(attemptId: string): void {
  try {
    window.localStorage.removeItem(attemptMetaKey(attemptId));
  } catch {
    // 同上，忽略
  }
}

/** 由元信息算当前剩余秒数（限时模式） */
function remainingOf(meta: AttemptMeta): number {
  if (meta.pausedRemaining !== null) {
    return Math.max(0, meta.pausedRemaining);
  }
  if (meta.deadlineTs === null) {
    return 0;
  }
  return Math.max(0, Math.ceil((meta.deadlineTs - Date.now()) / 1000));
}

/** 把内存草稿转成可落库的 AttemptAnswer（交卷前 isCorrect 均为 null） */
function toAttemptAnswer(
  attemptId: string,
  question: Question,
  draft: AnswerDraft | undefined,
): AttemptAnswer {
  return {
    id: `aa-${attemptId}-${question.id}`,
    attemptId,
    questionId: question.id,
    choice: draft?.choice ?? null,
    text: draft?.text ?? null,
    isCorrect: null,
    flagged: draft?.flagged ?? false,
    selfScore: null,
    answeredAt: draft?.answeredAt ?? now(),
  };
}

export const useAttemptStore = create<AttemptState>()((set, get) => ({
  ...initialState(),

  /** 开卷：建 Attempt 行 + 初始化内存态与 localStorage 基准 */
  start: async (input) => {
    const attemptId = newId('att');
    const startedAt = now();
    const questionIds = input.questions.map((question) => question.id);
    const meta: AttemptMeta = {
      deadlineTs: input.timeLimitSec !== null ? Date.now() + input.timeLimitSec * 1000 : null,
      pausedRemaining: null,
      startedAtTs: startedAt,
      questionIds,
    };
    const settings = await getSettings();
    const attempt: Attempt = {
      id: attemptId,
      paperId: input.exam.id,
      mode: input.mode,
      sectionType: input.sectionType,
      startedAt,
      submittedAt: null,
      durationSec: 0,
      objectiveScore: 0,
      subjectiveScore: null,
      totalScore: 0,
      deviceId: settings?.deviceId ?? 'local',
      updatedAt: startedAt,
      deletedAt: null,
    };
    await createAttempt(attempt);
    writeMeta(attemptId, meta);
    set({
      ...initialState(),
      status: 'active',
      attemptId,
      attempt,
      paperId: input.exam.id,
      exam: input.exam,
      questions: input.questions,
      passages: input.passages,
      currentSeq: input.questions[0]?.seq ?? 1,
      remainingSec: input.timeLimitSec ?? 0,
      paused: false,
      meta,
    });
    return attemptId;
  },

  /** 刷新/重进后恢复：Attempt 存在且未交卷时返回 true */
  restore: async (attemptId) => {
    const existing = get();
    if (existing.status === 'active' && existing.attemptId === attemptId) {
      return true; // 已在作答中（双栏/抽屉共用），无需重复加载
    }
    set({ status: 'loading', error: null });
    const attempt = await getAttempt(attemptId);
    if (!attempt || attempt.submittedAt !== null) {
      set({ ...initialState(), error: 'ATTEMPT_NOT_FOUND' });
      return false;
    }
    const meta = readMeta(attemptId);
    const detail = await getPaperDetailCompat(attempt.paperId);
    if (!detail.exam) {
      set({ ...initialState(), error: 'EXAM_NOT_FOUND' });
      return false;
    }

    // 题目集合：优先用 meta 里的抽题结果（专项/重做），否则整卷
    let questions = detail.questions;
    const savedIds = meta?.questionIds ?? [];
    if (savedIds.length > 0) {
      const byId = new Map(detail.questions.map((question) => [question.id, question]));
      const picked = savedIds
        .map((id) => byId.get(id))
        .filter((question): question is Question => question !== undefined);
      if (picked.length > 0) {
        questions = picked.sort((left, right) => left.seq - right.seq);
      }
    }

    // 已落库的作答恢复进内存
    const savedAnswers = await getAnswers(attemptId);
    const answers: Record<EntityId, AnswerDraft> = {};
    for (const row of savedAnswers) {
      const hasContent = row.choice !== null || row.text !== null || row.flagged;
      if (!hasContent) {
        continue;
      }
      answers[row.questionId] = {
        choice: row.choice,
        text: row.text,
        flagged: row.flagged,
        answeredAt: row.answeredAt,
      };
    }

    if (meta) {
      writeMeta(attemptId, meta); // 原样写回，保持基准稳定
    }
    set({
      status: 'active',
      attemptId,
      attempt,
      paperId: attempt.paperId,
      exam: detail.exam,
      questions,
      passages: detail.passages,
      currentSeq: questions[0]?.seq ?? 1,
      answers,
      dirtyIds: [],
      remainingSec: meta ? remainingOf(meta) : 0,
      paused: meta !== null && meta.pausedRemaining !== null,
      timeoutSubmitted: false,
      lastFlushAt: 0,
      meta,
      error: null,
    });
    return true;
  },

  setCurrentSeq: (seq) => {
    set({ currentSeq: seq });
  },

  setChoice: (questionId, key) => {
    const { answers, dirtyIds } = get();
    const prev = answers[questionId];
    const next: Record<EntityId, AnswerDraft> = {
      ...answers,
      [questionId]: {
        choice: key,
        text: prev?.text ?? null,
        flagged: prev?.flagged ?? false,
        answeredAt: prev?.answeredAt ?? now(),
      },
    };
    set({
      answers: next,
      dirtyIds: dirtyIds.includes(questionId) ? dirtyIds : [...dirtyIds, questionId],
    });
  },

  setText: (questionId, text) => {
    const { answers, dirtyIds } = get();
    const prev = answers[questionId];
    const next: Record<EntityId, AnswerDraft> = {
      ...answers,
      [questionId]: {
        choice: prev?.choice ?? null,
        text,
        flagged: prev?.flagged ?? false,
        answeredAt: prev?.answeredAt ?? now(),
      },
    };
    set({
      answers: next,
      dirtyIds: dirtyIds.includes(questionId) ? dirtyIds : [...dirtyIds, questionId],
    });
  },

  toggleFlag: (questionId) => {
    const { answers, dirtyIds } = get();
    const prev = answers[questionId];
    const next: Record<EntityId, AnswerDraft> = {
      ...answers,
      [questionId]: {
        choice: prev?.choice ?? null,
        text: prev?.text ?? null,
        flagged: !(prev?.flagged ?? false),
        answeredAt: prev?.answeredAt ?? now(),
      },
    };
    set({
      answers: next,
      dirtyIds: dirtyIds.includes(questionId) ? dirtyIds : [...dirtyIds, questionId],
    });
  },

  tick: async () => {
    const state = get();
    if (state.status !== 'active' || state.paused) {
      return;
    }
    const meta = state.meta;
    if (!meta) {
      return;
    }

    // 1) 超时自动交卷
    const remaining = remainingOf(meta);
    if (meta.deadlineTs !== null && remaining <= 0) {
      set({ remainingSec: 0 });
      await get().submit();
      set({ timeoutSubmitted: true });
      return;
    }

    // 2) 倒计时推进（限时模式）
    if (meta.deadlineTs !== null) {
      set({ remainingSec: remaining });
    }

    // 3) 落库节流：距上次落库 ≥ 3s 且有改动
    const fresh = get();
    if (fresh.dirtyIds.length > 0 && Date.now() - fresh.lastFlushAt >= ATTEMPT_FLUSH_INTERVAL_MS) {
      await fresh.flush();
    }
  },

  togglePause: () => {
    const state = get();
    if (state.status !== 'active' || !state.meta || !state.attemptId) {
      return;
    }
    const meta = state.meta;
    if (state.paused) {
      // 恢复：从冻结的剩余时间重算截止时间戳（暂停时 deadlineTs 必为 null）
      const resume = meta.pausedRemaining ?? state.remainingSec;
      const nextMeta: AttemptMeta =
        meta.deadlineTs === null
          ? { ...meta, deadlineTs: Date.now() + resume * 1000, pausedRemaining: null }
          : meta;
      writeMeta(state.attemptId, nextMeta);
      set({ paused: false, meta: nextMeta, remainingSec: resume });
    } else {
      // 暂停：冻结剩余时间，清空截止时间戳
      const frozen = meta.deadlineTs !== null ? remainingOf(meta) : state.remainingSec;
      const nextMeta: AttemptMeta =
        meta.deadlineTs !== null ? { ...meta, deadlineTs: null, pausedRemaining: frozen } : meta;
      writeMeta(state.attemptId, nextMeta);
      set({ paused: true, meta: nextMeta, remainingSec: frozen });
    }
  },

  flush: async () => {
    const state = get();
    if (state.status !== 'active' || !state.attemptId || state.dirtyIds.length === 0) {
      return;
    }
    const attemptId: string = state.attemptId;
    const rows = state.questions
      .filter((question) => state.dirtyIds.includes(question.id))
      .map((question) => toAttemptAnswer(attemptId, question, state.answers[question.id]));
    if (rows.length === 0) {
      return;
    }
    try {
      for (const row of rows) {
        await updateAnswer(row);
      }
      set({ dirtyIds: [], lastFlushAt: Date.now() });
    } catch (error) {
      set({ error: error instanceof AppError ? error.code : 'DB_WRITE_FAILED' });
    }
  },

  /** 交卷：判分 → Attempt/AttemptAnswer/WrongItem 一次性写入 → status=submitted */
  submit: async () => {
    const state = get();
    if (state.status !== 'active' || !state.attemptId || !state.attempt || !state.paperId) {
      return null;
    }
    set({ status: 'submitting' });
    const { attemptId, attempt, paperId, questions, answers, meta } = state;

    const rows = questions.map((question) => toAttemptAnswer(attemptId, question, answers[question.id]));

    // 判分（纯函数）：客观题得分 + 错题清单
    const grade = gradeAttempt(questions, rows);
    const isCorrectByQid = new Map<EntityId, boolean | null>(
      grade.perQuestion.map((item) => [item.questionId, item.isCorrect]),
    );
    const finalRows = rows.map((row) => ({
      ...row,
      isCorrect: isCorrectByQid.get(row.questionId) ?? null,
    }));

    // 用时：限时 = 总时长 - 剩余；不限时 = 实际经过
    const timeLimitSec =
      meta && meta.deadlineTs !== null ? Math.round((meta.deadlineTs - meta.startedAtTs) / 1000) : null;
    const durationSec =
      timeLimitSec !== null && timeLimitSec > 0 && meta
        ? Math.max(0, timeLimitSec - remainingOf(meta))
        : Math.max(0, Math.round((Date.now() - (meta?.startedAtTs ?? attempt.startedAt)) / 1000));

    await putAnswers(paperId, finalRows);
    await patchAttempt(attemptId, {
      submittedAt: now(),
      durationSec,
      objectiveScore: grade.objectiveScore,
      subjectiveScore: null,
      totalScore: grade.objectiveScore,
    });

    // 错题入本 + 重做答对移出（resolved=true）
    const sectionByQid = new Map<EntityId, SectionType>(
      questions.map((question) => [question.id, question.sectionType]),
    );
    await upsertWrongMany(
      grade.wrongQuestionIds.map((questionId) => ({
        questionId,
        paperId,
        sectionType: sectionByQid.get(questionId) ?? 'reading',
      })),
    );
    const correctIds = grade.perQuestion
      .filter((item) => item.isCorrect === true)
      .map((item) => item.questionId);
    for (const questionId of correctIds) {
      await setResolved(questionId, true);
    }

    if (attemptId) {
      removeMeta(attemptId);
    }
    set({ status: 'submitted', remainingSec: 0 });
    return grade;
  },

  reset: () => {
    set({ ...initialState() });
  },
}));

/** getPaperDetail 的本地兼容封装（避免 attemptStore 直接依赖 examRepo 之外的新模块） */
async function getPaperDetailCompat(
  paperId: string,
): Promise<{ exam: Exam | undefined; passages: Passage[]; questions: Question[] }> {
  const [exam, passages, questions] = await Promise.all([
    getExam(paperId),
    getPassages(paperId),
    getQuestions(paperId),
  ]);
  return { exam, passages, questions };
}

/** 便捷读取：当前题（按 seq） */
export function currentQuestionOf(state: AttemptState): Question | undefined {
  return state.questions.find((question) => question.seq === state.currentSeq);
}

/** 便捷读取：某题的作答草稿（无草稿返回三空结构） */
export function answerDraftOf(state: AttemptState, questionId: EntityId): AnswerDraft {
  const draft = state.answers[questionId];
  return draft ?? { choice: null, text: null, flagged: false, answeredAt: 0 };
}

/** 便捷读取：已答题数（客观 choice 或主观 text 有内容） */
export function answeredCountOf(state: AttemptState): number {
  return state.questions.filter((question) => {
    const draft = state.answers[question.id];
    if (!draft) {
      return false;
    }
    return (draft.choice !== null && draft.choice !== '') || (draft.text !== null && draft.text.trim() !== '');
  }).length;
}
