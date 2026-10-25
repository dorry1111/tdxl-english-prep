/**
 * P05 选词页（词库管理，接线版）。
 *
 * 导航口径：本页对应一级导航「选词」（2026-11 由「单词」改名，
 * 与新增的「统计」一级导航并列），页面内文案仍以「词库 / 生词本」表述。
 *
 * 卡片列表三类：
 * - 内置「考纲核心词」（总词数取自 core-index；索引未加载时显示「—」，不编造数字）；
 * - 生词本虚拟词库（总词数 = 生词本条目数）；
 * - 用户导入的自定义词库（db.books 里 source='imported' 的记录）。
 *
 * 选型：点「设为当前」写 Settings.currentBookId + activeBookIds（store/bookSelection），
 * 与 HomePage「开始背单词」/ 学习页取词同源（都读 activeBookIds）。
 * 「开始学习」复用 HomePage 的 start() → 跳转 /study 路径。
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { ListRow } from '@/components/ui/ListRow';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Tag } from '@/components/ui/Tag';
import { BUILTIN_BOOK_ID, BOOKS, HOME, NOTEBOOK_BOOK_ID, ROUTES } from '@/constants';
import { listBooks } from '@/db/repos/bookRepo';
import { countDueByBook, countLearnedByBook } from '@/db/repos/forecastRepo';
import { countActive as countNotebook } from '@/db/repos/notebookRepo';
import { getSettings } from '@/db/repos/settingsRepo';
import { countWordsByBook } from '@/db/repos/wordRepo';
import { loadCoreIndex, peekCoreIndex } from '@/lib/wordbookCache';
import {
  isBookActive,
  selectCurrentBook,
  setBookMode,
  toggleStackBook,
} from '@/store/bookSelection';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import type { WordBook } from '@/types';
import { formatCount, orderBooks, progressPercent } from './booksLogic';

/** 词库来源 → 标签文案与颜色（颜色走 tokens 变量） */
const SOURCE_META: Record<WordBook['source'], { label: string; color: string }> = {
  builtin: { label: BOOKS.sourceBuiltin, color: 'var(--c-primary)' },
  'virtual-notebook': { label: BOOKS.sourceNotebook, color: 'var(--c-rate-4)' },
  imported: { label: BOOKS.sourceImported, color: 'var(--c-rate-3)' },
};

export default function BooksPage() {
  const navigate = useNavigate();
  const showInfo = useUiStore((state) => state.toast.info);

  const status = useSessionStore((state) => state.status);
  const start = useSessionStore((state) => state.start);
  const addNewWords = useSessionStore((state) => state.addNewWords);

  const [adding, setAdding] = useState(false);
  const [starting, setStarting] = useState(false);

  const settings = useLiveQuery(() => getSettings(), [], undefined);
  const books = useLiveQuery(() => listBooks(), [], [] as WordBook[]);

  // 每张卡片的三个数字：总词数 / 已学 / 待复习（全部走索引 count，不全量拉取）
  const stats = useLiveQuery(
    async () => {
      const entries: Record<string, { total: number | null; learned: number; due: number }> = {};
      // 内置词库总词数：优先读已加载的内存索引，其次尝试加载，失败则为 null
      let coreTotal: number | null = peekCoreIndex()?.total ?? null;
      if (coreTotal === null) {
        try {
          coreTotal = (await loadCoreIndex()).total;
        } catch {
          coreTotal = null;
        }
      }
      const nowTs = Date.now();
      for (const book of books) {
        let total: number | null;
        if (book.id === BUILTIN_BOOK_ID) {
          total = coreTotal ?? (book.wordCount > 0 ? book.wordCount : null);
        } else if (book.id === NOTEBOOK_BOOK_ID) {
          total = await countNotebook();
        } else {
          total = await countWordsByBook(book.id);
        }
        entries[book.id] = {
          total,
          learned: await countLearnedByBook(book.id),
          due: await countDueByBook(book.id, nowTs),
        };
      }
      return entries;
    },
    [books],
    null,
  );

  const ordered = useMemo(() => orderBooks(books), [books]);
  const stackMode = settings?.bookMode === 'stack';

  const handleStart = async (): Promise<void> => {
    setStarting(true);
    try {
      const result = await start();
      if (result === 'empty') {
        showInfo(HOME.todayDone);
      } else {
        navigate(ROUTES.study);
      }
    } finally {
      setStarting(false);
    }
  };

  const handleAddFive = async (): Promise<void> => {
    setAdding(true);
    try {
      const added = await addNewWords(5);
      showInfo(added > 0 ? BOOKS.addedNewWords(added) : BOOKS.noMoreNewWords);
    } finally {
      setAdding(false);
    }
  };

  const handleSelect = async (bookId: string): Promise<void> => {
    if (stackMode) {
      await toggleStackBook(bookId, !isBookActive(settings, bookId));
      return;
    }
    await selectCurrentBook(bookId);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 模式切换：单书 / 叠加 */}
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold text-text">{BOOKS.modeTitle}</p>
            <p className="mt-1 text-sm text-text-3">
              {stackMode ? BOOKS.modeStackDesc : BOOKS.modeSingleDesc}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void setBookMode(stackMode ? 'single' : 'stack')}
          >
            {stackMode ? BOOKS.modeSwitchToSingle : BOOKS.modeSwitchToStack}
          </Button>
        </div>
      </Card>

      {/* 词库卡片列表 */}
      {ordered.length === 0 ? (
        <Card>
          <EmptyState icon="words" title={BOOKS.emptyTitle} description={BOOKS.emptyDesc} />
        </Card>
      ) : (
        ordered.map((book) => {
          const stat = stats?.[book.id] ?? { total: null, learned: 0, due: 0 };
          const active = isBookActive(settings, book.id);
          const meta = SOURCE_META[book.source];
          return (
            <Card
              key={book.id}
              title={book.name}
              action={<Tag color={meta.color}>{meta.label}</Tag>}
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline gap-4 text-sm text-text-2">
                  <span>
                    {BOOKS.totalLabel}{' '}
                    <strong className="text-base text-text">{formatCount(stat.total)}</strong>
                  </span>
                  <span>
                    {BOOKS.learnedLabel} <strong className="text-base text-text">{stat.learned}</strong>
                  </span>
                  <span>
                    {BOOKS.dueLabel} <strong className="text-base text-text">{stat.due}</strong>
                  </span>
                </div>

                <ProgressBar
                  value={stat.learned}
                  max={stat.total ?? 0}
                  label={BOOKS.progressLabel(progressPercent(stat.learned, stat.total ?? 0))}
                />

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={active ? 'primary' : 'secondary'}
                    onClick={() => void handleSelect(book.id)}
                  >
                    {active ? BOOKS.currentBook : BOOKS.setCurrent}
                  </Button>
                  {active ? <Tag color="var(--c-success)">{BOOKS.activeTag}</Tag> : null}
                </div>
              </div>
            </Card>
          );
        })
      )}

      {/* 操作区：开始学习 / +5 新词 */}
      <Card>
        <div className="flex flex-col gap-2">
          <Button block size="lg" disabled={starting} onClick={() => void handleStart()}>
            {BOOKS.startLearning}
          </Button>
          <Button
            block
            size="lg"
            variant="secondary"
            disabled={adding || status !== 'active'}
            onClick={() => void handleAddFive()}
          >
            {BOOKS.addFive}
          </Button>
          {status !== 'active' ? <p className="text-xs text-text-3">{BOOKS.addFiveHint}</p> : null}
        </div>
      </Card>

      {/* 导入入口（目标页本身仍在后续批次，这里只做入口，保持 ComingSoon 不动） */}
      <Card>
        <ListRow
          title={BOOKS.importEntry}
          subtitle={BOOKS.importEntryDesc}
          onClick={() => navigate(ROUTES.booksImport)}
        />
      </Card>

      <p className="flex items-start gap-2 px-1 text-xs text-text-3">
        <span className="mt-0.5 shrink-0">
          <Icon name="alert" size={14} />
        </span>
        <span>{BOOKS.footerHint}</span>
      </p>
    </div>
  );
}
