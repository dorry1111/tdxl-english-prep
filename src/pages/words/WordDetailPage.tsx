/**
 * P05 词条详情页（路由 /word/:id）。
 *
 * - 词条：复用 T09 的 WordDetailPanel（音标 / 义项 / 例句 / 助记 / 词根），
 *   面板底部自带笔记与收藏区（串记/联想/谐音 + 用户例句 + 收藏星标）；
 * - 学习历史：stateRepo.listByWordId + logRepo.listByWord，
 *   展示 SRS 当前等级、下次到期、累计作答与最近流水；
 * - 发音：useSpeak（不支持时置灰并提示）；
 * - 未找到：给兜底卡片，不白屏。
 *
 * 文案：本批次 messages.ts 由另一工程师独占，页面文案用本文件的 TEXT 常量承接，
 * 键名风格与 messages.ts 保持一致，后续一次性搬迁即可。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { WordDetailPanel } from '@/components/word/WordDetailPanel';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Tag } from '@/components/ui/Tag';
import { ERROR_MESSAGES, STUDY } from '@/constants';
import { listByWord } from '@/db/repos/logRepo';
import { listByWordId } from '@/db/repos/stateRepo';
import { getWord } from '@/db/repos/wordRepo';
import { useSpeak } from '@/hooks/useSpeak';
import { stateKeyOfNorm } from '@/lib/hash';
import { fmtDate } from '@/lib/time';
import type { Rating, ReviewLog, Word, WordState } from '@/types';

import { accuracyOf, levelText, ratingTextOf, summarizeStates } from './wordHistory';

const TEXT = {
  back: '返回',
  historyTitle: '学习记录',
  levelLabel: '当前等级',
  dueLabel: '下次复习',
  dueNone: '尚未进入复习计划',
  reviewLabel: '累计作答',
  accuracyLabel: '正确率',
  lastRatingLabel: '上次评分',
  lastReviewLabel: '上次复习',
  unitTime: '次',
  noRating: '—',
  noHistory: '这个词还没有学习记录，背一次就会出现在这里。',
  logsTitle: '最近作答',
  logEmpty: '还没有作答记录。',
  notFound: '没有找到这个单词。',
  notFoundDesc: '它可能已被删除，或链接不正确。',
  multiState: '检测到多份学习状态，统计已合并显示。',
  loading: '正在加载词条…',
} as const;

const RATING_LABELS: Readonly<Record<Rating, string>> = {
  1: STUDY.rating1,
  2: STUDY.rating2,
  3: STUDY.rating3,
  4: STUDY.rating4,
};

const LOG_LIMIT = 10;

export default function WordDetailPage() {
  const params = useParams<{ id: string }>();
  const wordId = params.id ?? '';
  const navigate = useNavigate();
  const { speak, supported: ttsSupported } = useSpeak();

  const [word, setWord] = useState<Word | null>(null);
  const [states, setStates] = useState<WordState[]>([]);
  const [logs, setLogs] = useState<ReviewLog[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [found, stateRows, logRows] = await Promise.all([
        getWord(wordId),
        listByWordId(wordId),
        listByWord(wordId, LOG_LIMIT),
      ]);
      if (cancelled) {
        return;
      }
      setWord(found ?? null);
      setStates(stateRows.filter((state) => state.deletedAt === null));
      setLogs(logRows);
      setLoaded(true);
    })().catch(() => {
      if (!cancelled) {
        setWord(null);
        setStates([]);
        setLogs([]);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [wordId]);

  const handleBack = useCallback((): void => {
    navigate(-1);
  }, [navigate]);

  const handleSpeak = useCallback((): void => {
    if (word) {
      speak(word.headword);
    }
  }, [speak, word]);

  if (!loaded) {
    return (
      <Card>
        <p className="text-sm text-text-3">{TEXT.loading}</p>
      </Card>
    );
  }

  if (!word) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" aria-label={TEXT.back} icon={<Icon name="chevron-right" size={18} className="rotate-180" />} onClick={handleBack}>
            {TEXT.back}
          </Button>
        </div>
        <Card>
          <EmptyState icon="alert" title={TEXT.notFound} description={TEXT.notFoundDesc} />
        </Card>
      </div>
    );
  }

  const stateKey = stateKeyOfNorm(word.norm);
  const summary = summarizeStates(states, stateKey);
  const accuracy = summary ? accuracyOf(summary) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* 顶部：返回 + 发音 */}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label={TEXT.back}
          icon={<Icon name="chevron-right" size={18} className="rotate-180" />}
          onClick={handleBack}
        >
          {TEXT.back}
        </Button>
        <button
          type="button"
          aria-label={ttsSupported ? STUDY.speakLabel : ERROR_MESSAGES.TTS_UNAVAILABLE}
          title={ttsSupported ? undefined : ERROR_MESSAGES.TTS_UNAVAILABLE}
          disabled={!ttsSupported}
          onClick={handleSpeak}
          className={
            ttsSupported
              ? 'app-tappable flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft text-primary'
              : 'app-tappable flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-text-3'
          }
        >
          <Icon name="sparkle" size={20} />
        </button>
      </div>

      {/* 词条主体（含笔记与收藏区） */}
      <WordDetailPanel word={word} />

      {/* 学习历史 */}
      <Card title={TEXT.historyTitle}>
        {!summary ? (
          <p className="text-sm text-text-3">{TEXT.noHistory}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-text-3">{TEXT.levelLabel}</dt>
                <dd className="text-base font-medium text-text">{levelText(summary.level)}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-text-3">{TEXT.dueLabel}</dt>
                <dd className="text-base text-text">
                  {summary.dueAt > 0 ? fmtDate(summary.dueAt) : TEXT.dueNone}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-text-3">{TEXT.reviewLabel}</dt>
                <dd className="text-base text-text">
                  {summary.reviewCount} {TEXT.unitTime}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-text-3">{TEXT.accuracyLabel}</dt>
                <dd className="text-base text-text">
                  {accuracy === null ? TEXT.noRating : `${Math.round(accuracy * 100)}%`}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-text-3">{TEXT.lastRatingLabel}</dt>
                <dd className="text-base text-text">
                  {ratingTextOf(summary.lastRating, RATING_LABELS) || TEXT.noRating}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-text-3">{TEXT.lastReviewLabel}</dt>
                <dd className="text-base text-text">
                  {summary.lastReviewAt === null ? TEXT.noRating : fmtDate(summary.lastReviewAt)}
                </dd>
              </div>
            </dl>
            {summary.stateCount > 1 ? (
              <p className="text-xs text-text-3">{TEXT.multiState}</p>
            ) : null}
          </div>
        )}
      </Card>

      {/* 最近作答流水 */}
      <Card title={TEXT.logsTitle}>
        {logs.length === 0 ? (
          <p className="text-sm text-text-3">{TEXT.logEmpty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {logs.map((log) => (
              <li key={log.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 flex-1 text-sm text-text-2">{fmtDate(log.answeredAt)}</span>
                <Tag color="var(--c-rate-3)">
                  {ratingTextOf(log.rating, RATING_LABELS) || TEXT.noRating}
                </Tag>
                <span className="shrink-0 text-xs text-text-3">
                  {levelText(log.prevLevel)} → {levelText(log.newLevel)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
