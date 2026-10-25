/**
 * P06 生词本页（路由 /notebook）。
 *
 * - 数据源：收藏标记在 WordState.isStarred（跨词库共享），
 *   经 stateRepo.listAll 取出后按 wordId 反查词条（wordRepo.getWord）；
 * - 列表：词头 + 释义摘要 + 当前等级，点击进入词条详情；
 * - 词书筛选：按 Word.bookId 分桶（chips），移动端优先；
 * - 分页：先按「加载更多」累计分页（PAGE_SIZE=20），量大时也够用；
 * - 学习生词：装填本次收藏词后调 sessionStore.start()，再跳 /study
 *   （sessionStore 暂不支持按词集启动，见 notebookStudy.ts 头注释）。
 *
 * 文案：messages.ts 本批次由另一工程师独占，页面文案用本文件 TEXT 承接。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListRow } from '@/components/ui/ListRow';
import { ROUTES } from '@/constants';
import { listBooks } from '@/db/repos/bookRepo';
import { listAll } from '@/db/repos/stateRepo';
import { getWord } from '@/db/repos/wordRepo';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import type { Word } from '@/types';

import {
  ALL_BOOKS,
  bookOptionsOf,
  filterByBook,
  meaningSummary,
  paginate,
  sortItems,
  type NotebookItem,
} from './notebookLogic';
import { armNotebookSession, restoreDefaultNewWords } from './notebookStudy';

const TEXT = {
  title: '生词本',
  loading: '正在加载生词本…',
  emptyTitle: '生词本还是空的',
  emptyDesc: '在背单词或词条详情页点「收藏」，收藏的词会集中到这里方便重背。',
  goBooks: '去词书页',
  countOf: (count: number): string => `共 ${count} 个收藏词`,
  filterAll: '全部',
  study: '学习生词',
  studyToast: '已开始学习生词，本次会话只考生词。',
  studyEmpty: '当前筛选下没有可学的词。',
  studyFailed: '暂时无法开始学习，请稍后重试。',
  loadMore: '加载更多',
  levelOf: (level: number): string => `L${level}`,
  bookFallback: '未知词书',
} as const;

const PAGE_SIZE = 20;

export default function NotebookPage() {
  const navigate = useNavigate();
  const showInfo = useUiStore((state) => state.toast.info);
  const start = useSessionStore((state) => state.start);

  const [items, setItems] = useState<NotebookItem[]>([]);
  const [bookNames, setBookNames] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [bookFilter, setBookFilter] = useState<string>(ALL_BOOKS);
  const [page, setPage] = useState(1);

  // ---------- 加载：收藏状态 → 词条；书名映射 ----------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [states, books] = await Promise.all([listAll(), listBooks()]);
      const starred = states.filter((state) => state.isStarred && state.deletedAt === null);
      const words = await Promise.all(starred.map((state) => getWord(state.wordId)));
      const collected: NotebookItem[] = [];
      starred.forEach((state, index) => {
        const word = words[index];
        if (word) {
          collected.push({ state, word });
        }
      });
      const names: Record<string, string> = {};
      for (const book of books) {
        names[book.id] = book.name;
      }
      if (cancelled) {
        return;
      }
      setItems(sortItems(collected));
      setBookNames(names);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 卸载时恢复默认新词口径，避免 provider 泄漏到普通会话
  useEffect(() => restoreDefaultNewWords, []);

  const filtered = useMemo(() => filterByBook(items, bookFilter), [items, bookFilter]);
  const visible = useMemo(() => paginate(filtered, page, PAGE_SIZE), [filtered, page]);
  const options = useMemo(() => bookOptionsOf(items), [items]);

  const handleOpen = useCallback(
    (word: Word): void => {
      navigate(ROUTES.wordDetail.replace(':id', word.id));
    },
    [navigate],
  );

  const handleFilterChange = useCallback((bookId: string): void => {
    setBookFilter(bookId);
    setPage(1);
  }, []);

  const handleStudy = useCallback(async (): Promise<void> => {
    const words = filtered.map((item) => item.word);
    if (words.length === 0) {
      showInfo(TEXT.studyEmpty);
      return;
    }
    armNotebookSession(words);
    try {
      const result = await start();
      if (result === 'empty') {
        showInfo(TEXT.studyEmpty);
        navigate(ROUTES.home);
        return;
      }
      showInfo(TEXT.studyToast);
      navigate(ROUTES.study);
    } catch {
      restoreDefaultNewWords();
      showInfo(TEXT.studyFailed);
    }
  }, [filtered, navigate, showInfo, start]);

  if (!loaded) {
    return (
      <Card title={TEXT.title}>
        <p className="text-sm text-text-3">{TEXT.loading}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-text">{TEXT.title}</h1>
        <span className="text-sm text-text-3">{TEXT.countOf(items.length)}</span>
      </div>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon="words"
            title={TEXT.emptyTitle}
            description={TEXT.emptyDesc}
            action={
              <Button variant="secondary" onClick={() => navigate(ROUTES.books)}>
                {TEXT.goBooks}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {/* 词书筛选 */}
          <div className="flex flex-wrap gap-2" role="group" aria-label={TEXT.title}>
            <FilterChip
              label={TEXT.filterAll}
              active={bookFilter === ALL_BOOKS}
              onClick={() => handleFilterChange(ALL_BOOKS)}
            />
            {options.map((bookId) => (
              <FilterChip
                key={bookId}
                label={bookNames[bookId] ?? TEXT.bookFallback}
                active={bookFilter === bookId}
                onClick={() => handleFilterChange(bookId)}
              />
            ))}
          </div>

          <Card className="overflow-hidden" bodyClassName="p-0">
            {visible.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-text-3">{TEXT.studyEmpty}</p>
            ) : (
              <ul className="divide-y divide-border">
                {visible.map((item) => (
                  <li key={item.state.stateKey}>
                    <ListRow
                      title={item.word.headword}
                      subtitle={meaningSummary(item.word)}
                      meta={TEXT.levelOf(item.state.level)}
                      onClick={() => handleOpen(item.word)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {visible.length < filtered.length ? (
            <Button variant="secondary" block onClick={() => setPage((prev) => prev + 1)}>
              {TEXT.loadMore}
            </Button>
          ) : null}

          <Button block size="lg" onClick={() => void handleStudy()}>
            {TEXT.study}
          </Button>
        </>
      )}
    </div>
  );
}

/** 筛选 chip：44px 命中高度，选中态用主色描边 */
function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? 'app-tappable min-h-[44px] rounded-full border border-primary bg-primary-soft px-4 text-sm font-medium text-text'
          : 'app-tappable min-h-[44px] rounded-full border border-border bg-surface px-4 text-sm font-medium text-text-2'
      }
    >
      {label}
    </button>
  );
}
