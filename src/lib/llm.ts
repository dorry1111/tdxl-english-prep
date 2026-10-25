/**
 * 大模型客户端（搜索弹窗「AI 释义」/ 回看页「AI 讲解」/ 错题本「AI 诊断」/ 计划页「AI 评估」）。
 *
 * 设计取舍：
 * - 三家（DeepSeek / Kimi / 豆包）的 chat API 都是 OpenAI 兼容的
 *   `POST {baseUrl}/chat/completions`，只用「地址 + 模型名 + Key」三个参数即可统一，
 *   因此 provider 预设只决定默认 baseUrl 与默认模型名，调用层完全同构；
 * - `stream: false` 一次拿全文：输出都是短文（数百字），流式无收益还复杂；
 * - API Key 走 secrets 表（见 settingsRepo.getLlmKey），绝不进入 Settings / 同步 / 日志；
 * - PWA 从 NAS 站点直连大模型 API 可能被浏览器 CORS 拦截，桌面版无此限制 ——
 *   失败时由调用方展示 hintProxy 提示，不在本模块做代理回退（将来可走 NAS 反代）。
 *   因此除「AI 释义」历史先例外，新增三功能均为桌面端独占（IS_DESKTOP 门控在调用方）。
 */
import type { Settings } from '@/types';

export type LlmProviderId = NonNullable<Settings['llmProvider']>;

export interface LlmProviderPreset {
  id: LlmProviderId;
  /** 设置页与释义卡标题里的显示名（释义卡会显示成「{label}释义」） */
  label: string;
  /** 默认 API 地址（OpenAI 兼容根路径，不带尾斜杠） */
  baseUrl: string;
  /** 默认模型名（豆包建议填接入点 ep-xxx 或最新的 doubao 系列模型） */
  model: string;
}

/** 三家预设 + 自定义（自定义时 baseUrl/model 必填） */
export const LLM_PRESETS: Record<LlmProviderId, LlmProviderPreset> = {
  deepseek: { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  kimi: { id: 'kimi', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  doubao: {
    id: 'doubao',
    label: '豆包',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1-6-250615',
  },
  custom: { id: 'custom', label: '自定义', baseUrl: '', model: '' },
} as const;

/** 组装好的调用配置（null = 还没配好，不能发起请求） */
export interface LlmConfig {
  provider: LlmProviderId;
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

/**
 * 从 Settings + API Key 解析调用配置。
 *
 * @returns null 表示「未配置」：provider 未选，或 custom 时 baseUrl/model 为空。
 *          apiKey 为空不算未配置（是否已存 key 由调用方查 secrets 决定）。
 */
export function resolveLlmConfig(settings: Settings, apiKey: string | null): LlmConfig | null {
  const provider = settings.llmProvider;
  if (!provider) {
    return null;
  }
  const preset = LLM_PRESETS[provider];
  const baseUrl = (settings.llmBaseUrl ?? preset.baseUrl).trim();
  const model = (settings.llmModel ?? preset.model).trim();
  if (baseUrl === '' || model === '') {
    return null;
  }
  return { provider, label: preset.label, baseUrl: baseUrl.replace(/\/+$/, ''), model, apiKey: apiKey ?? '' };
}

/** 默认请求超时（毫秒）：长尾模型偶尔慢，给足但不至于让用户干等 */
const EXPLAIN_TIMEOUT_MS = 30_000;

/**
 * 通用 chat 内核：system + user 两条消息，一次拿全文。
 * 网络/HTTP/解析错误统一抛 Error（message 已是用户可读的中文）。
 */
export async function chat(
  config: LlmConfig,
  systemPrompt: string,
  userContent: string,
  timeoutMs = EXPLAIN_TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new Error('API Key 无效或无权限，请到「我的」检查。');
      }
      if (response.status === 429) {
        throw new Error('调用频率超限，稍后再试。');
      }
      throw new Error(`请求失败（HTTP ${response.status}）${detail.slice(0, 120)}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content?.trim() ?? '';
    if (content === '') {
      throw new Error('模型返回了空内容，请稍后再试。');
    }
    return content;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('请求超时，请检查网络后重试。');
    }
    if (error instanceof TypeError) {
      // fetch 的 CORS/断网都表现为 TypeError
      throw new Error(
        '无法连接到大模型接口：可能断网，或网页版被浏览器跨域拦截（电脑版无此限制）。',
      );
    }
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}

/** 单词释义的系统提示词：约束输出结构，稳定、简短、可读 */
const EXPLAIN_SYSTEM_PROMPT = [
  '你是一名英汉词典助手。用户给你一个英文单词，请用简体中文输出该词的释义，格式如下：',
  '音标：英/美式音标（没有则省略）',
  '释义：按词性分组列出常用义项，最多 5 条，每条一行（如 n. 苹果）',
  '例句：1 个地道英文例句 + 中文翻译',
  '搭配：2~3 个常用短语搭配',
  '要求：只输出以上内容，不要寒暄和解释；不认识的词如实说明。',
].join('\n');

/** 请求释义。网络/HTTP/解析错误统一抛 Error（message 已是用户可读的中文） */
export async function explainWord(config: LlmConfig, word: string): Promise<string> {
  return chat(config, EXPLAIN_SYSTEM_PROMPT, word);
}

// ---------- AI 讲解（回看页：真题题目逐题精讲） ----------

/** 讲解请求超时：题目上下文长、输出五段，给 60s */
const EXPLAIN_QUESTION_TIMEOUT_MS = 60_000;

/** 题目讲解输入（调用方从真题 JSON 组装） */
export interface ExplainQuestionInput {
  /** 试卷标识，如 2024 */
  paperId: string;
  /** 题型，如 reading / vocabulary / cloze */
  sectionType: string;
  /** 题干 */
  stem: string;
  /** 选项文本（有序，与 answerIndex 对应） */
  options: string[];
  /** 正确选项下标（0 起） */
  answerIndex: number;
  /** 原文段落（可截断；对话/词汇题无原文） */
  passage?: string;
  /** 题库自带解析（可能为空——2023 起四卷即无解析） */
  explanation?: string;
}

const EXPLAIN_QUESTION_SYSTEM_PROMPT = [
  '你是同等学力申硕英语考试的阅卷老师，为学生逐题精讲真题。用户给你一道题的完整信息，',
  '请用简体中文按以下五段固定结构输出（每段标题原样保留）：',
  '【题目精译】题干与选项的准确中文翻译',
  '【长难句拆解】题干或原文中最难句子的结构分析（主谓宾/从句层级）+ 整句翻译；没有长难句就点明最简单的一句',
  '【正确选项】正确选项的原文依据（定位句 + 同义替换说明）',
  '【干扰项排除】逐个错误选项说明为什么错（偷换概念/无中生有/张冠李戴/绝对化）',
  '【考点提炼】本题考查的能力点与可迁移的解题方法（一句话）',
  '要求：只输出以上五段；依据给定材料讲解，不引入材料外信息；语气像老师在复盘错题。',
].join('\n');

/** 请求题目讲解（回看页「AI 讲解」按钮） */
export async function explainQuestion(
  config: LlmConfig,
  input: ExplainQuestionInput,
): Promise<string> {
  const lines: string[] = [];
  lines.push(`试卷：${input.paperId} 题型：${input.sectionType}`);
  lines.push(`题干：${input.stem}`);
  input.options.forEach((option, index) => {
    const mark = index === input.answerIndex ? '（正确选项）' : '';
    lines.push(`选项 ${String.fromCharCode(65 + index)}${mark}：${option}`);
  });
  if (input.answerIndex < 0) {
    lines.push('注意：本题无官方答案（回忆版），请基于材料推断最合理选项并说明理由。');
  }
  if (input.passage && input.passage.trim()) {
    lines.push(`原文：${input.passage.slice(0, 1500)}`);
  }
  if (input.explanation && input.explanation.trim()) {
    lines.push(`题库解析：${input.explanation.slice(0, 600)}`);
  }
  return chat(config, EXPLAIN_QUESTION_SYSTEM_PROMPT, lines.join('\n'), EXPLAIN_QUESTION_TIMEOUT_MS);
}

// ---------- AI 诊断（错题本：批量错因归因报告） ----------

/** 诊断请求超时：批量错题 + 结构化报告，给 90s */
const DIAGNOSE_TIMEOUT_MS = 90_000;

/** 单条错题的输入摘要 */
export interface WrongItemBrief {
  sectionType: string;
  stem: string;
  options: string[];
  answerIndex: number;
  /** 该题累计错误次数 */
  wrongCount: number;
}

const DIAGNOSE_SYSTEM_PROMPT = [
  '你是同等学力申硕英语的备考教练。用户给你一批近期错题，请输出一份错因归因诊断报告，',
  '用简体中文按以下四段固定结构输出：',
  '【错因分布】把错题归入五类：词汇量不足 / 长难句理解 / 定位偏差 / 选项混淆 / 粗心失误，',
  '  给出每类的题数与占比，并各附一句判断依据',
  '【Top3 薄弱点】最急需解决的三个薄弱环节，按严重程度排序，每个配 1 道典型错题的题干预览',
  '【规律洞察】从题型/错误次数/时间分布里看出的模式（如「cloze 连续错 3 题都错在固定搭配」）',
  '【7天行动建议】具体到每天做什么（如「每天精读 2 段阅读定位训练 + 复盘 5 个熟词僻义」）',
  '要求：只输出以上四段；结论必须引用给定错题证据，不写空话；错题不足 5 道时如实说明样本有限。',
].join('\n');

/** 请求错题诊断报告（错题本「AI 诊断」按钮；调用方限制最多 50 题） */
export async function diagnoseWrong(config: LlmConfig, items: WrongItemBrief[]): Promise<string> {
  const lines: string[] = [`共 ${items.length} 道错题：`];
  items.forEach((item, index) => {
    lines.push(
      `${index + 1}. [${item.sectionType}] ${item.stem}｜选项: ${item.options.join(' / ')}｜正确: ${String.fromCharCode(65 + item.answerIndex)}｜错 ${item.wrongCount} 次`,
    );
  });
  return chat(config, DIAGNOSE_SYSTEM_PROMPT, lines.join('\n'), DIAGNOSE_TIMEOUT_MS);
}

// ---------- AI 评估（计划页：学习计划调整建议） ----------

const ADVISE_PLAN_SYSTEM_PROMPT = [
  '你是同等学力申硕英语的备考规划教练。用户给你当前学习计划的运行指标，',
  '请用简体中文按以下三段固定结构输出调整建议：',
  '【健康度结论】一句话判断当前计划能否按期达成，指出最大风险',
  '【参数建议】给出每日新词量的建议值（整数）与理由；复习压力大时优先保复习而不是加新词',
  '【执行提醒】2~3 条本周执行要点（如哪天开始冲刺主观题）',
  '要求：只输出以上三段；建议必须由给定指标推导；用户会人工确认后才会采纳，不要替用户下决心。',
].join('\n');

/** 计划评估输入（调用方从 planLogic 指标组装） */
export interface AdvisePlanInput {
  /** 考试倒计时天数 */
  daysUntilExam: number | null;
  /** 剩余未学词数 */
  remainingWords: number;
  /** 当前每日新词量 */
  dailyNew: number;
  /** 预计学完日期文案 */
  estimatedFinish: string;
  /** 是否会错过考试日期 */
  willMissDeadline: boolean;
  /** 复习压力：今日到期 / 明日 / 本周 / 生词本 */
  dueNow: number;
  dueTomorrow: number;
  dueThisWeek: number;
  inNotebook: number;
}

/** 请求计划评估建议（计划页「AI 评估」按钮；结果仅建议，采纳由用户确认） */
export async function advisePlan(config: LlmConfig, input: AdvisePlanInput): Promise<string> {
  const lines = [
    `考试倒计时：${input.daysUntilExam ?? '未设置'} 天`,
    `剩余未学词数：${input.remainingWords}`,
    `当前每日新词量：${input.dailyNew}`,
    `预计学完日期：${input.estimatedFinish}`,
    `是否会错过考试：${input.willMissDeadline ? '是' : '否'}`,
    `复习压力：今日到期 ${input.dueNow} / 明日 ${input.dueTomorrow} / 本周 ${input.dueThisWeek} / 生词本 ${input.inNotebook}`,
  ];
  return chat(config, ADVISE_PLAN_SYSTEM_PROMPT, lines.join('\n'));
}
