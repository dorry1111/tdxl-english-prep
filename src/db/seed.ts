/**
 * 首次启动的数据初始化。
 *
 * 做四件事（幂等，可重复调用）：
 * 1. 写入默认 Settings（含本机 deviceId、默认考试日期）；
 * 2. 写入内置词库的 WordBook 元信息（词条正文按需懒加载，见 T08）；
 * 3. 创建「生词本」虚拟词库；
 * 4. 导入内置示范卷（T15：`public/data/exams/demo-a.json` / `demo-b.json`，
 *    由独立的试卷管线产出；文件不存在时静默跳过，绝不编造数据）。
 */
import {
  BUILTIN_BOOK_ID,
  BUILTIN_BOOK_NAME,
  BUILTIN_BOOK_PRIORITY,
  BUILTIN_BOOK_WORD_COUNT,
  DAY_START_HOUR,
  DEFAULT_DAILY_STUDY_QUOTA,
  DEFAULT_EXAM_DATE,
  DEFAULT_NEW_WORD_LIMIT,
  MAX_RETRY,
  NOTEBOOK_BOOK_ID,
  NOTEBOOK_BOOK_NAME,
  NOTEBOOK_BOOK_PRIORITY,
  RETRY_GAP_MAX,
  RETRY_GAP_MIN,
  SCHEMA_VERSION,
  SESSION_BATCH_SIZE,
} from '@/constants';
import { openDb } from '@/db';
import { buildExamFromJson } from '@/lib/importers/examJson';
import { newId } from '@/lib/id';
import { now } from '@/lib/time';
import { IS_IOS } from '@/lib/platform';
import type { Settings, WordBook } from '@/types';

import { applyLocalDefaults, ensureSettings, getSecret, getSettings } from './repos/settingsRepo';
import { getBook, upsertBook } from './repos/bookRepo';
import { getExam, savePaper } from './repos/examRepo';

/** 构造默认设置（deviceId 需要持久化，所以只在首次创建时生成一次） */
export function buildDefaultSettings(stamp: number = now()): Settings {
  return {
    id: 'global',
    examDate: DEFAULT_EXAM_DATE,
    activeBookIds: [BUILTIN_BOOK_ID],
    bookMode: 'single',
    currentBookId: BUILTIN_BOOK_ID,
    newWordLimit: DEFAULT_NEW_WORD_LIMIT,
    newWordLimitMode: 'auto',
    dailyStudyQuota: DEFAULT_DAILY_STUDY_QUOTA,
    retryGapMin: RETRY_GAP_MIN,
    retryGapMax: RETRY_GAP_MAX,
    maxRetry: MAX_RETRY,
    dayStartHour: DAY_START_HOUR,
    sessionBatchSize: SESSION_BATCH_SIZE,
    ttsEnabled: true,
    ttsAutoPlay: true,
    ttsRate: 1,
    ttsAccent: 'uk',
    ttsDefaultsV2: true,
    theme: 'auto',
    fontScale: 1,
    // iOS 默认开启同步并直连局域网 NAS（地址由 mDNS 发现填充）；其余端保持原默认
    syncEnabled: IS_IOS,
    webdavUrl: IS_IOS ? '' : 'https://dav.jianguoyun.com/dav/',
    webdavUser: '',
    useProxy: false,
    proxyUrl: '',
    deviceId: newId('dev'),
    lastSyncAt: null,
    lastExportAt: null,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: stamp,
    deletedAt: null,
  };
}

/** 构造内置词库元信息 */
export function buildBuiltinBook(stamp: number = now()): WordBook {
  return {
    id: BUILTIN_BOOK_ID,
    name: BUILTIN_BOOK_NAME,
    source: 'builtin',
    wordCount: BUILTIN_BOOK_WORD_COUNT,
    enabled: true,
    priority: BUILTIN_BOOK_PRIORITY,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  };
}

/** 构造生词本虚拟词库 */
export function buildNotebookBook(stamp: number = now()): WordBook {
  return {
    id: NOTEBOOK_BOOK_ID,
    name: NOTEBOOK_BOOK_NAME,
    source: 'virtual-notebook',
    wordCount: 0,
    enabled: true,
    priority: NOTEBOOK_BOOK_PRIORITY,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  };
}

/** 初始化结果，便于启动日志与自检展示 */
export interface SeedResult {
  settingsCreated: boolean;
  builtinBookCreated: boolean;
  notebookBookCreated: boolean;
  /** 本次实际导入的示范卷数（已存在或文件缺失都计 0） */
  demoExamCount: number;
  /** 本次是否触发了 iOS「默认开启云同步」迁移（用于一次性 toast 提示） */
  iosSyncEnabled: boolean;
}

/** 内置示范卷的固定试卷 ID（与 JSON 文件名一一对应） */
export const DEMO_EXAM_IDS: readonly string[] = ['demo-a', 'demo-b'];

/**
 * 导入一份试卷 JSON（T15 数据层接口）。
 *
 * 流程：`buildExamFromJson` 按 PRD 8.3 校验（错误带字段路径），
 * 通过后经 `examRepo.savePaper()` 整卷事务落库（再次校验区段分值合计），
 * 并置 `parseStatus = 'verified'` 使其可直接模拟。
 *
 * @param json    试卷 JSON（PRD 8.3 结构），未知内容直接抛 `AppError('INVALID_INPUT')`
 * @param options 可指定固定 paperId（示范卷用），缺省取 `paper.id` 或由标题生成；
 *                `recalled: true` 走回忆版宽容校验（2023-2025 内置卷：客观题允许无答案）
 * @returns 落库的试卷 ID
 */
export async function importExamJson(
  json: unknown,
  options: { paperId?: string; recalled?: boolean } = {},
): Promise<string> {
  const built = buildExamFromJson(json, options);
  const exam = { ...built.exam, parseStatus: 'verified' as const };
  await savePaper(exam, built.passages, built.questions);
  return exam.id;
}

/** 示范卷加载器：返回 null 表示「文件不存在，跳过」 */
export type DemoExamLoader = (paperId: string) => Promise<unknown | null>;

/**
 * 默认加载器：从应用基路径拉取 `data/exams/<paperId>.json`。
 * 任何网络/解析失败都视为「文件不存在」，由调用方跳过（PWA 离线预缓存的
 * JSON 会在可用时命中，开发期或管线未产出时静默跳过，不阻塞启动）。
 */
async function fetchDemoExam(paperId: string): Promise<unknown | null> {
  try {
    const base = import.meta.env.BASE_URL ?? '/';
    const response = await fetch(`${base}data/exams/${paperId}.json`);
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * 按需导入内置示范卷（幂等）：已存在的试卷跳过，缺失的 JSON 跳过。
 *
 * 注意：JSON 内容不合法时**不吞异常**——示范卷必须通过 PRD 8.3 与
 * savePaper 的分值校验后才能入库，坏数据应该让启动失败而不是静默带病运行。
 *
 * @param loader 可注入的加载器（测试用；默认 fetch 静态文件）
 * @returns 本次实际导入的试卷数
 */
export async function ensureDemoExamsSeeded(loader: DemoExamLoader = fetchDemoExam): Promise<number> {
  let imported = 0;
  for (const paperId of DEMO_EXAM_IDS) {
    if (await getExam(paperId)) {
      continue; // 已导入过，幂等跳过
    }
    const json = await loader(paperId);
    if (json === null) {
      continue; // 文件不存在（管线未产出），跳过不报错
    }
    await importExamJson(json, { paperId });
    imported += 1;
  }
  return imported;
}

/**
 * 执行初始化。重复调用不会产生重复数据。
 */
export async function ensureSeeded(): Promise<SeedResult> {
  await openDb();
  const stamp = now();

  const hadSettings = (await getSettings()) !== undefined;
  await ensureSettings(buildDefaultSettings(stamp));

  // TTS 默认口径 v2（2026-10-25）：英式发音 + 出卡自动朗读。
  // 这两个字段此前从未有设置 UI，`ttsDefaultsV2` 缺失即旧版默认值（us/false），
  // 一次性升级；升级后用户在设置页改出的任何组合都不会再被覆盖。
  // v1.10.1：迁移改走 applyLocalDefaults（不顶 updatedAt、不标脏）——
  // 否则迁移后本机 updatedAt 永远新于远端，settings.json 整条 LWW 死锁，
  // 其它设备改的每日学习量等真实配置同步不进来。
  const current = await getSettings();
  if (current && current.ttsDefaultsV2 !== true) {
    await applyLocalDefaults({ ttsAccent: 'uk', ttsAutoPlay: true, ttsDefaultsV2: true });
  }

  // iOS 同步默认开启迁移（v1.8.0 一次性，对标 ttsDefaultsV2 的标志位模式）：
  // 旧版 iOS 安装升级上来时 syncEnabled 默认是 false，这里一次性打开——
  // 仅当用户尚未配置过任何 WebDAV 信息（地址为空且未存密码）时才开启，
  // 已配置过同步的用户绝不改动其现有开关。幂等：标记位写入后，
  // 此后用户手动关闭 syncEnabled 永不覆盖。
  let iosSyncEnabled = false;
  if (current && IS_IOS && current.iosSyncDefaultsApplied !== true) {
    const unconfigured = current.webdavUrl.trim() === '' && (await getSecret()) === null;
    if (unconfigured && current.syncEnabled !== true) {
      // v1.10.1：applyLocalDefaults（不顶 updatedAt、不标脏），理由见 ttsDefaultsV2 迁移注释
      await applyLocalDefaults({ syncEnabled: true, iosSyncDefaultsApplied: true });
      iosSyncEnabled = true;
    } else {
      await applyLocalDefaults({ iosSyncDefaultsApplied: true });
    }
  }

  let builtinBookCreated = false;
  if (!(await getBook(BUILTIN_BOOK_ID))) {
    await upsertBook(buildBuiltinBook(stamp));
    builtinBookCreated = true;
  }

  let notebookBookCreated = false;
  if (!(await getBook(NOTEBOOK_BOOK_ID))) {
    await upsertBook(buildNotebookBook(stamp));
    notebookBookCreated = true;
  }

  const demoExamCount = await ensureDemoExamsSeeded();

  return {
    settingsCreated: !hadSettings,
    builtinBookCreated,
    notebookBookCreated,
    demoExamCount,
    iosSyncEnabled,
  };
}
