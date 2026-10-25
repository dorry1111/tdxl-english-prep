/**
 * 单词卡片（T09，墨墨式一屏一词）。
 *
 * - 正面：单词大字 + 喇叭；点击卡片 / 空格键揭示答案；
 * - 答案态：音标 → 义项列表（一行一条 `pos. cn`，禁止合并成一段）
 *   → 例句 → 助记 → 词根，数据缺失的整块不渲染（不留标题、不留空行）；
 * - 答案态文本支持滑动选中加高亮（HighlightableText，笔记与高亮批次）：
 *   传入 highlights 时还原底色，划选文本弹出四色色板，点击高亮段可删除；
 * - 内容超出时卡片内部滚动，不撑破一屏。
 */
import clsx from 'clsx';
import { useMemo, type KeyboardEvent, type MouseEvent } from 'react';

import { HighlightableText } from '@/components/word/HighlightableText';
import { MemoConfusables, MemoExamSenses, MemoInflections } from '@/components/word/MemoBlocks';
import { Icon } from '@/components/ui/Icon';
import { Tag } from '@/components/ui/Tag';
import { ERROR_MESSAGES, STUDY } from '@/constants';
import type {
  CardItem,
  HighlightColor,
  HighlightScope,
  Word,
  WordHighlight,
  WordMemo,
} from '@/types';

export interface HighlightInput {
  scope: HighlightScope;
  exampleIndex: number | null;
  text: string;
  color: HighlightColor;
}

export interface WordCardProps {
  /** 当前卡词条；分片未命中时为 null，渲染兜底文案 */
  word: Word | null;
  revealed: boolean;
  /** 卡片来源：新词 / 复习 / 重现 */
  kind: CardItem['kind'];
  onReveal: () => void;
  onSpeak: () => void;
  /** speechSynthesis 不可用时喇叭置灰 */
  speakDisabled: boolean;
  /** 置灰时的提示文案（「当前设备不支持发音」） */
  speakDisabledReason?: string;
  /** 当前词条的已有高亮（缺省 = 不启高亮交互，仅还原不需要时为空数组） */
  highlights?: WordHighlight[];
  /** 划选选色回调（缺省 = 高亮只读） */
  onAddHighlight?: (input: HighlightInput) => void;
  /** 删除高亮回调（缺省 = 高亮不可删） */
  onDeleteHighlight?: (id: string) => void;
  /** 紧凑模式（单栏一屏无滚动）：压缩最小高度、内边距与正面区高度 */
  compact?: boolean;
  /**
   * 记忆内容（memo 分片）：易混 / 词形 / 考纲义项 + 助记词根兜底。
   * 仅在答案态渲染——memo 可能含词义，正面禁止展示（防泄题）。
   */
  memo?: WordMemo | null;
}

/** 卡片来源标签：文案与主题色 */
const KIND_META: Record<CardItem['kind'], { label: string; color: string }> = {
  new: { label: STUDY.kindNew, color: 'var(--c-primary)' },
  review: { label: STUDY.kindReview, color: 'var(--c-rate-3)' },
  retry: { label: STUDY.kindRetry, color: 'var(--c-warn)' },
};

export function WordCard({
  word,
  revealed,
  kind,
  onReveal,
  onSpeak,
  speakDisabled,
  speakDisabledReason,
  highlights = [],
  onAddHighlight,
  onDeleteHighlight,
  compact = false,
  memo = null,
}: WordCardProps) {
  const kindMeta = KIND_META[kind];

  const handleClick = (): void => {
    if (!revealed) {
      onReveal();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Enter' && !revealed) {
      event.preventDefault();
      onReveal();
    }
  };

  const handleSpeak = (event: MouseEvent<HTMLButtonElement>): void => {
    // 阻止冒泡：点喇叭不触发卡片揭示
    event.stopPropagation();
    if (!speakDisabled) {
      onSpeak();
    }
  };

  return (
    <section
      aria-label={revealed ? STUDY.cardAnswerLabel : STUDY.cardFrontLabel}
      className={clsx(
        'flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-e2',
        compact ? 'min-h-0' : 'min-h-[var(--card-min-h)]',
        !revealed && 'cursor-pointer app-tappable',
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={revealed ? undefined : 'button'}
      tabIndex={revealed ? undefined : 0}
    >
      {/* 顶栏：来源标签 + 喇叭 */}
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <Tag color={kindMeta.color}>{kindMeta.label}</Tag>
        <button
          type="button"
          aria-label={speakDisabled ? speakDisabledReason : STUDY.speakLabel}
          title={speakDisabled ? speakDisabledReason : undefined}
          disabled={speakDisabled}
          onClick={handleSpeak}
          className={clsx(
            'app-tappable flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-fast',
            speakDisabled ? 'bg-surface-2 text-text-3' : 'bg-primary-soft text-primary hover:opacity-80',
          )}
        >
          <Icon name="sparkle" size={18} />
        </button>
      </header>

      {/* 主体：正面 / 答案态；内容超出时内部滚动 */}
      <div className={clsx('app-no-scrollbar flex-1 overflow-y-auto', compact ? 'px-4 py-3' : 'px-5 py-6')}>
        {!word ? (
          <p className="py-12 text-center text-sm text-text-3">{ERROR_MESSAGES.WORD_NOT_FOUND}</p>
        ) : revealed ? (
          <AnswerView
            word={word}
            memo={memo}
            highlights={highlights}
            onAddHighlight={onAddHighlight}
            onDeleteHighlight={onDeleteHighlight}
          />
        ) : (
          <FrontView word={word} compact={compact} />
        )}
      </div>
    </section>
  );
}

/** 正面：单词大字 + 揭示提示 */
function FrontView({ word, compact = false }: { word: Word; compact?: boolean }) {
  return (
    <div
      className={clsx(
        'flex h-full flex-col items-center justify-center gap-4 text-center',
        compact ? 'min-h-[96px]' : 'min-h-[220px] gap-6',
      )}
    >
      <h2 className="text-3xl font-semibold leading-tight text-text">{word.headword}</h2>
      <p className="text-xs text-text-3">{STUDY.revealHint}</p>
    </div>
  );
}

/** 答案态：音标 → 义项（一行一条）→ 例句 → 助记 → 词根 → 考纲义项 → 易混 → 词形；文本支持滑动高亮 */
function AnswerView({
  word,
  memo,
  highlights,
  onAddHighlight,
  onDeleteHighlight,
}: {
  word: Word;
  memo?: WordMemo | null;
  highlights: WordHighlight[];
  onAddHighlight?: (input: HighlightInput) => void;
  onDeleteHighlight?: (id: string) => void;
}) {
  /** 按 scope（+ 例句下标）切分高亮，避免每段文本都全量比对 */
  const headwordHls = useMemo(
    () => highlights.filter((hl) => hl.scope === 'headword'),
    [highlights],
  );
  const meaningHls = useMemo(
    () => highlights.filter((hl) => hl.scope === 'meaning'),
    [highlights],
  );
  const exampleHlsByIndex = useMemo(() => {
    const map = new Map<number, WordHighlight[]>();
    for (const hl of highlights) {
      if (hl.scope !== 'example' || hl.exampleIndex === null) {
        continue;
      }
      const list = map.get(hl.exampleIndex);
      if (list) {
        list.push(hl);
      } else {
        map.set(hl.exampleIndex, [hl]);
      }
    }
    return map;
  }, [highlights]);

  const addHeadword =
    onAddHighlight &&
    ((text: string, color: HighlightColor): void => {
      onAddHighlight({ scope: 'headword', exampleIndex: null, text, color });
    });

  return (
    <div className="flex flex-col gap-4">
      <HighlightableText
        as="h2"
        text={word.headword}
        highlights={headwordHls}
        onAddHighlight={addHeadword}
        onDeleteHighlight={onDeleteHighlight}
        className="text-2xl font-semibold text-text"
      />

      {/* 音标：缺失的口音不渲染对应片段 */}
      {(word.phoneticUk || word.phoneticUs) && (
        <p className="flex flex-wrap gap-3 text-sm text-text-2">
          {word.phoneticUk ? (
            <span>
              {STUDY.accentUk} /{word.phoneticUk}/
            </span>
          ) : null}
          {word.phoneticUs ? (
            <span>
              {STUDY.accentUs} /{word.phoneticUs}/
            </span>
          ) : null}
        </p>
      )}

      {/* 义项：一行一条 `pos. cn`；中文释义可高亮 */}
      <ul className="flex flex-col gap-1.5">
        {word.meanings.map((meaning, index) => (
          <li key={index} className="text-base text-text">
            {meaning.pos ? <span className="mr-1 font-medium">{meaning.pos}</span> : null}
            <HighlightableText
              as="span"
              text={meaning.cn}
              highlights={meaningHls}
              onAddHighlight={
                onAddHighlight &&
                ((text: string, color: HighlightColor): void => {
                  onAddHighlight({ scope: 'meaning', exampleIndex: null, text, color });
                })
              }
              onDeleteHighlight={onDeleteHighlight}
            />
          </li>
        ))}
      </ul>

      {/* 例句 / 助记 / 词根：整体缺失时整块不渲染，不留空占位 */}
      {word.examples && word.examples.length > 0 ? (
        <section aria-label={STUDY.examplesTitle} className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-text-3">{STUDY.examplesTitle}</h3>
          {word.examples.map((example, index) => (
            <div key={index} className="border-l-2 border-border pl-3">
              <HighlightableText
                as="p"
                text={example.en}
                highlights={exampleHlsByIndex.get(index) ?? []}
                onAddHighlight={
                  onAddHighlight &&
                  ((text: string, color: HighlightColor): void => {
                    onAddHighlight({ scope: 'example', exampleIndex: index, text, color });
                  })
                }
                onDeleteHighlight={onDeleteHighlight}
                className="text-sm text-text"
              />
              {example.zh ? <p className="text-sm text-text-2">{example.zh}</p> : null}
            </div>
          ))}
        </section>
      ) : null}

      {word.mnemonic || memo?.mnemonic ? (
        <section aria-label={STUDY.mnemonicTitle} className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-text-3">{STUDY.mnemonicTitle}</h3>
          <p className="text-sm text-text-2">{word.mnemonic ?? memo?.mnemonic}</p>
        </section>
      ) : null}

      {(word.roots?.length || memo?.roots?.length) ? (
        <section aria-label={STUDY.rootsTitle} className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-text-3">{STUDY.rootsTitle}</h3>
          <ul className="flex flex-col gap-1">
            {(word.roots?.length ? word.roots : memo?.roots ?? []).map((root, index) => (
              <li key={index} className="text-sm text-text-2">
                <span className="mr-2 font-medium text-text">{root.text}</span>
                <span>{root.meaning}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 考纲义项 / 易混词 / 词形变化（memo 分片增量内容，缺失整块不渲染） */}
      <MemoExamSenses senses={memo?.examSenses} />
      <MemoConfusables items={memo?.confusables} />
      <MemoInflections memo={memo} />
    </div>
  );
}
