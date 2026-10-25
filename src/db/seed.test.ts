/**
 * seed 示范卷导入接口单测（T15 数据层）。
 *
 * 示范卷 JSON 本体由试卷管线产出（public/data/exams/*.json），
 * 这里用注入 loader 验证导入 / 幂等 / 缺文件跳过 / 坏数据报错四条链路。
 *
 * iOS 迁移测试通过 getter mock 控制平台标志（IS_IOS 在原生壳内才为 true，
 * jsdom/PWA 环境恒为 false，因此必须可注入）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 平台标志的测试内可控状态（vi.hoisted 保证 mock 工厂与测试共享同一引用） */
const platformState = vi.hoisted(() => ({ isIos: false }));

vi.mock('@/lib/platform', () => ({
  get IS_IOS() {
    return platformState.isIos;
  },
  get IS_NATIVE() {
    return platformState.isIos;
  },
  IS_ANDROID: false,
}));

import { db } from '@/db';
import { setSecret } from '@/db/repos/settingsRepo';
import { DEMO_EXAM_IDS, ensureDemoExamsSeeded, ensureSeeded, importExamJson } from '@/db/seed';
import { getPaperDetail } from '@/db/repos/examRepo';
import type { DemoExamLoader } from '@/db/seed';
import type { ExamJsonFile } from '@/lib/importers/examJson';

/** 最小合法卷：7 题型各 1 题，总分 10（importExamJson 不强制标准结构，只校验自洽） */
function buildMinimalJson(paperTitle: string): ExamJsonFile {
  const objective: ExamJsonFile['questions'] = (
    [
      'dialogue',
      'vocabulary',
      'reading',
      'cloze',
      'short-completion',
    ] as const
  ).map((sectionType, index) => ({
    id: `q${index + 1}`,
    sectionType,
    passageId: null,
    seq: index + 1,
    stem: `第 ${index + 1} 题`,
    options: [
      { key: 'A', text: 'A' },
      { key: 'B', text: 'B' },
    ],
    answerKey: 'A',
    referenceAnswer: null,
    explanation: '',
    score: 1,
  }));
  return {
    schemaVersion: 1,
    paper: {
      title: paperTitle,
      timeLimitSec: 9000,
      totalScore: 10,
      sections: [
        { type: 'dialogue', order: 1, questionCount: 1, score: 1 },
        { type: 'vocabulary', order: 2, questionCount: 1, score: 1 },
        { type: 'reading', order: 3, questionCount: 1, score: 1 },
        { type: 'cloze', order: 4, questionCount: 1, score: 1 },
        { type: 'short-completion', order: 5, questionCount: 1, score: 1 },
        { type: 'translation', order: 6, questionCount: 1, score: 2 },
        { type: 'writing', order: 7, questionCount: 1, score: 3 },
      ],
    },
    passages: [],
    questions: [
      ...objective,
      {
        id: 'q6',
        sectionType: 'translation',
        passageId: null,
        seq: 6,
        stem: 'Translate the sentence.',
        referenceAnswer: '参考译文',
        score: 2,
      },
      {
        id: 'q7',
        sectionType: 'writing',
        passageId: null,
        seq: 7,
        stem: 'Write an essay.',
        referenceAnswer: '范文',
        score: 3,
      },
    ],
  };
}

function loaderOf(map: Record<string, unknown | null>): DemoExamLoader {
  return async (paperId) => map[paperId] ?? null;
}

describe('importExamJson', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it('合法 JSON 整卷落库并置 parseStatus=verified', async () => {
    const paperId = await importExamJson(buildMinimalJson('最小卷'), { paperId: 'demo-x' });
    expect(paperId).toBe('demo-x');
    const detail = await getPaperDetail('demo-x');
    expect(detail.exam?.parseStatus).toBe('verified');
    expect(detail.exam?.totalQuestions).toBe(7);
    expect(detail.exam?.totalScore).toBe(10);
    expect(detail.questions).toHaveLength(7);
    expect(detail.questions[5]?.isObjective).toBe(false);
  });

  it('非法 JSON（分值合计不符）抛 INVALID_INPUT 且不落库', async () => {
    const json = buildMinimalJson('坏卷');
    json.paper.totalScore = 99;
    await expect(importExamJson(json, { paperId: 'demo-bad' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(await db.exams.count()).toBe(0);
    expect(await db.questions.count()).toBe(0);
    expect(await db.syncMeta.count()).toBe(0);
  });
});

describe('ensureDemoExamsSeeded', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it('JSON 文件不存在（loader 返回 null）→ 静默跳过不报错', async () => {
    const imported = await ensureDemoExamsSeeded(loaderOf({}));
    expect(imported).toBe(0);
    expect(await db.exams.count()).toBe(0);
  });

  it('demo-a 可导入、demo-b 缺失 → 只导入 1 份；重复调用幂等', async () => {
    const loader = loaderOf({ 'demo-a': buildMinimalJson('示范卷 A') });
    expect(await ensureDemoExamsSeeded(loader)).toBe(1);
    expect(await db.exams.get('demo-a')).not.toBeUndefined();
    expect(await db.exams.get('demo-b')).toBeUndefined();
    // 第二次：已存在 → 跳过
    expect(await ensureDemoExamsSeeded(loader)).toBe(0);
    expect(await db.exams.count()).toBe(1);
  });

  it('两份示范卷都能导入（loader 返回不同内容）', async () => {
    const loader = loaderOf({
      'demo-a': buildMinimalJson('示范卷 A'),
      'demo-b': buildMinimalJson('示范卷 B'),
    });
    expect(await ensureDemoExamsSeeded(loader)).toBe(2);
    expect(await db.exams.count()).toBe(2);
    const a = await getPaperDetail('demo-a');
    const b = await getPaperDetail('demo-b');
    expect(a.exam?.title).toBe('示范卷 A');
    expect(b.exam?.title).toBe('示范卷 B');
  });

  it('JSON 内容不合法时不吞异常（示范卷坏数据必须暴露）', async () => {
    const bad = buildMinimalJson('坏示范卷');
    bad.paper.totalScore = 999;
    await expect(
      ensureDemoExamsSeeded(loaderOf({ 'demo-a': bad })),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await db.exams.count()).toBe(0);
  });

  it('DEMO_EXAM_IDS 固定为 demo-a / demo-b', () => {
    expect(DEMO_EXAM_IDS).toEqual(['demo-a', 'demo-b']);
  });
});

describe('ensureSeeded', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it('完整初始化幂等：示范卷缺失时 demoExamCount 为 0，重复调用不重复写入', async () => {
    const first = await ensureSeeded();
    expect(first.demoExamCount).toBe(0);
    expect(first.settingsCreated).toBe(true);
    expect(first.builtinBookCreated).toBe(true);
    expect(first.notebookBookCreated).toBe(true);
    const second = await ensureSeeded();
    expect(second.settingsCreated).toBe(false);
    expect(second.builtinBookCreated).toBe(false);
    expect(second.notebookBookCreated).toBe(false);
    expect(second.demoExamCount).toBe(0);
  });

  it('ensureSeeded 也会导入已就位的示范卷（走注入场景验证整链）', async () => {
    // 先手动放一份，模拟「上次启动已导入」
    await importExamJson(buildMinimalJson('示范卷 A'), { paperId: 'demo-a' });
    const result = await ensureSeeded();
    expect(result.demoExamCount).toBe(0); // demo-a 已存在，demo-b 缺文件跳过
    expect(await db.exams.count()).toBe(1);
  });
});

describe('ensureSeeded：TTS 默认口径 v2 迁移', () => {
  it('旧版默认值（us/false/无标记）一次性升级为 uk/true/标记', async () => {
    // 模拟旧版安装留下的设置：无 ttsDefaultsV2 标记
    await db.settings.put({
      ...buildLegacySettings(),
    });
    await ensureSeeded();
    const settings = (await db.settings.get('global'))!;
    expect(settings.ttsAccent).toBe('uk');
    expect(settings.ttsAutoPlay).toBe(true);
    expect(settings.ttsDefaultsV2).toBe(true);
  });

  it('已迁移（有标记）时尊重用户当前组合，不再覆盖', async () => {
    const legacy = buildLegacySettings();
    await db.settings.put({
      ...legacy,
      ttsAccent: 'us', // 用户迁移后自己改回美式
      ttsAutoPlay: false, // 并关闭自动发音
      ttsDefaultsV2: true,
    });
    await ensureSeeded();
    const settings = (await db.settings.get('global'))!;
    expect(settings.ttsAccent).toBe('us');
    expect(settings.ttsAutoPlay).toBe(false);
  });
});

describe('ensureSeeded：iOS syncEnabled 一次性迁移（v1.8.0）', () => {
  beforeEach(async () => {
    platformState.isIos = false;
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it('iOS 且未配置过 WebDAV：一次性开启 syncEnabled，SeedResult.iosSyncEnabled=true', async () => {
    platformState.isIos = true;
    const legacy = { ...buildLegacySettings(), webdavUrl: '' };
    await db.settings.put(legacy);
    const result = await ensureSeeded();
    expect(result.iosSyncEnabled).toBe(true);
    const settings = (await db.settings.get('global'))!;
    expect(settings.syncEnabled).toBe(true);
    expect(settings.iosSyncDefaultsApplied).toBe(true);
  });

  it('幂等：迁移后手动关闭 syncEnabled，再次 seed 不覆盖（永不复活）', async () => {
    platformState.isIos = true;
    const legacy = { ...buildLegacySettings(), webdavUrl: '' };
    await db.settings.put(legacy);
    await ensureSeeded();
    expect((await db.settings.get('global'))?.syncEnabled).toBe(true);

    // 用户手动关闭
    const current = (await db.settings.get('global'))!;
    await db.settings.put({ ...current, syncEnabled: false, updatedAt: current.updatedAt + 1000 });

    const second = await ensureSeeded();
    expect(second.iosSyncEnabled).toBe(false);
    expect((await db.settings.get('global'))?.syncEnabled).toBe(false);
  });

  it('已配置过同步（webdavUrl 非空）的 iOS 用户：不改动现有开关，仅打标记', async () => {
    platformState.isIos = true;
    // buildLegacySettings 自带坚果云地址且 syncEnabled=false：视为已配置过
    await db.settings.put(buildLegacySettings());
    const result = await ensureSeeded();
    expect(result.iosSyncEnabled).toBe(false);
    const settings = (await db.settings.get('global'))!;
    expect(settings.syncEnabled).toBe(false);
    expect(settings.iosSyncDefaultsApplied).toBe(true);
  });

  it('secret 已存在但 webdavUrl 为空：视为已配置过，仅打标记不覆盖 syncEnabled', async () => {
    platformState.isIos = true;
    const legacy = { ...buildLegacySettings(), webdavUrl: '' };
    await db.settings.put(legacy);
    // 密码已保存 = 用户配置过同步（只是地址此刻为空），绝不替用户打开开关
    await setSecret('saved-password');
    const result = await ensureSeeded();
    expect(result.iosSyncEnabled).toBe(false);
    const settings = (await db.settings.get('global'))!;
    expect(settings.syncEnabled).toBe(false);
    expect(settings.iosSyncDefaultsApplied).toBe(true);
  });

  it('PWA / 非原生端：不触发迁移（IS_IOS=false）', async () => {
    platformState.isIos = false;
    const legacy = { ...buildLegacySettings(), webdavUrl: '' };
    await db.settings.put(legacy);
    const result = await ensureSeeded();
    expect(result.iosSyncEnabled).toBe(false);
    const settings = (await db.settings.get('global'))!;
    expect(settings.syncEnabled).toBe(false);
    expect(settings.iosSyncDefaultsApplied).toBeUndefined();
  });
});

/** 旧版默认设置（2026-10-25 之前：美式 + 不自动朗读 + 无迁移标记） */
function buildLegacySettings() {
  const stamp = Date.now();
  return {
    id: 'global' as const,
    examDate: '2027-05-16',
    activeBookIds: ['core'],
    bookMode: 'single' as const,
    currentBookId: 'core',
    newWordLimit: 20,
    newWordLimitMode: 'auto' as const,
    retryGapMin: 3,
    retryGapMax: 5,
    maxRetry: 5,
    dayStartHour: 4,
    sessionBatchSize: 200,
    ttsEnabled: true,
    ttsAutoPlay: false,
    ttsRate: 1,
    ttsAccent: 'us' as const,
    theme: 'auto' as const,
    fontScale: 1,
    syncEnabled: false,
    webdavUrl: 'https://dav.jianguoyun.com/dav/',
    webdavUser: '',
    useProxy: false,
    proxyUrl: '',
    deviceId: 'dev_test',
    lastSyncAt: null,
    lastExportAt: null,
    schemaVersion: 2,
    updatedAt: stamp,
    deletedAt: null,
  };
}
