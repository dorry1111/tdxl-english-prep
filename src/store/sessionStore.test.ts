/**
 * sessionStore 集成测试（T07 验收：store 编排 + 单事务落库 + 恢复链路）。
 *
 * 跑在 fake-indexeddb 上，验证 4.1 落库清单在真实 Dexie 事务中成立：
 * 每次作答 → wordStates/reviewLogs/studyDays/sessions/sessionSnapshots/syncMeta 一致。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { BUILTIN_BOOK_ID, DAY_START_HOUR } from '@/constants';
import { db } from '@/db';
import { getSettings, patchSettings } from '@/db/repos/settingsRepo';
import { ensureSeeded } from '@/db/seed';
import { dayjs } from '@/lib/dayjs';
import { stateKeyOfNorm } from '@/lib/hash';
import { studyDayOf } from '@/lib/srs/studyDay';
import { setCoreFetcher } from '@/lib/wordbookCache';
import { now } from '@/lib/time';
import {
  resolveDailyNewLimit,
  setNewWordProvider,
  useSessionStore,
} from '@/store/sessionStore';
import type { Word, WordState } from '@/types';

function makeWord(headword: string): Word {
  const stamp = now();
  return {
    id: `${BUILTIN_BOOK_ID}:${headword.toLowerCase()}`,
    bookId: BUILTIN_BOOK_ID,
    headword,
    norm: headword.toLowerCase(),
    meanings: [{ pos: 'n.', cn: '测试释义' }],
    frequencyRank: 1,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  };
}

function makeDueState(norm: string, dueAt: number): WordState {
  const stamp = now();
  return {
    stateKey: stateKeyOfNorm(norm),
    wordId: `${BUILTIN_BOOK_ID}:${norm}`,
    bookId: BUILTIN_BOOK_ID,
    level: 1,
    dueAt,
    lastRating: 3,
    lastReviewAt: stamp,
    firstLearnedAt: stamp,
    reviewCount: 1,
    correctCount: 1,
    wrongCount: 0,
    lapseCount: 0,
    retryCountToday: 0,
    retryDay: '2020-01-01',
    unstable: false,
    isStarred: false,
    masteredAt: null,
    updatedAt: stamp,
    deletedAt: null,
  };
}

/** 装载测试数据：5 个新词 + 2 个到期复习词（复习词也需要词条正文供卡片展示） */
async function seedStudyData(): Promise<Word[]> {
  await ensureSeeded();
  const words = ['apple', 'brave', 'cloud', 'dance', 'eagle', 'zulu', 'yankee'].map(makeWord);
  await db.words.bulkPut(words);
  const base = now() - 60_000;
  await db.wordStates.bulkPut([
    makeDueState('zulu', base + 1000),
    makeDueState('yankee', base + 2000),
  ]);
  return words;
}

/** 重置 store 单例状态，避免用例间污染 */
function resetStore(): void {
  useSessionStore.setState({
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
  });
}

beforeEach(() => {
  resetStore();
});

describe('sessionStore.start', () => {
  it('装载复习词（dueAt 升序）+ 新词，写会话记录与初始快照', async () => {
    const words = await seedStudyData();
    setNewWordProvider(async () => words);

    const result = await useSessionStore.getState().start();
    expect(result).toBe('started');

    const { machine, session, currentWord } = useSessionStore.getState();
    expect(machine).not.toBeNull();
    expect(session).not.toBeNull();
    // 前 2 张是复习词（dueAt 升序：zulu 1000 < yankee 2000），后 5 张新词
    expect(machine!.queue.map((c) => c.kind)).toEqual([
      'review',
      'review',
      'new',
      'new',
      'new',
      'new',
      'new',
    ]);
    expect(machine!.queue[0]!.wordId).toBe(`${BUILTIN_BOOK_ID}:zulu`);
    expect(currentWord?.norm).toBe('zulu');
    expect(machine!.plannedTotal).toBe(7);

    // 会话记录与快照已落库
    const stored = session ? await db.sessions.get(session.id) : undefined;
    expect(stored?.endedAt).toBeNull();
    const snapshot = session ? await db.sessionSnapshots.get(session.id) : undefined;
    expect(snapshot?.answeredCount).toBe(0);
  });

  it('无词可学时返回 empty', async () => {
    await ensureSeeded();
    setNewWordProvider(async () => []);
    const result = await useSessionStore.getState().start();
    expect(result).toBe('empty');
    expect(useSessionStore.getState().status).toBe('idle');
  });
});

describe('sessionStore.submit（单事务落库清单）', () => {
  it('一次作答同时更新六张表，落库成功才切卡', async () => {
    const words = await seedStudyData();
    setNewWordProvider(async () => words);
    await useSessionStore.getState().start();

    const before = useSessionStore.getState();
    const firstCard = before.machine!.queue[0]!;
    useSessionStore.getState().reveal();
    expect(useSessionStore.getState().revealed).toBe(true);

    await useSessionStore.getState().submit(3);
    const after = useSessionStore.getState();

    // 队列切到下一张（落库成功才会切）
    expect(after.machine!.queue).toHaveLength(6);
    expect(after.machine!.queue[0]!.wordId).toBe(`${BUILTIN_BOOK_ID}:yankee`);
    expect(after.currentWord?.norm).toBe('yankee');
    expect(after.revealed).toBe(false);

    // wordStates：L=1 的复习词答「认识」→ L=2（NEXT_LEVEL_TABLE.KNOWN[1]=2）
    const state = await db.wordStates.get(firstCard.stateKey);
    expect(state?.level).toBe(2);
    expect(state?.dueAt).toBeGreaterThan(now());

    // reviewLogs：恰好一条，字段齐全
    const logs = await db.reviewLogs.where('sessionId').equals(before.session!.id).toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.stateKey).toBe(firstCard.stateKey);
    expect(logs[0]?.rating).toBe(3);
    expect(logs[0]?.isRetry).toBe(false);

    // studyDays：answerCount+1、reviewed+1、correctCount+1
    const day = await db.studyDays.get(studyDayOf(now(), DAY_START_HOUR));
    expect(day?.answerCount).toBe(1);
    expect(day?.reviewed).toBe(1);
    expect(day?.newLearned).toBe(0);
    expect(day?.correctCount).toBe(1);

    // sessions 累计值
    const storedSession = await db.sessions.get(before.session!.id);
    expect(storedSession?.answerCount).toBe(1);
    expect(storedSession?.reviewCount).toBe(1);
    expect(storedSession?.ratingCounts['3']).toBe(1);

    // 快照推进
    const snapshot = await db.sessionSnapshots.get(before.session!.id);
    expect(snapshot?.answeredCount).toBe(1);
    expect(snapshot?.carryOverWordIds).toContain(firstCard.wordId);
  });

  it('新词首答计入 newLearned，FORGOT 重新入队且 isRetry=true', async () => {
    const words = await seedStudyData();
    setNewWordProvider(async () => words);
    await useSessionStore.getState().start();

    const store = useSessionStore.getState();
    // 先答掉两张复习词（认识）
    await store.submit(3);
    await useSessionStore.getState().submit(3);
    // 当前是新词 → 不认识
    const newCard = useSessionStore.getState().machine!.queue[0]!;
    expect(newCard.kind).toBe('new');
    await useSessionStore.getState().submit(1);

    const after = useSessionStore.getState();
    // 新词插回队列（min(k, len)，rnd=Math.random），队列里出现 retry 卡
    expect(after.machine!.queue.some((c) => c.stateKey === newCard.stateKey && c.kind === 'retry')).toBe(true);
    const day = await db.studyDays.get(studyDayOf(now(), DAY_START_HOUR));
    expect(day?.newLearned).toBe(1);
    // 重现轮口径：首答 FORGOT 不算 retryAnswers，重现轮再答时才 +1
    expect(day?.retryAnswers).toBe(0);

    const logs = await db.reviewLogs.where('sessionId').equals(after.session!.id).toArray();
    expect(logs[2]?.isRetry).toBe(false); // 首答不是重现轮
  });
});

describe('sessionStore 结算', () => {
  it('队列空且重现池空 → 写 endedAt、清快照、出结算摘要', async () => {
    const words = await seedStudyData();
    setNewWordProvider(async () => words);
    await useSessionStore.getState().start();

    // 全部答「认识」：7 张卡各答一次，无 FORGOT 不产生重现
    for (let i = 0; i < 7; i++) {
      await useSessionStore.getState().submit(3);
    }
    const settled = useSessionStore.getState();
    expect(settled.status).toBe('settled');
    expect(settled.machine!.queue).toHaveLength(0);
    expect(settled.session?.endedAt).not.toBeNull();
    expect(settled.settleSummary).not.toBeNull();
    expect(settled.settleSummary?.answeredCount).toBe(7);
    expect(settled.settleSummary?.accuracy.rate).toBe(1);
    expect(settled.settleSummary?.ratingCounts['3']).toBe(7);

    // 快照已清理
    expect(await db.sessionSnapshots.get(settled.session!.id)).toBeUndefined();
    // 会话时长已计入 StudyDay
    const day = await db.studyDays.get(studyDayOf(now(), DAY_START_HOUR));
    expect(day?.answerCount).toBe(7);
  });
});

describe('sessionStore 恢复链路（R9）', () => {
  it('作答后退出 → checkResume 命中同日快照 → resume 续接同一会话', async () => {
    const words = await seedStudyData();
    setNewWordProvider(async () => words);
    await useSessionStore.getState().start();

    const firstSessionId = useSessionStore.getState().session!.id;
    // 答一张「不认识」产生重现卡，随后退出
    const forgotCard = useSessionStore.getState().machine!.queue[0]!;
    await useSessionStore.getState().submit(1);
    useSessionStore.getState().exit();
    expect(useSessionStore.getState().status).toBe('idle');

    const resume = await useSessionStore.getState().checkResume();
    expect(resume?.sessionId).toBe(firstSessionId);

    // 续学：遗留词（含 FORGOT 卡）出现在队首区域
    await useSessionStore.getState().start({ resume: true });
    const resumed = useSessionStore.getState();
    expect(resumed.status).toBe('active');
    expect(resumed.session!.id).toBe(firstSessionId); // 复用未完成会话记录
    const headKeys = resumed.machine!.queue.slice(0, 4).map((c) => c.stateKey);
    expect(headKeys).toContain(forgotCard.stateKey);

    // 清空队列完成续学会话（全部认识；可能出现多轮重现，上限 MAX_RETRY）
    for (let i = 0; i < 40 && useSessionStore.getState().machine!.queue.length > 0; i++) {
      await useSessionStore.getState().submit(3);
    }
    const final = useSessionStore.getState();
    expect(final.status).toBe('settled');
    expect(final.session!.id).toBe(firstSessionId);
    // 同一会话的累计作答数 = 退出前 1 次 + 续学完成次数 ≥ 8
    const stored = await db.sessions.get(firstSessionId);
    expect(stored!.answerCount).toBeGreaterThanOrEqual(8);
    expect(stored!.endedAt).not.toBeNull();
  });
});

describe('核心词库分片回退（回归：学习页整卡显示「没有找到这个单词」）', () => {
  it('新词只存在于内置分片（db.words 无记录）时，start 后 currentWord 经三级查找水合成功', async () => {
    // 真实设备路径：内置词正文按需懒加载（T08），db.words 里没有 core:* 词条。
    // 注入假索引 + 假分片模拟该形态；若 loadWord 只查 db.words（历史 bug），
    // currentWord 会是 null，学习页整卡显示「没有找到这个单词」。
    const shardWord: Word = {
      id: 'core:kappa',
      bookId: BUILTIN_BOOK_ID,
      headword: 'kappa',
      norm: 'kappa',
      meanings: [{ pos: 'n.', cn: '希腊字母第十个' }],
      frequencyRank: 1,
      createdAt: now(),
      updatedAt: now(),
      deletedAt: null,
    };
    setCoreFetcher(async (url) => {
      if (url.includes('core-index.json')) {
        return {
          bookId: BUILTIN_BOOK_ID,
          version: 2,
          total: 1,
          shards: ['core-k.json'],
          entries: [['kappa', 'kappa', 0, 1, 'core-k.json']],
        };
      }
      return { letter: 'k', words: [shardWord] };
    });
    try {
      await ensureSeeded();
      // 隔离：清掉同文件前序用例遗留的到期复习与快照，保证队首是新词卡
      await db.wordStates.clear();
      await db.sessionSnapshots.clear();
      resetStore();
      // 前序用例会注入自定义提供者且不随 beforeEach 重置——显式注入，
      // 返回「只存在于分片、db.words 无记录」的词条（与 getCoreNewWordCandidates 同形态）
      setNewWordProvider(async () => [shardWord]);
      const result = await useSessionStore.getState().start();
      expect(result).toBe('started');

      const { currentWord, machine } = useSessionStore.getState();
      expect(machine!.queue[0]!.wordId).toBe('core:kappa');
      expect(currentWord).not.toBeNull();
      expect(currentWord?.id).toBe('core:kappa');
      expect(currentWord?.headword).toBe('kappa');
      expect(currentWord?.meanings[0]?.cn).toBe('希腊字母第十个');
    } finally {
      setCoreFetcher(undefined); // 恢复默认 fetcher 并清空索引/分片缓存
    }
  });
});

describe('resolveDailyNewLimit（每日新词量口径）', () => {
  it('manual：直接用设定值，不查词库索引', async () => {
    await ensureSeeded();
    await patchSettings({ newWordLimitMode: 'manual', newWordLimit: 7 });
    const settings = (await getSettings())!;
    const todayKey = studyDayOf(Date.now(), settings.dayStartHour);
    await expect(resolveDailyNewLimit(settings, todayKey)).resolves.toBe(7);
  });

  it('auto：按剩余词数 ÷ 剩余天数推算，并夹到上限 50', async () => {
    setCoreFetcher(async (url) => {
      if (url.includes('core-index.json')) {
        return {
          bookId: BUILTIN_BOOK_ID,
          version: 2,
          total: 1000,
          shards: ['core-a.json'],
          entries: [],
        };
      }
      return { letter: 'a', words: [] };
    });
    try {
      await ensureSeeded();
      const todayKey = studyDayOf(Date.now(), 4);
      const examDate = dayjs(todayKey).add(2, 'day').format('YYYY-MM-DD');
      await patchSettings({ newWordLimitMode: 'auto', newWordLimit: 3, examDate });
      // 剩余 1000 词、2 天 → ceil(500) 超上限 → 50
      const settings = (await getSettings())!;
      await expect(resolveDailyNewLimit(settings, todayKey)).resolves.toBe(50);
    } finally {
      setCoreFetcher(undefined);
    }
  });

  it('auto：索引不可用时回退用户设定值', async () => {
    await ensureSeeded();
    await patchSettings({ newWordLimitMode: 'auto', newWordLimit: 9 });
    const settings = (await getSettings())!;
    const todayKey = studyDayOf(Date.now(), settings.dayStartHour);
    // 默认 fetcher 在 jsdom 里拉不到 /data/words/core-index.json → catch 回退
    await expect(resolveDailyNewLimit(settings, todayKey)).resolves.toBe(9);
  });

  it('quota：总量 = 待复习 + 新词，待复习未满时余量给新词', async () => {
    await ensureSeeded();
    const todayKey = studyDayOf(Date.now(), DAY_START_HOUR);
    const stamp = now();
    // 当前词库 2 个今日到期（dueAt ≤ now 且已开始学习）
    await db.wordStates.bulkPut([
      makeDueState('due-one', stamp - 60_000),
      makeDueState('due-two', stamp - 60_000),
    ]);
    // 总量 15、待复习 2 → 新词 = min(15, 200) − 2 = 13（manual 设定不参与）
    await patchSettings({
      newWordLimitMode: 'quota',
      newWordLimit: 20,
      dailyStudyQuota: 15,
    });
    const settings = (await getSettings())!;
    await expect(resolveDailyNewLimit(settings, todayKey)).resolves.toBe(13);
  });

  it('quota：总量远大于待复习时，新词受 NEW_WORD_LIMIT_MAX(200) 收敛', async () => {
    await ensureSeeded();
    const todayKey = studyDayOf(Date.now(), DAY_START_HOUR);
    // 总量 500、无待复习 → min(500, 200) − 0 = 200（manual=20 不参与）
    await patchSettings({ newWordLimitMode: 'quota', newWordLimit: 20, dailyStudyQuota: 500 });
    const settings = (await getSettings())!;
    await expect(resolveDailyNewLimit(settings, todayKey)).resolves.toBe(200);
  });

  it('quota：待复习已占满/超过总量时新词为 0', async () => {
    await ensureSeeded();
    const todayKey = studyDayOf(Date.now(), DAY_START_HOUR);
    const stamp = now();
    // 30 个今日到期 > 总量 10 → 新词 0
    const due = Array.from({ length: 30 }, (_, index) =>
      makeDueState(`due-many-${index}`, stamp - 60_000),
    );
    await db.wordStates.bulkPut(due);
    await patchSettings({ newWordLimitMode: 'quota', newWordLimit: 20, dailyStudyQuota: 10 });
    const settings = (await getSettings())!;
    await expect(resolveDailyNewLimit(settings, todayKey)).resolves.toBe(0);
  });

  it('quota：dailyStudyQuota 非法值时按 clamp 收敛（0 → 10）', async () => {
    await ensureSeeded();
    const todayKey = studyDayOf(Date.now(), DAY_START_HOUR);
    // 无待复习：新词 = min(clamp(0), 200) − 0 = 10
    await patchSettings({ newWordLimitMode: 'quota', newWordLimit: 20, dailyStudyQuota: 0 });
    const settings = (await getSettings())!;
    await expect(resolveDailyNewLimit(settings, todayKey)).resolves.toBe(10);
  });
});

describe('sessionStore.back（上一个）', () => {
  it('撤销最近一次作答：五张表恢复、reviewLog 删除、队列回退到上一张卡', async () => {
    const words = await seedStudyData();
    setNewWordProvider(async () => words);
    await useSessionStore.getState().start();

    const before = useSessionStore.getState();
    const headKey = before.machine!.queue[0]!.stateKey;
    const headStateBefore = await db.wordStates.get(headKey);
    expect(headStateBefore).toBeDefined(); // zulu 是到期复习卡
    expect(await db.reviewLogs.count()).toBe(0);

    // 作答一次（认识）
    await useSessionStore.getState().submit(3);
    const answered = useSessionStore.getState();
    expect(answered.machine!.answeredCount).toBe(1);
    expect(answered.session!.answerCount).toBe(1);
    expect(await db.reviewLogs.count()).toBe(1);
    expect(answered.history).toHaveLength(1);
    const wordStateAfterAnswer = await db.wordStates.get(headKey);
    expect(wordStateAfterAnswer).not.toEqual(headStateBefore); // 调度已推进

    // 回退：队列、计数、表行全部还原
    await useSessionStore.getState().back();
    const restored = useSessionStore.getState();
    expect(restored.machine!.queue[0]!.wordId).toBe(`${BUILTIN_BOOK_ID}:zulu`);
    expect(restored.machine!.answeredCount).toBe(0);
    expect(restored.machine!.queue).toHaveLength(before.machine!.queue.length);
    expect(restored.session!.answerCount).toBe(0);
    expect(restored.session!.ratingCounts['3']).toBe(0);
    expect(restored.revealed).toBe(true); // 回退即已揭示，可直接改评分
    expect(restored.currentWord?.norm).toBe('zulu');
    expect(await db.reviewLogs.count()).toBe(0);
    expect(await db.wordStates.get(headKey)).toEqual(headStateBefore);
    const snapshot = await db.sessionSnapshots.get(restored.session!.id);
    expect(snapshot?.answeredCount).toBe(0);
    expect(restored.history).toHaveLength(0);
  });

  it('无历史时 back 为 no-op；再作答后历史重新入栈', async () => {
    const words = await seedStudyData();
    setNewWordProvider(async () => words);
    await useSessionStore.getState().start();
    expect(useSessionStore.getState().history).toHaveLength(0);

    await useSessionStore.getState().back(); // no-op，不抛错
    expect(useSessionStore.getState().status).toBe('active');
    expect(useSessionStore.getState().machine!.answeredCount).toBe(0);

    await useSessionStore.getState().submit(2);
    expect(useSessionStore.getState().history).toHaveLength(1);
  });
});
