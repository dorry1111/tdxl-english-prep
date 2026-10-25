/**
 * lib/llm.ts 单元测试（AI 释义 / AI 讲解 / AI 诊断 / AI 评估）。
 *
 * fetch 用 globalThis 打桩（vitest.stubGlobal），每例后还原。
 * 覆盖：配置解析四态、成功路径、401/429/空内容/断网四类错误映射、
 * 三个新函数的请求体装配（正确选项标记 / 回忆版无答案提示 / 截断）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Settings } from '@/types';
import {
  advisePlan,
  diagnoseWrong,
  explainQuestion,
  explainWord,
  resolveLlmConfig,
} from './llm';

const BASE_SETTINGS: Settings = {
  id: 'global',
  schemaVersion: 4,
  theme: 'auto',
  fontScale: 1,
  examDate: '2027-05',
  activeBookIds: [],
  bookMode: 'single',
  newWordLimitMode: 'auto',
  newWordLimit: 20,
  dailyStudyQuota: 100,
  retryGapMin: 3,
  retryGapMax: 5,
  maxRetry: 5,
  dayStartHour: 4,
  sessionBatchSize: 200,
  ttsAccent: 'us',
  ttsAutoPlay: false,
  ttsEnabled: true,
  ttsRate: 1,
  syncEnabled: false,
  webdavUrl: '',
  webdavUser: '',
  useProxy: false,
  proxyUrl: '',
  deviceId: 'test-device',
  lastSyncAt: null,
  lastExportAt: null,
  llmProvider: 'deepseek',
  updatedAt: 0,
  deletedAt: null,
};

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(impl as unknown as typeof fetch));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function okChat(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveLlmConfig', () => {
  it('未选 provider 返回 null', () => {
    expect(resolveLlmConfig({ ...BASE_SETTINGS, llmProvider: undefined }, 'k')).toBeNull();
  });

  it('预设默认值与自定义覆盖', () => {
    const preset = resolveLlmConfig(BASE_SETTINGS, 'key-1');
    expect(preset).toMatchObject({
      provider: 'deepseek',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'key-1',
    });
    const custom = resolveLlmConfig(
      {
        ...BASE_SETTINGS,
        llmProvider: 'custom',
        llmBaseUrl: 'https://example.com/v1/',
        llmModel: 'm-1',
      },
      null,
    );
    expect(custom?.baseUrl).toBe('https://example.com/v1'); // 去尾斜杠
    expect(custom?.apiKey).toBe(''); // key 为空不算未配置
  });

  it('custom 缺 baseUrl/model 返回 null', () => {
    expect(
      resolveLlmConfig({ ...BASE_SETTINGS, llmProvider: 'custom', llmBaseUrl: '' }, 'k'),
    ).toBeNull();
  });
});

describe('explainWord', () => {
  it('成功返回正文', async () => {
    stubFetch(async () => okChat('音标：/ˈsʌbdʒɪkt/\n释义：n. 主题'));
    const config = resolveLlmConfig(BASE_SETTINGS, 'k')!;
    await expect(explainWord(config, 'subject')).resolves.toContain('主题');
  });

  it('401 → Key 无效中文提示', async () => {
    stubFetch(async () => jsonResponse({}, 401));
    const config = resolveLlmConfig(BASE_SETTINGS, 'k')!;
    await expect(explainWord(config, 'x')).rejects.toThrow('API Key 无效');
  });

  it('429 → 限频提示', async () => {
    stubFetch(async () => jsonResponse({}, 429));
    const config = resolveLlmConfig(BASE_SETTINGS, 'k')!;
    await expect(explainWord(config, 'x')).rejects.toThrow('频率超限');
  });

  it('空内容 → 抛错', async () => {
    stubFetch(async () => okChat('   '));
    const config = resolveLlmConfig(BASE_SETTINGS, 'k')!;
    await expect(explainWord(config, 'x')).rejects.toThrow('空内容');
  });

  it('TypeError → 断网/CORS 提示', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const config = resolveLlmConfig(BASE_SETTINGS, 'k')!;
    await expect(explainWord(config, 'x')).rejects.toThrow('跨域');
  });
});

describe('explainQuestion', () => {
  it('装配正确选项标记与原文截断', async () => {
    let sentBody: Record<string, unknown> = {};
    stubFetch(async (_url, init) => {
      sentBody = JSON.parse(String(init?.body ?? '{}'));
      return okChat('【题目精译】…');
    });
    const config = resolveLlmConfig(BASE_SETTINGS, 'k')!;
    await explainQuestion(config, {
      paperId: '2024',
      sectionType: 'reading',
      stem: 'The study suggests that ____',
      options: ['A 文本', 'B 文本', 'C 文本', 'D 文本'],
      answerIndex: 1,
      passage: 'x'.repeat(3000),
      explanation: '定位第二段',
    });
    const messages = sentBody.messages as Array<{ role: string; content: string }>;
    const user = messages[1]?.content ?? '';
    expect(user).toContain('试卷：2024');
    expect(user).toContain('选项 B（正确选项）');
    expect(user).not.toContain('选项 A（正确选项）');
    expect(user).toContain('题库解析：定位第二段');
    // 原文截断到 1500
    expect(user).toContain('原文：' + 'x'.repeat(1500));
    expect(user).not.toContain('x'.repeat(1501));
  });

  it('回忆版（answerIndex=-1）附无答案提示', async () => {
    let sentBody: Record<string, unknown> = {};
    stubFetch(async (_url, init) => {
      sentBody = JSON.parse(String(init?.body ?? '{}'));
      return okChat('ok');
    });
    const config = resolveLlmConfig(BASE_SETTINGS, 'k')!;
    await explainQuestion(config, {
      paperId: '2024',
      sectionType: 'reading',
      stem: 'stem',
      options: ['a', 'b'],
      answerIndex: -1,
    });
    const messages = sentBody.messages as Array<{ role: string; content: string }>;
    expect(messages[1]?.content).toContain('回忆版');
  });
});

describe('diagnoseWrong', () => {
  it('装配错题清单（序号/题型/选项/正确项/错误次数）', async () => {
    let sentBody: Record<string, unknown> = {};
    stubFetch(async (_url, init) => {
      sentBody = JSON.parse(String(init?.body ?? '{}'));
      return okChat('【错因分布】…');
    });
    const config = resolveLlmConfig(BASE_SETTINGS, 'k')!;
    await diagnoseWrong(config, [
      { sectionType: 'cloze', stem: '题1', options: ['a', 'b'], answerIndex: 0, wrongCount: 3 },
      { sectionType: 'reading', stem: '题2', options: ['c', 'd'], answerIndex: 1, wrongCount: 1 },
    ]);
    const messages = sentBody.messages as Array<{ role: string; content: string }>;
    const user = messages[1]?.content ?? '';
    expect(user).toContain('共 2 道错题');
    expect(user).toContain('1. [cloze] 题1');
    expect(user).toContain('正确: A');
    expect(user).toContain('错 3 次');
    expect(user).toContain('正确: B');
  });
});

describe('advisePlan', () => {
  it('装配计划指标（含未设置考试日期的兜底）', async () => {
    let sentBody: Record<string, unknown> = {};
    stubFetch(async (_url, init) => {
      sentBody = JSON.parse(String(init?.body ?? '{}'));
      return okChat('【健康度结论】…');
    });
    const config = resolveLlmConfig(BASE_SETTINGS, 'k')!;
    await advisePlan(config, {
      daysUntilExam: null,
      remainingWords: 4200,
      dailyNew: 20,
      estimatedFinish: '2027-09-01',
      willMissDeadline: true,
      dueNow: 130,
      dueTomorrow: 40,
      dueThisWeek: 300,
      inNotebook: 88,
    });
    const messages = sentBody.messages as Array<{ role: string; content: string }>;
    const user = messages[1]?.content ?? '';
    expect(user).toContain('考试倒计时：未设置');
    expect(user).toContain('剩余未学词数：4200');
    expect(user).toContain('是否会错过考试：是');
    expect(user).toContain('今日到期 130 / 明日 40 / 本周 300 / 生词本 88');
  });
});
