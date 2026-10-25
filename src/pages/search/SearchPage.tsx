/**
 * P16 全局搜索页（路由 /search；桌面版「单词搜索」弹窗复用同一页面）。
 *
 * - 三段结果（P4 搜索增强）：
 *   ① 单词——英文前缀 + 中文释义双语搜索（wordRepo.searchBilingual，输入防抖 300ms）；
 *   ② 试卷——试卷标题子串匹配，点击进开考页；
 *   ③ 真题整句——语料内存索引（lib/search/corpusIndex），点击跳该卷最近一次
 *      作答的解析页并定位到题目（?q=<questionId>）；没有作答记录则进开考页。
 * - 单词结果：词头 + 释义首行 + 词书标签 + 必应词典外链按钮，点击行进词条详情；
 * - AI 释义：在「我的」配置大模型（DeepSeek / Kimi / 豆包 / 自定义）后，
 *   对最匹配的词自动请求释义，展示为「{服务商}释义」卡片（lib/llm.ts）；
 *   词库未收录（零结果）时用查询词兜底请求 AI，保证任何词都有释义；
 *   展示顺位：本地词库 / 试卷 / 真题整句命中在前，AI 释义固定在最后；
 * - 三态：初始（未输入）、无结果、加载中；索引不可用时只退化为 DB 结果，不阻塞页面。
 *
 * 文案：messages.ts 本批次由另一工程师独占，页面文案用本文件 TEXT 承接。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { ListRow } from '@/components/ui/ListRow';
import { Tag } from '@/components/ui/Tag';
import { ROUTES } from '@/constants';
import { listByPaper } from '@/db/repos/attemptRepo';
import { listBooks } from '@/db/repos/bookRepo';
import { listExams } from '@/db/repos/examRepo';
import { getLlmKey, getSettings } from '@/db/repos/settingsRepo';
import { IS_DESKTOP } from '@/lib/desktop';
import { explainWord, resolveLlmConfig } from '@/lib/llm';
import { searchBilingual } from '@/db/repos/wordRepo';
import { searchCorpus, type CorpusHit } from '@/lib/search/corpusIndex';
import type { Exam, Word } from '@/types';

import { SEARCH_DEBOUNCE_MS, SEARCH_LIMIT, normalizeQuery, shouldSearch } from './searchLogic';

const TEXT = {
  title: '搜索',
  placeholder: '输入英文单词、中文释义、试卷或原句',
  inputLabel: '搜索',
  clear: '清空',
  hintInitial: '支持：英文单词前缀（app → apple）、中文释义（苹果）、试卷标题、真题原句。',
  searching: '搜索中…',
  noResultTitle: '没有匹配的结果',
  noResultDesc: '词库未收录时，下方会由 AI 直接给出释义；也可换个拼写或确认该词在已启用的词库中。',
  errorText: '搜索失败，请稍后重试。',
  resultCount: (count: number): string => `找到 ${count} 个单词`,
  bookFallback: '未知词书',
  bing: '必应',
  bingAria: (word: string): string => `在必应词典打开 ${word}`,
  aiTitle: (label: string): string => `${label}释义`,
  aiLoading: '正在请求释义…',
  sectionWords: '单词',
  sectionPapers: '试卷',
  sectionSentences: '真题原句',
  paperMeta: (total: number): string => `共 ${total} 题`,
  sentenceNoAttemptHint: '未做过此卷，点击去开考',
} as const;

/** 释义首行：`pos cn`（无词性则只显示中文） */
function firstMeaning(word: Word): string {
  const first = word.meanings[0];
  if (!first) {
    return '';
  }
  return first.pos ? `${first.pos} ${first.cn}` : first.cn;
}

/** 句子渲染：命中片段高亮（大小写不敏感定位），未命中整句原样 */
function SentenceText({ text, term }: { text: string; term: string }) {
  const needle = term.trim().toLowerCase();
  const index = needle.length > 0 ? text.toLowerCase().indexOf(needle) : -1;
  if (index < 0) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, index)}
      <span className="rounded-sm bg-primary-soft px-0.5 font-medium text-text">
        {text.slice(index, index + needle.length)}
      </span>
      {text.slice(index + needle.length)}
    </>
  );
}

/** AI 释义卡的状态机：idle = 未配置/无目标词，不渲染 */
type AiState = 'idle' | 'loading' | 'done' | 'error';

export default function SearchPage() {
  const navigate = useNavigate();

  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Word[]>([]);
  const [papers, setPapers] = useState<Exam[]>([]);
  const [sentences, setSentences] = useState<CorpusHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [failed, setFailed] = useState(false);
  const [bookNames, setBookNames] = useState<Record<string, string>>({});

  // 打开即聚焦：桌面「单词搜索」弹窗刚创建时窗口自身可能还没就绪，
  // autoFocus 之外再延迟补一次聚焦，保证点开图标就能直接打字，不用再点输入框
  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), IS_DESKTOP ? 120 : 0);
    return () => window.clearTimeout(timer);
  }, []);

  // AI 释义：目标词 = 防抖搜索完成后的最匹配词；同词缓存避免反复烧 token
  const [aiState, setAiState] = useState<AiState>('idle');
  const [aiContent, setAiContent] = useState('');
  const [aiError, setAiError] = useState('');
  const aiCacheRef = useRef(new Map<string, string>());

  // 词书名称（标签展示用，加载一次即可）
  useEffect(() => {
    let cancelled = false;
    void listBooks().then((books) => {
      if (cancelled) {
        return;
      }
      const names: Record<string, string> = {};
      for (const book of books) {
        names[book.id] = book.name;
      }
      setBookNames(names);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------- 防抖搜索（单词 + 试卷 + 真题整句三路并行） ----------
  useEffect(() => {
    if (!shouldSearch(query)) {
      setResults([]);
      setPapers([]);
      setSentences([]);
      setSearching(false);
      setSearched(false);
      setFailed(false);
      return;
    }
    const term = normalizeQuery(query);
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void Promise.all([
        searchBilingual(term, SEARCH_LIMIT),
        listExams().then((exams) =>
          exams.filter((exam) => exam.title.toLowerCase().includes(term)),
        ),
        searchCorpus(term, SEARCH_LIMIT),
      ])
        .then(([wordRows, paperRows, sentenceHits]) => {
          if (cancelled) {
            return;
          }
          setResults(wordRows);
          setPapers(paperRows);
          setSentences(sentenceHits);
          setSearching(false);
          setSearched(true);
          setFailed(false);
        })
        .catch(() => {
          if (cancelled) {
            return;
          }
          setResults([]);
          setPapers([]);
          setSentences([]);
          setSearching(false);
          setSearched(true);
          setFailed(true);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  /** AI 释义目标词：仅桌面弹窗启用（手机端不做 AI 释义）。
   * 搜索命中词库时取最匹配词；零结果时用归一化查询词兜底——
   * 词库未收录的词（如 dormant 不在 core 词库）由大模型直接释义，而不是哑火 */
  const targetWord: string | null = (() => {
    if (!IS_DESKTOP || !searched) {
      return null;
    }
    if (results.length > 0) {
      return results[0]?.headword ?? null;
    }
    return normalizeQuery(query) || null;
  })();

  useEffect(() => {
    if (targetWord === null) {
      setAiState('idle');
      setAiContent('');
      setAiError('');
      return;
    }
    const cached = aiCacheRef.current.get(targetWord);
    if (cached !== undefined) {
      setAiState('done');
      setAiContent(cached);
      return;
    }
    let cancelled = false;
    setAiState('loading');
    setAiError('');
    void (async () => {
      try {
        const settings = await getSettings();
        const apiKey = await getLlmKey();
        const config = settings ? resolveLlmConfig(settings, apiKey) : null;
        // 未配置大模型或没填 Key：安静退场，不渲染释义卡也不报错
        if (!config || config.apiKey === '') {
          if (!cancelled) {
            setAiState('idle');
          }
          return;
        }
        const content = await explainWord(config, targetWord);
        if (cancelled) {
          return;
        }
        aiCacheRef.current.set(targetWord, content);
        setAiState('done');
        setAiContent(content);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setAiState('error');
        setAiError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetWord]);

  const handleClear = useCallback((): void => {
    setQuery('');
  }, []);

  const handleOpen = useCallback(
    (word: Word): void => {
      navigate(ROUTES.wordDetail.replace(':id', word.id));
    },
    [navigate],
  );

  const handleOpenPaper = useCallback(
    (paper: Exam): void => {
      navigate(ROUTES.examStart.replace(':id', paper.id));
    },
    [navigate],
  );

  /** 点真题整句：有作答记录 → 最近一次解析页定位到句；没有 → 去开考页 */
  const handleOpenSentence = useCallback(
    async (hit: CorpusHit): Promise<void> => {
      const attempts = await listByPaper(hit.paperId);
      const latest = attempts.slice().sort((left, right) => right.startedAt - left.startedAt)[0];
      if (latest) {
        navigate(
          `${ROUTES.attemptReview.replace(':id', latest.id)}?q=${encodeURIComponent(hit.questionId)}`,
        );
      } else {
        navigate(ROUTES.examStart.replace(':id', hit.paperId));
      }
    },
    [navigate],
  );

  const showEmptyResult =
    searched && !searching && results.length === 0 && papers.length === 0 && sentences.length === 0;
  const term = useMemo(() => normalizeQuery(query), [query]);
  const hint = useMemo(() => {
    if (searching) {
      return TEXT.searching;
    }
    if (failed) {
      return TEXT.errorText;
    }
    if (searched) {
      return TEXT.resultCount(results.length);
    }
    return TEXT.hintInitial;
  }, [failed, results.length, searched, searching]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-text">{TEXT.title}</h1>

      {/* 搜索框 */}
      <div className="relative">
        <input
          ref={inputRef}
          type="search"
          value={query}
          autoFocus
          aria-label={TEXT.inputLabel}
          placeholder={TEXT.placeholder}
          onChange={(event) => setQuery(event.target.value)}
          className="h-12 w-full rounded-md border border-border bg-surface pl-10 pr-16 text-base text-text placeholder:text-text-3 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3">
          <Icon name="sparkle" size={18} />
        </span>
        {query.length > 0 ? (
          <button
            type="button"
            onClick={handleClear}
            aria-label={TEXT.clear}
            className="app-tappable absolute right-1 top-1/2 flex h-10 min-w-[44px] -translate-y-1/2 items-center justify-center rounded-md px-2 text-sm text-text-2"
          >
            {TEXT.clear}
          </button>
        ) : null}
      </div>

      <p className="text-xs text-text-3" role="status">
        {hint}
      </p>

      {/* 结果区：单词 / 试卷 / 真题整句 三段 */}
      {showEmptyResult ? (
        <Card>
          <EmptyState icon="words" title={TEXT.noResultTitle} description={TEXT.noResultDesc} />
        </Card>
      ) : null}

      {results.length > 0 ? (
        <Card title={TEXT.sectionWords} className="overflow-hidden" bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {results.map((word) => (
              <li key={word.id}>
                <ListRow
                  title={word.headword}
                  subtitle={firstMeaning(word)}
                  right={
                    <span className="flex items-center gap-2">
                      {/* 必应词典外链：拦截行点击冒泡，点这里不开词条详情 */}
                      <a
                        href={`https://cn.bing.com/dict/search?q=${encodeURIComponent(word.headword)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={TEXT.bingAria(word.headword)}
                        onClick={(event) => event.stopPropagation()}
                        className="app-tappable rounded-md border border-border px-2 py-1 text-xs font-medium text-text-2 hover:border-primary hover:text-primary"
                      >
                        {TEXT.bing}
                      </a>
                      <Tag color="var(--c-primary)">{bookNames[word.bookId] ?? TEXT.bookFallback}</Tag>
                    </span>
                  }
                  onClick={() => handleOpen(word)}
                />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {papers.length > 0 ? (
        <Card title={TEXT.sectionPapers} className="overflow-hidden" bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {papers.map((paper) => (
              <li key={paper.id}>
                <ListRow
                  title={paper.title}
                  subtitle={TEXT.paperMeta(paper.totalQuestions)}
                  onClick={() => handleOpenPaper(paper)}
                />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {sentences.length > 0 ? (
        <Card title={TEXT.sectionSentences} className="overflow-hidden" bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {sentences.map((hit) => (
              <li key={`${hit.questionId}:${hit.text}`}>
                <button
                  type="button"
                  onClick={() => void handleOpenSentence(hit)}
                  className="app-tappable flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-2 active:bg-surface-2"
                >
                  <span className="text-sm leading-relaxed text-text">
                    <SentenceText text={hit.text} term={term} />
                  </span>
                  <span className="flex items-center gap-2 text-xs text-text-3">
                    <span className="truncate">{hit.paperTitle}</span>
                    {hit.source === 'passage' ? null : (
                      <span className="shrink-0">{hit.source === 'stem' ? '题干' : '解析'}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* AI 释义（第二顺位：本地词库 / 试卷 / 整句命中优先展示，AI 兜底在其后；
          在「我的」配置大模型后自动出现，标题统一为「AI 释义」） */}
      {targetWord !== null && aiState !== 'idle' ? (
        <Card title={TEXT.aiTitle('AI')}>
          {aiState === 'loading' ? (
            <p className="text-sm text-text-2">{TEXT.aiLoading}</p>
          ) : aiState === 'done' ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">{aiContent}</p>
          ) : (
            <p className="text-sm text-danger-fg">{aiError}</p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
