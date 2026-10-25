/**
 * 背单词会话 store（T07 收官件，ARCHITECTURE 4.1）。
 *
 * 职责边界：
 * - 纯调度逻辑在 lib/session（sessionMachine 纯函数），本文件只做「编排 + 落库」；
 * - 每次作答在一个 Dexie 事务内完成 4.1 清单的全部写入（wordStates / reviewLogs /
 *   studyDays / sessions / sessionSnapshots / syncMeta），落库成功后才切下一张卡；
 * - 「先 await 落库，再 set 新状态」——杀进程不回退。
 */
import { create } from 'zustand';

import {
  BUILTIN_BOOK_ID,
  DEFAULT_DAILY_STUDY_QUOTA,
  DEFAULT_EXAM_DATE,
  INTERVAL_LADDER,
  L_MAX,
  MASTER_L,
  MIN_QUEUE_SIZE,
  NEW_WORD_LIMIT_MAX,
  SESSION_DURATION_CAP_SEC,
} from '@/constants';
import { db, markDirty } from '@/db';
import { createEmptyDay } from '@/db/repos/dayRepo';
import { countDueByBook, countLearnedByBook } from '@/db/repos/forecastRepo';
import { reviewLogEntityOf } from '@/db/repos/logRepo';
import { getLatestSnapshot } from '@/db/repos/sessionRepo';
import { getSettings } from '@/db/repos/settingsRepo';
import { getDueWords, resetStaleRetryCounts, wordStateEntityOf } from '@/db/repos/stateRepo';
import {
  countWordsByBook,
  getCoreNewWordCandidates,
  getWord,
  listWordsByBook,
} from '@/db/repos/wordRepo';
import { loadCoreIndex, peekCoreIndex } from '@/lib/wordbookCache';
import { newId } from '@/lib/id';
import { stateKeyOfNorm } from '@/lib/hash';
import { nextStudyDay0400, studyDayOf } from '@/lib/srs/studyDay';
import { buildSession } from '@/lib/session/buildSession';
import {
  answer,
  computeAccuracy,
  createQueueState,
  type AnswerOutcome,
} from '@/lib/session/sessionMachine';
import { refillTail, type DueReviewCard } from '@/lib/session/queue';
import {
  clampDailyStudyQuota,
  clampNewWordLimit,
  daysUntil,
  effectiveDailyNew,
  suggestDailyNew,
} from '@/pages/plan/planLogic';
import { currentBookIdOf } from '@/store/bookSelection';
import type { SrsConfig } from '@/lib/srs/transition';
import type { Rating, StudyDay, StudyDayKey, Timestamp } from '@/types';
import type {
  CardItem,
  QueueState,
  SessionSnapshot,
  Settings,
  StudySession,
} from '@/types';
import type { Word, WordState } from '@/types';

// ---------- 类型 ----------

/** 会话结算摘要（结算页展示用） */
export interface SettleSummary {
  answeredCount: number;
  accuracy: { correct: number; total: number; rate: number };
  ratingCounts: Record<'1' | '2' | '3' | '4', number>;
  durationSec: number;
  unstableCount: number;
}

/** 续学候选（首页「继续上次」判断用） */
export interface ResumeInfo {
  sessionId: string;
  studyDay: StudyDayKey;
  answeredCount: number;
}

/** 新词候选提供者（T08 分片加载器完成后替换默认实现） */
export type NewWordProvider = (settings: Settings, limit: number) => Promise<Word[]>;

/** 「上一个」可回退的作答历史条目（submit 前快照，back 时逆向恢复） */
export interface BackHistoryEntry {
  /** 本次作答的 stateKey（wordState 恢复/删除用） */
  stateKey: string;
  /** 本次作答所属学习日（studyDays 恢复/删除用） */
  studyDay: StudyDayKey;
  /** 作答前的机器状态（深拷贝，含队列/重现池/首次评分记录） */
  machine: QueueState;
  /** 作答前的会话累计 */
  session: StudySession;
  /** 作答前的补位池 */
  duePool: DueReviewCard[];
  newPool: Word[];
  /** 作答前的出卡时间（回退后恢复，时长统计不串位） */
  cardShownAt: Timestamp;
  /** 作答前各表行快照（null 表示作答前不存在，back 时删除） */
  wordStateBefore: WordState | null;
  studyDayBefore: StudyDay | null;
  snapshotBefore: SessionSnapshot | null;
  /** 本次作答时间戳（reviewLog 月片标脏用） */
  submittedAt: Timestamp;
  /** 本次作答写入的 reviewLog id（back 时删除，防止重复学习记录） */
  reviewLogId: string;
}

/** 回退历史上限（内存安全：单条仅含小对象，50 步足够回溯） */
const MAX_BACK_HISTORY = 50;

/** QueueState 深拷贝（纯 JSON 数据；structuredClone 不可用时退化为 JSON 往返） */
function cloneMachine(machine: QueueState): QueueState {
  if (typeof structuredClone === 'function') {
    return structuredClone(machine);
  }
  return JSON.parse(JSON.stringify(machine)) as QueueState;
}

interface SessionStoreState {
  status: 'idle' | 'active' | 'settled';
  machine: QueueState | null;
  /** 当前 StudySession 落库记录（累计值随作答更新） */
  session: StudySession | null;
  /** 当前卡内容（machine.queue[0] 对应的 Word） */
  currentWord: Word | null;
  revealed: boolean;
  /** 当前卡的出卡时间，作答时算 durationMs */
  cardShownAt: Timestamp | null;
  /** 待补池：到期复习（dueAt 升序）+ 新词（学习顺序） */
  duePool: DueReviewCard[];
  newPool: Word[];
  settleSummary: SettleSummary | null;
  error: string | null;
  /** 作答历史（「上一个」可回退）；start / exit 时清空 */
  history: BackHistoryEntry[];

  /** 有无「继续上次」候选（有同日未完成快照） */
  checkResume: () => Promise<ResumeInfo | null>;
  /** 构建并开始会话；无词可学时返回 'empty' */
  start: (options?: { resume?: boolean }) => Promise<'started' | 'empty'>;
  reveal: () => void;
  /** 提交评分：纯函数调度 + 单事务落库 + 补位 + 结算判定 */
  submit: (rating: Rating) => Promise<void>;
  /**
   * 回退最近一次作答（学习页「上一个」按钮）：
   * 单事务逆向恢复 wordStates/reviewLogs/studyDays/sessions/sessionSnapshots，
   * 机器与补位池还原到作答前，队列回到上一张卡（已揭示，可直接改评分）。
   * 历史为空时为 no-op；回退可连续多次（每次数一步）。
   */
  back: () => Promise<void>;
  /** 暂停退出：快照已随每次作答写入，这里只清内存态 */
  exit: () => void;
  /**
   * 会话中追加新词（BooksPage「+5 新词」）。
   * 语义：从与 `defaultNewWordProvider` 相同的取词源取词，尾插进队列并抬高 plannedTotal；
   * 不动队首（当前卡保持不变）、不打断作答、跳过已在队列或已答过的词。
   * @returns 实际追加的条数（0 表示没有可加的新词）
   */
  addNewWords: (count: number) => Promise<number>;
}

// ---------- 内部工具 ----------

/** 由设置构造 SRS 调度配置 */
function srsConfigOf(settings: Settings): SrsConfig {
  return {
    maxLevel: L_MAX,
    masterLevel: MASTER_L,
    intervalLadder: [...INTERVAL_LADDER],
    dayStartHour: settings.dayStartHour,
    maxRetry: settings.maxRetry,
  };
}

/** 由 wordId（`${bookId}:${norm}`）取 norm；带 bookId 前缀缺失时原样返回 */
function normOfWordId(wordId: string): string {
  const idx = wordId.indexOf(':');
  return idx >= 0 ? wordId.slice(idx + 1) : wordId;
}

/** 新词首答前的初始化 WordState（L=0，dueAt=0 表示未进入调度） */
function initialWordState(card: CardItem, nowTs: number, studyDay: StudyDayKey): WordState {
  return {
    stateKey: card.stateKey,
    wordId: card.wordId,
    bookId: card.wordId.slice(0, card.wordId.indexOf(':')),
    level: 0,
    dueAt: 0,
    lastRating: null,
    lastReviewAt: null,
    firstLearnedAt: nowTs,
    reviewCount: 0,
    correctCount: 0,
    wrongCount: 0,
    lapseCount: 0,
    retryCountToday: 0,
    retryDay: studyDay,
    unstable: false,
    isStarred: false,
    masteredAt: null,
    updatedAt: nowTs,
    deletedAt: null,
  };
}

function wordToCard(word: Word): CardItem {
  const stateKey = stateKeyOfNorm(word.norm);
  return { key: `new:${stateKey}:0`, wordId: word.id, stateKey, kind: 'new', round: 0 };
}

function emptyRatingCounts(): Record<'1' | '2' | '3' | '4', number> {
  return { '1': 0, '2': 0, '3': 0, '4': 0 };
}

/**
 * 默认新词候选：内置词库走索引候选（frequencyRank ?? sourceOrder，跳过已学），
 * 用户导入词库走 DB（频率序）。叠加 activeBookIds 顺序，按 stateKey 去重。
 */
const defaultNewWordProvider: NewWordProvider = async (settings, limit) => {
  if (limit <= 0) {
    return [];
  }
  const collected: Word[] = [];
  const seen = new Set<string>();
  // 取词范围：叠加模式用 activeBookIds，单书模式用 currentBookId（缺字段时回退集合）
  const bookIds =
    settings.bookMode === 'stack' || !settings.currentBookId
      ? settings.activeBookIds
      : [settings.currentBookId];
  for (const bookId of bookIds) {
    const candidates =
      bookId === BUILTIN_BOOK_ID
        ? await getCoreNewWordCandidates(limit * 2)
        : await listWordsByBook(bookId, limit * 2);
    for (const word of candidates) {
      const stateKey = stateKeyOfNorm(word.norm);
      if (seen.has(stateKey)) {
        continue;
      }
      seen.add(stateKey);
      collected.push(word);
      if (collected.length >= limit) {
        return collected;
      }
    }
  }
  return collected;
};

// ---------- Store ----------

/** 新词提供者可注入（测试与 T08 替换用） */
let newWordProvider: NewWordProvider = defaultNewWordProvider;

export function setNewWordProvider(provider: NewWordProvider): void {
  newWordProvider = provider;
}

export const useSessionStore = create<SessionStoreState>()((set, get) => ({
  status: 'idle',
  machine: null,
  session: null,
  currentWord: null,
  revealed: false,
  cardShownAt: null,
  duePool: [],
  newPool: [],
  settleSummary: null,
  error: null,
  history: [],

  checkResume: async () => {
    const settings = await getSettings();
    const stamp = Date.now();
    const today = studyDayOf(stamp, settings?.dayStartHour ?? 4);
    const snapshot = await getLatestSnapshot();
    if (!snapshot || snapshot.studyDay !== today) {
      return null;
    }
    return {
      sessionId: snapshot.sessionId,
      studyDay: snapshot.studyDay,
      answeredCount: snapshot.answeredCount,
    };
  },

  start: async (options) => {
    try {
      set({ error: null });
      const settings = await getSettings();
      if (!settings) {
        set({ error: '设置尚未初始化' });
        return 'empty';
      }
      const nowTs = Date.now();
      const studyDay = studyDayOf(nowTs, settings.dayStartHour);

      // 1. 跨学习日的 retryCountToday 归零
      await resetStaleRetryCounts(studyDay);

      // 2. 快照 → 遗留卡（同日沿用重现池口径；跨日按「新词」处理但 level 保持）
      const snapshot = await getLatestSnapshot();
      const carryOver: CardItem[] = [];
      const carryKeys = new Set<string>();
      if (snapshot && snapshot.studyDay === studyDay) {
        for (const entry of Object.values(snapshot.retryPool)) {
          carryOver.push({
            key: `retry:${entry.stateKey}:${entry.retryCount}`,
            wordId: entry.wordId,
            stateKey: entry.stateKey,
            kind: 'retry',
            round: entry.retryCount,
          });
          carryKeys.add(entry.stateKey);
        }
        for (const wordId of snapshot.carryOverWordIds) {
          const stateKey = stateKeyOfNorm(normOfWordId(wordId));
          if (carryKeys.has(stateKey)) {
            continue;
          }
          carryOver.push({
            key: `retry:${stateKey}:1`,
            wordId,
            stateKey,
            kind: 'retry',
            round: 1,
          });
          carryKeys.add(stateKey);
        }
      } else if (snapshot && options?.resume === true) {
        // 跨日续学：遗留词按「新词」卡处理（kind='new' 但 level 由 WordState 保持）
        for (const wordId of snapshot.carryOverWordIds) {
          const stateKey = stateKeyOfNorm(normOfWordId(wordId));
          carryOver.push({
            key: `new:${stateKey}:0`,
            wordId,
            stateKey,
            kind: 'new',
            round: 0,
          });
          carryKeys.add(stateKey);
        }
      }

      // 3. 到期复习：整批取出，前 batchSize 进队列，其余进待补池
      const dueAll = await getDueWords(nowTs, settings.sessionBatchSize * 2);
      const dueCards: DueReviewCard[] = dueAll.map((state) => ({
        key: `review:${state.stateKey}:0`,
        wordId: state.wordId,
        stateKey: state.stateKey,
        kind: 'review',
        round: 0,
        dueAt: state.dueAt,
      }));

      // 4. 新词：今日余量 = 生效每日上限（auto 按剩余词数/考试日推算，manual 用设定值）- 今日已学
      const dailyLimit = await resolveDailyNewLimit(settings, studyDay);
      const learnedToday = (await db.studyDays.get(studyDay))?.newLearned ?? 0;
      const newRemaining = Math.max(0, dailyLimit - learnedToday);
      const newWords =
        newRemaining > 0 ? await newWordProvider(settings, newRemaining) : [];
      const newCards = newWords.map(wordToCard).filter((card) => !carryKeys.has(card.stateKey));

      // 5. 组装（carryOver 插队首 min(i,3)、复习 dueAt 升序、新词殿后、stateKey 去重）
      const queueDue = dueCards.slice(0, settings.sessionBatchSize);
      const built = buildSession({
        carryOver,
        dueWords: queueDue,
        newWords: newCards,
        batchSize: settings.sessionBatchSize,
      });
      if (built.queue.length === 0) {
        set({ status: 'idle', error: null });
        return 'empty';
      }

      // 6. 会话记录：同日续学复用未完成记录，否则新建
      const machine = createQueueState(built.plannedTotal, built.queue);
      const priorSessions = await db.sessions.where('studyDay').equals(studyDay).toArray();
      const unfinished = priorSessions
        .filter((s) => s.endedAt === null)
        .sort((l, r) => r.startedAt - l.startedAt)[0];
      const reuse = options?.resume === true ? unfinished : undefined;
      const session: StudySession =
        reuse ?? {
          id: newId('sess'),
          studyDay,
          startedAt: nowTs,
          endedAt: null,
          newCount: 0,
          reviewCount: 0,
          answerCount: 0,
          correctCount: 0,
          ratingCounts: emptyRatingCounts(),
          durationSec: 0,
          unstableWordIds: [],
          deviceId: settings.deviceId,
          updatedAt: nowTs,
          deletedAt: null,
        };

      // 7. 初始快照 + 会话记录落库
      const initialSnapshot: SessionSnapshot = {
        sessionId: session.id,
        studyDay,
        startedAt: session.startedAt,
        updatedAt: nowTs,
        answeredCount: 0,
        retryPool: machine.retryPool,
        ratingCounts: session.ratingCounts,
        carryOverWordIds: [],
      };
      await db.transaction('rw', db.sessions, db.sessionSnapshots, async () => {
        await db.sessions.put(session);
        await db.sessionSnapshots.put(initialSnapshot);
      });

      const head = built.queue[0];
      const headWord = head ? await loadWord(head) : null;
      set({
        status: 'active',
        machine,
        session,
        currentWord: headWord,
        revealed: false,
        cardShownAt: nowTs,
        duePool: dueCards.slice(settings.sessionBatchSize),
        newPool: newWords.filter(
          (word) =>
            !built.queue.some((card) => card.stateKey === stateKeyOfNorm(word.norm)),
        ),
        settleSummary: null,
        history: [],
      });
      return 'started';
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return 'empty';
    }
  },

  reveal: () => {
    if (get().status === 'active' && get().machine?.queue.length) {
      set({ revealed: true });
    }
  },

  submit: async (rating) => {
    const { machine, session, cardShownAt, duePool, newPool } = get();
    if (!machine || !session || machine.queue.length === 0) {
      return;
    }
    const settings = await getSettings();
    if (!settings) {
      set({ error: '设置尚未初始化' });
      return;
    }
    const nowTs = Date.now();
    const current = machine.queue[0];
    if (!current) {
      return;
    }
    const studyDay = studyDayOf(nowTs, settings.dayStartHour);

    // 当前卡的学习状态：新词首答时初始化
    const existing = await db.wordStates.get(current.stateKey);
    const prevState =
      existing ??
      initialWordState(current, nowTs, studyDay);

    // 「上一个」回退快照：作答前的表行（提交成功后才入栈）
    const studyDayBefore = (await db.studyDays.get(studyDay)) ?? null;
    const snapshotBefore = (await db.sessionSnapshots.get(session.id)) ?? null;

    // 补位候选：待补池头部若干（refillTail 自取所需）
    const refill = {
      dueReviews: duePool.slice(0, MIN_QUEUE_SIZE),
      newWords: newPool.slice(0, MIN_QUEUE_SIZE).map(wordToCard),
    };

    // ---- 纯函数调度（五步作答） ----
    const outcome: AnswerOutcome = answer(
      machine,
      {
        rating,
        srsState: prevState,
        durationMs: cardShownAt ? Math.max(0, nowTs - cardShownAt) : 0,
        refill,
        queueBuffer: MIN_QUEUE_SIZE,
        sessionId: session.id,
        deviceId: settings.deviceId,
        srs: srsConfigOf(settings),
        maxRetry: settings.maxRetry,
      },
      nowTs,
      Math.random,
    );

    // ---- 单事务落库（4.1 清单，一次作答一个事务） ----
    const firstAnswer =
      machine.firstRatings[current.stateKey] === undefined;
    const isRetryAnswer = current.kind === 'retry';
    const nextSession: StudySession = {
      ...session,
      answerCount: session.answerCount + 1,
      newCount: session.newCount + (firstAnswer && current.kind === 'new' ? 1 : 0),
      reviewCount:
        session.reviewCount + (firstAnswer && current.kind !== 'new' ? 1 : 0),
      correctCount: session.correctCount + (firstAnswer && rating >= 2 ? 1 : 0),
      ratingCounts: {
        ...session.ratingCounts,
        [String(rating) as '1' | '2' | '3' | '4']:
          session.ratingCounts[String(rating) as '1' | '2' | '3' | '4'] + 1,
      },
      unstableWordIds: outcome.unstable
        ? [...session.unstableWordIds, current.wordId]
        : session.unstableWordIds,
      updatedAt: nowTs,
    };
    const answeredWordIds = firstAnswer
      ? [...(await db.sessionSnapshots.get(session.id))?.carryOverWordIds ?? [], current.wordId]
      : (await db.sessionSnapshots.get(session.id))?.carryOverWordIds ?? [];
    const snapshot: SessionSnapshot = {
      sessionId: session.id,
      studyDay,
      startedAt: session.startedAt,
      updatedAt: nowTs,
      answeredCount: outcome.machine.answeredCount,
      retryPool: outcome.machine.retryPool,
      ratingCounts: nextSession.ratingCounts,
      carryOverWordIds: answeredWordIds,
    };

    try {
      await db.transaction(
        'rw',
        [
          db.wordStates,
          db.reviewLogs,
          db.studyDays,
          db.sessions,
          db.sessionSnapshots,
          db.syncMeta,
        ],
        async () => {
          await db.wordStates.put(outcome.nextWordState);
          await db.reviewLogs.add(outcome.reviewLog);
          // studyDays 增量：answerCount 恒 +1；首次作答计 newLearned/reviewed 与 correctCount
          const day = (await db.studyDays.get(studyDay)) ?? createEmptyDay(studyDay, nowTs);
          await db.studyDays.put({
            ...day,
            newLearned: day.newLearned + (firstAnswer && current.kind === 'new' ? 1 : 0),
            reviewed: day.reviewed + (firstAnswer && current.kind !== 'new' ? 1 : 0),
            answerCount: day.answerCount + 1,
            correctCount: day.correctCount + (firstAnswer && rating >= 2 ? 1 : 0),
            retryAnswers: day.retryAnswers + (isRetryAnswer ? 1 : 0),
            updatedAt: nowTs,
          });
          await db.sessions.put(nextSession);
          await db.sessionSnapshots.put(snapshot);
          // 标脏：wordstate 分片 / reviewlog 月片 / study.json
          await markDirty(wordStateEntityOf(current.stateKey), 1);
          await markDirty(reviewLogEntityOf(outcome.reviewLog.answeredAt), 1);
          await markDirty('study.json', 1);
        },
      );
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return; // 落库失败不切卡：状态留在当前卡，用户重试
    }

    // ---- 回退历史入栈（提交成功才记；back 时据此逆向恢复） ----
    const entry: BackHistoryEntry = {
      stateKey: current.stateKey,
      studyDay,
      machine: cloneMachine(machine),
      session,
      duePool,
      newPool,
      cardShownAt: cardShownAt ?? nowTs,
      wordStateBefore: existing ?? null,
      studyDayBefore,
      snapshotBefore,
      submittedAt: nowTs,
      reviewLogId: outcome.reviewLog.id,
    };
    const history = get().history;
    set({ history: [...history.slice(-(MAX_BACK_HISTORY - 1)), entry] });

    // ---- 补位池扣减（refillTail 从头部按序取用） ----
    const nextDuePool = duePool.slice(outcome.refillTaken.due);
    const nextNewPool = newPool.slice(outcome.refillTaken.new);

    // ---- 结算判定 ----
    if (outcome.settled) {
      const durationSec = Math.min(
        SESSION_DURATION_CAP_SEC,
        Math.round((nowTs - session.startedAt) / 1000),
      );
      const finished: StudySession = {
        ...nextSession,
        endedAt: nowTs,
        durationSec,
        updatedAt: nowTs,
      };
      try {
        await db.transaction(
          'rw',
          db.sessions,
          db.studyDays,
          db.sessionSnapshots,
          db.syncMeta,
          async () => {
            await db.sessions.put(finished);
            // 结算才把本次会话时长计入 StudyDay（按 30 分钟截断）
            const day =
              (await db.studyDays.get(studyDay)) ?? createEmptyDay(studyDay, nowTs);
            await db.studyDays.put({ ...day, durationSec: day.durationSec + durationSec, updatedAt: nowTs });
            await db.sessionSnapshots.delete(session.id);
            await markDirty('study.json', 1);
          },
        );
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
      set({
        status: 'settled',
        machine: outcome.machine,
        session: finished,
        duePool: nextDuePool,
        newPool: nextNewPool,
        settleSummary: {
          answeredCount: outcome.machine.answeredCount,
          accuracy: computeAccuracy(outcome.machine),
          ratingCounts: finished.ratingCounts,
          durationSec,
          unstableCount: finished.unstableWordIds.length,
        },
      });
      return;
    }

    // ---- 切下一张卡（先落库成功，才走到这里） ----
    const nextCard = outcome.machine.queue[0] ?? null;
    const nextWord = nextCard ? await loadWord(nextCard) : null;
    set({
      machine: outcome.machine,
      session: nextSession,
      currentWord: nextWord,
      revealed: false,
      cardShownAt: nowTs,
      duePool: nextDuePool,
      newPool: nextNewPool,
    });
  },

  back: async () => {
    const { history } = get();
    const entry = history[history.length - 1];
    if (!entry) {
      return;
    }
    // 单事务逆向恢复：恢复/删除作答写入的五张表行，再重标脏
    try {
      await db.transaction(
        'rw',
        [
          db.wordStates,
          db.reviewLogs,
          db.studyDays,
          db.sessions,
          db.sessionSnapshots,
          db.syncMeta,
        ],
        async () => {
          if (entry.wordStateBefore) {
            await db.wordStates.put(entry.wordStateBefore);
          } else {
            await db.wordStates.delete(entry.stateKey);
          }
          await db.reviewLogs.delete(entry.reviewLogId);
          if (entry.studyDayBefore) {
            await db.studyDays.put(entry.studyDayBefore);
          } else {
            await db.studyDays.delete(entry.studyDay);
          }
          await db.sessions.put(entry.session);
          if (entry.snapshotBefore) {
            await db.sessionSnapshots.put(entry.snapshotBefore);
          } else {
            await db.sessionSnapshots.delete(entry.session.id);
          }
          await markDirty(wordStateEntityOf(entry.stateKey), 1);
          await markDirty(reviewLogEntityOf(entry.submittedAt), 1);
          await markDirty('study.json', 1);
        },
      );
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return; // 恢复失败不动内存态，用户可重试
    }
    const prevCard = entry.machine.queue[0] ?? null;
    const prevWord = prevCard ? await loadWord(prevCard) : null;
    set({
      machine: entry.machine,
      session: entry.session,
      currentWord: prevWord,
      // 回退即已看过答案：直接进入已揭示态，便于立刻改评分
      revealed: true,
      cardShownAt: entry.cardShownAt,
      duePool: entry.duePool,
      newPool: entry.newPool,
      history: history.slice(0, -1),
      error: null,
    });
  },

  exit: () => {
    // 快照随每次作答写入，异常退出后可由 checkResume + start({resume:true}) 恢复
    set({
      status: 'idle',
      machine: null,
      session: null,
      currentWord: null,
      revealed: false,
      cardShownAt: null,
      settleSummary: null,
      history: [],
    });
  },

  addNewWords: async (count) => {
    const { machine } = get();
    if (!machine || count <= 0) {
      return 0;
    }
    const settings = await getSettings();
    if (!settings) {
      set({ error: '设置尚未初始化' });
      return 0;
    }
    // 已在队列 / 本会话已答过的词不再重复加入
    const taken = new Set<string>(machine.queue.map((card) => card.stateKey));
    for (const key of Object.keys(machine.firstRatings)) {
      taken.add(key);
    }
    // 多取一些候选，避免被去重后不足 count 条
    const candidates = await newWordProvider(settings, count + taken.size);
    const picked: CardItem[] = [];
    const pickedNorms = new Set<string>();
    for (const word of candidates) {
      const stateKey = stateKeyOfNorm(word.norm);
      if (taken.has(stateKey)) {
        continue;
      }
      taken.add(stateKey);
      pickedNorms.add(word.norm);
      picked.push(wordToCard(word));
      if (picked.length >= count) {
        break;
      }
    }
    if (picked.length === 0) {
      return 0;
    }
    // 尾插：队首（当前卡）与已排定的重现位置都不受影响
    set({
      machine: {
        ...machine,
        queue: [...machine.queue, ...picked],
        plannedTotal: machine.plannedTotal + picked.length,
        status: 'active',
      },
      newPool: get().newPool.filter((word) => !pickedNorms.has(word.norm)),
    });
    return picked.length;
  },
}));

// ---------- 辅助 ----------

/**
 * 生效的每日新词上限（PlanPage / HomePage 与本 store 共用同一口径）。
 *
 * - manual：用户设定值（收敛到 1~200）；
 * - auto：按当前词书剩余词数 ÷ 距考试天数推算（suggestDailyNew，上限 50）；
 *   词书总量未知（索引不可用/导入词书为空）或已学完时，回退用户设定值；
 * - quota：每日总学习量口径 = 待复习词 + 新学词，复习优先占满、余量给新词。
 *   当日待复习数 countDueByBook 已超过总量时新词为 0；新词上限沿用
 *   NEW_WORD_LIMIT_MAX（200），manual 设定不参与 quota 模式。
 */
export async function resolveDailyNewLimit(
  settings: Settings,
  todayKey: StudyDayKey,
): Promise<number> {
  const manual = clampNewWordLimit(settings.newWordLimit);
  if (settings.newWordLimitMode === 'quota') {
    const quota = clampDailyStudyQuota(settings.dailyStudyQuota ?? DEFAULT_DAILY_STUDY_QUOTA);
    try {
      const bookId = currentBookIdOf(settings);
      const dueNow = await countDueByBook(bookId, Date.now());
      // 新词 = 每日学习量 − 到期复习（上限 NEW_WORD_LIMIT_MAX=200），复习优先、余量给新词
      return Math.max(0, Math.min(quota, NEW_WORD_LIMIT_MAX) - dueNow);
    } catch {
      return Math.max(0, Math.min(quota, NEW_WORD_LIMIT_MAX));
    }
  }
  if (settings.newWordLimitMode === 'manual') {
    return manual;
  }
  try {
    const bookId = currentBookIdOf(settings);
    let total: number | null;
    if (bookId === BUILTIN_BOOK_ID) {
      total = peekCoreIndex()?.total ?? null;
      if (total === null) {
        total = (await loadCoreIndex()).total;
      }
    } else {
      total = await countWordsByBook(bookId);
    }
    if (!total) {
      return manual;
    }
    const learned = await countLearnedByBook(bookId);
    const remaining = Math.max(0, total - learned);
    const days = daysUntil(settings.examDate || DEFAULT_EXAM_DATE, todayKey);
    return effectiveDailyNew('auto', manual, suggestDailyNew(remaining, days));
  } catch {
    return manual;
  }
}

/**
 * 取当前卡词内容。
 *
 * 必须走 wordRepo 的三级查找（words 表 → 内置索引 → 分片水合）：
 * 内置核心词库正文按需懒加载（T08），不落在 db.words 里——直接查表对
 * `core:{norm}` 形态的 wordId 永远 miss，会导致学习页整卡显示「没有找到这个单词」。
 * DB 与分片都无此词（如已删除的导入词）时返回 null，UI 层兜底。
 */
async function loadWord(card: CardItem): Promise<Word | null> {
  return (await getWord(card.wordId)) ?? null;
}

/** 导出给结算页的进度计算（避免 UI 直接 import 纯函数层） */
export { computeAccuracy, nextStudyDay0400, refillTail, buildSession };
