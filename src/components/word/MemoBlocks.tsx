/**
 * memo 分片增量内容块（考纲义项 / 易混词 / 词形变化）。
 *
 * - 供单词卡（WordCard）与词条详情面板（WordDetailPanel）共用，样式一致、避免两处漂移；
 * - 每块数据缺失 / 为空数组时整块不渲染（不留标题、不留空行）；
 * - 只在答案态调用——memo 可能含词义信息，正面禁止展示（防泄题）。
 */
import { STUDY } from '@/constants';
import type { Confusable, ExamSense, Inflections, WordMemo } from '@/types';

import { Tag } from '@/components/ui/Tag';

/** 标题层级：单词卡用 h3，详情面板用 h4（保持各页面标题层级语义） */
function BlockTitle({ level, text, tag }: { level: 3 | 4; text: string; tag?: string }) {
  const className = 'flex items-center gap-2 text-xs font-medium text-text-3';
  if (level === 4) {
    return (
      <h4 className={className}>
        {text}
        {tag ? <Tag color="var(--c-warn)">{tag}</Tag> : null}
      </h4>
    );
  }
  return (
    <h3 className={className}>
      {text}
      {tag ? <Tag color="var(--c-warn)">{tag}</Tag> : null}
    </h3>
  );
}

/** 考纲义项（熟词僻义）：真题向补充义项，一行一条 `pos. cn（note）` */
export function MemoExamSenses({
  senses,
  level = 3,
}: {
  senses: ExamSense[] | undefined;
  level?: 3 | 4;
}) {
  if (!senses || senses.length === 0) {
    return null;
  }
  return (
    <section aria-label={STUDY.examSensesTitle} className="flex flex-col gap-2">
      <BlockTitle level={level} text={STUDY.examSensesTitle} />
      <ul className="flex flex-col gap-1.5">
        {senses.map((sense, index) => (
          <li key={index} className="text-sm text-text-2">
            {sense.pos ? <span className="mr-1 font-medium text-text">{sense.pos}</span> : null}
            {sense.cn}
            {sense.note ? <span className="ml-1 text-xs text-text-3">（{sense.note}）</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 易混词：真实高频易混对 + 一句话辨析 */
export function MemoConfusables({
  items,
  level = 3,
}: {
  items: Confusable[] | undefined;
  level?: 3 | 4;
}) {
  if (!items || items.length === 0) {
    return null;
  }
  return (
    <section aria-label={STUDY.confusablesTitle} className="flex flex-col gap-2">
      <BlockTitle level={level} text={STUDY.confusablesTitle} />
      <ul className="flex flex-col gap-1.5">
        {items.map((item, index) => (
          <li key={index} className="text-sm text-text-2">
            <span className="mr-2 font-medium text-text">{item.word}</span>
            <span>{item.diff}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 词形变化：按「复数 / 三单 / 过去式 / 过去分词 / 现在分词」顺序展示存在的形式；irregular 时标注 */
export function MemoInflections({
  memo,
  level = 3,
}: {
  memo?: WordMemo | null;
  level?: 3 | 4;
}) {
  const infl: Inflections | undefined = memo?.inflections;
  if (!infl) {
    return null;
  }
  const rows: Array<[string, string | undefined]> = [
    [STUDY.inflPlural, infl.plural],
    [STUDY.inflThird, infl.third],
    [STUDY.inflPast, infl.past],
    [STUDY.inflPastParticiple, infl.pastParticiple],
    [STUDY.inflPresentParticiple, infl.presentParticiple],
  ];
  const present = rows.filter((row): row is [string, string] => Boolean(row[1]));
  if (present.length === 0) {
    return null;
  }
  return (
    <section aria-label={STUDY.inflectionsTitle} className="flex flex-col gap-2">
      <BlockTitle
        level={level}
        text={STUDY.inflectionsTitle}
        tag={infl.irregular ? STUDY.inflIrregular : undefined}
      />
      <ul className="flex flex-col gap-1">
        {present.map(([label, value]) => (
          <li key={label} className="text-sm text-text-2">
            <span className="mr-2 font-medium text-text">{label}</span>
            <span>{value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
