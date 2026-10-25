/**
 * 词条详情面板（T09 双栏模式右栏，≥1024px 常驻）。
 *
 * - React.memo 依赖 wordId + revealed：切卡即时刷新，揭示瞬间放开详情；
 * - **揭示门控**：未揭示时只显示词头与音标（与卡片正面同信息，帮助发音但不泄题），
 *   义项 / 例句 / 助记 / 词根 / 笔记 / 必应词典全部隐藏——否则右栏直接泄露答案；
 * - 揭示后展示完整词条（音标 / 义项 / 例句 / 助记 / 词根）；
 * - 底部为笔记与收藏区（串记/联想/谐音 + 用户例句 + 收藏）。
 */
import { memo } from 'react';

import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { STUDY } from '@/constants';
import type { Word, WordMemo } from '@/types';

import { MemoConfusables, MemoExamSenses, MemoInflections } from './MemoBlocks';
import { WordNotesSection } from './WordNotesSection';
import { BingDictLink } from './BingDictLink';

export interface WordDetailPanelProps {
  /** 当前词条；null 时显示占位 */
  word: Word | null;
  /** 是否已揭示答案：未揭示时隐藏全部词义信息（只留词头 + 音标）。
   *  缺省 true —— 词条详情页（/word/:id）等非学习场景不门控 */
  revealed?: boolean;
  /** 记忆内容（memo 分片）：助记/词根兜底 + 考纲义项/易混/词形；未揭示时不渲染 */
  memo?: WordMemo | null;
}

function WordDetailPanelImpl({ word, revealed = true, memo = null }: WordDetailPanelProps) {
  return (
    <Card title={STUDY.detailPanelTitle} className="h-full" bodyClassName="h-full">
      {!word ? (
        <EmptyState compact icon="words" title={STUDY.cardFrontLabel} />
      ) : !revealed ? (
        <div className="flex h-full flex-col gap-4">
          <div>
            <h3 className="text-xl font-semibold text-text">{word.headword}</h3>
            {(word.phoneticUk || word.phoneticUs) && (
              <p className="mt-1 flex flex-wrap gap-3 text-sm text-text-2">
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
          </div>
          <div className="flex flex-1 items-center justify-center">
            <EmptyState compact icon="sparkle" title={STUDY.detailHiddenHint} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-xl font-semibold text-text">{word.headword}</h3>
            {(word.phoneticUk || word.phoneticUs) && (
              <p className="mt-1 flex flex-wrap gap-3 text-sm text-text-2">
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
          </div>

          <ul className="flex flex-col gap-1.5">
            {word.meanings.map((meaning, index) => (
              <li key={index} className="text-sm text-text">
                {meaning.pos ? <span className="mr-1 font-medium">{meaning.pos}</span> : null}
                <span>{meaning.cn}</span>
              </li>
            ))}
          </ul>

          {word.examples && word.examples.length > 0 ? (
            <section aria-label={STUDY.examplesTitle} className="flex flex-col gap-2">
              <h4 className="text-xs font-medium text-text-3">{STUDY.examplesTitle}</h4>
              {word.examples.map((example, index) => (
                <div key={index} className="border-l-2 border-border pl-3">
                  <p className="text-sm text-text">{example.en}</p>
                  {example.zh ? <p className="text-sm text-text-2">{example.zh}</p> : null}
                </div>
              ))}
            </section>
          ) : null}

          {word.mnemonic || memo?.mnemonic ? (
            <section aria-label={STUDY.mnemonicTitle} className="flex flex-col gap-2">
              <h4 className="text-xs font-medium text-text-3">{STUDY.mnemonicTitle}</h4>
              <p className="text-sm text-text-2">{word.mnemonic ?? memo?.mnemonic}</p>
            </section>
          ) : null}

          {(word.roots?.length || memo?.roots?.length) ? (
            <section aria-label={STUDY.rootsTitle} className="flex flex-col gap-2">
              <h4 className="text-xs font-medium text-text-3">{STUDY.rootsTitle}</h4>
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

          {/* 考纲义项 / 易混词 / 词形（memo 分片增量内容） */}
          <MemoExamSenses senses={memo?.examSenses} level={4} />
          <MemoConfusables items={memo?.confusables} level={4} />
          <MemoInflections memo={memo} level={4} />

          {/* 笔记与收藏：三类笔记 + 用户例句 + 收藏按钮；key 换词时重置内部状态 */}
          <WordNotesSection key={word.id} word={word} />

          {/* 必应词典外链：新标签打开该单词的必应词典页（iPhone PWA 内会在内建 Safari 视图打开） */}
          <BingDictLink headword={word.headword} />
        </div>
      )}
    </Card>
  );
}

/** wordId 或揭示状态变化时才重渲染（T09 验收第 7 条 + 揭示门控） */
export const WordDetailPanel = memo(
  WordDetailPanelImpl,
  (prev, next) => prev.word?.id === next.word?.id && prev.revealed === next.revealed,
);
