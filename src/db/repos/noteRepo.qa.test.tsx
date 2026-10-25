/**
 * QA 二层验证补强（笔记与高亮批次）：
 * - buildSegments 渲染还原的边界：相邻不同色 / 同文本多次出现 / 首尾边界；
 * - WordCard exampleIndex 错位时不误染（example 0 的高亮不染 example 1，
 *   headword 的高亮不染同文本的释义）；
 * - stateRepo.setStarred 标脏必须落在 stateKey 对应的精确分片上。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { buildSegments } from '@/components/word/HighlightableText';
import { WordCard } from '@/components/word/WordCard';
import { db } from '@/db';
import { addHighlight, listHighlightsByStateKey } from '@/db/repos/noteRepo';
import { setStarred, wordStateEntityOf } from '@/db/repos/stateRepo';
import { stateKeyOfNorm } from '@/lib/hash';
import { now } from '@/lib/time';
import type { Word, WordHighlight } from '@/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeHighlight(overrides: Partial<WordHighlight>): WordHighlight {
  const stamp = now();
  return {
    id: 'whl_qa',
    stateKey: '1',
    wordId: 'core:test',
    scope: 'headword',
    exampleIndex: null,
    text: 'test',
    color: 1,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
    ...overrides,
  };
}

describe('buildSegments 边界补强', () => {
  it('相邻（不重叠）的两条不同色高亮 → 两段分开，各自颜色', () => {
    const first = makeHighlight({ id: 'a', text: 'ab', color: 1, createdAt: 100 });
    const second = makeHighlight({ id: 'b', text: 'cd', color: 3, createdAt: 200 });
    const segments = buildSegments('abcd', [first, second]);
    expect(segments).toEqual([
      { text: 'ab', highlight: first },
      { text: 'cd', highlight: second },
    ]);
  });

  it('同一文本在原文出现多次 → 每次出现都被覆盖；相邻同色合并为一段', () => {
    const hl = makeHighlight({ id: 'a', text: 'ha', color: 2 });
    const segments = buildSegments('hahaha', [hl]);
    // 三个出现位置全部覆盖；相邻字符高亮相同则按设计合并为一段
    expect(segments).toEqual([{ text: 'hahaha', highlight: hl }]);
  });

  it('三色交叠：逐字符取 createdAt 最新，非重叠区各归其主', () => {
    const red = makeHighlight({ id: 'r', text: 'abcdef', color: 1, createdAt: 100 });
    const blue = makeHighlight({ id: 'b', text: 'cde', color: 2, createdAt: 300 });
    const green = makeHighlight({ id: 'g', text: 'efg', color: 4, createdAt: 200 });
    const segments = buildSegments('abcdefg', [red, blue, green]);
    // idx0-1 只有 red；idx2-4 最新是 blue(300)；idx4 blue(300)>green(200) 不让位；idx5-6 最新是 green
    expect(segments).toEqual([
      { text: 'ab', highlight: red },
      { text: 'cde', highlight: blue },
      { text: 'fg', highlight: green },
    ]);
  });
});

// ---------- WordCard：scope / exampleIndex 隔离 ----------

function makeWord(): Word {
  const stamp = now();
  return {
    id: 'core:alpha',
    bookId: 'core',
    headword: 'alpha',
    norm: 'alpha',
    meanings: [{ pos: 'n.', cn: '阿尔法' }],
    examples: [
      { en: 'the alpha wins.', zh: 'alpha 赢了比赛。' },
      { en: 'this is alpha too.' },
    ],
    frequencyRank: 1,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  };
}

function mount(ui: React.ReactNode): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('WordCard scope / exampleIndex 隔离（错位不误染）', () => {
  it('exampleIndex=0 的高亮不染 exampleIndex=1 的例句，即使文本相同', () => {
    // 两条例句都含 "alpha"；只给 exampleIndex=0 的高亮
    const hl0 = makeHighlight({
      id: 'ex0',
      scope: 'example',
      exampleIndex: 0,
      text: 'alpha',
      color: 1,
    });
    const page = mount(
      <WordCard word={makeWord()} revealed kind="review" onReveal={() => {}} onSpeak={() => {}} speakDisabled highlights={[hl0]} />,
    );
    const marked = [...page.container.querySelectorAll('span[data-whl-id]')];
    expect(marked).toHaveLength(1);
    expect(marked[0]?.textContent).toBe('alpha');
    expect(marked[0]?.className).toContain('bg-hl-1');
    // 高亮段必须位于第一个例句块内（第二个例句块内没有 data-whl-id）
    const exampleBlocks = [...page.container.querySelectorAll('section[aria-label] > div')];
    expect(exampleBlocks.some((block) => block.contains(marked[0] ?? null))).toBe(true);
    page.unmount();
  });

  it('headword scope 的高亮不染同文本的释义（scope 隔离）', () => {
    // headword=alpha；释义文本也是 alpha；只给 headword 高亮
    const hlHead = makeHighlight({ id: 'head', scope: 'headword', text: 'alpha', color: 4 });
    const word = { ...makeWord(), meanings: [{ pos: 'n.', cn: 'alpha' }] };
    const page = mount(
      <WordCard word={word} revealed kind="review" onReveal={() => {}} onSpeak={() => {}} speakDisabled highlights={[hlHead]} />,
    );
    const marked = [...page.container.querySelectorAll('span[data-whl-id]')];
    expect(marked).toHaveLength(1);
    // 唯一高亮段在 h2（headword）里，不在释义 li 里
    expect(page.container.querySelector('h2')?.contains(marked[0] ?? null)).toBe(true);
    page.unmount();
  });
});

// ---------- setStarred 精确分片标脏 ----------

describe('stateRepo.setStarred 分片标脏（精确断言）', () => {
  it('状态不存在时创建初始状态，且只有 stateKey 对应分片被标脏', async () => {
    const stateKey = stateKeyOfNorm('kilo');
    await setStarred(stateKey, 'core:kilo', true);

    const state = await db.wordStates.get(stateKey);
    expect(state?.isStarred).toBe(true);
    expect(state?.level).toBe(0);
    expect(state?.dueAt).toBe(0);
    expect(state?.firstLearnedAt).toBeNull();
    expect(state?.bookId).toBe('core');

    // 精确分片：dirtyAt 落在 wordStateEntityOf(stateKey)，其余 wordstate-* 分片不脏
    const expectedEntity = wordStateEntityOf(stateKey);
    expect(expectedEntity).toMatch(/^wordstate-\d\.json$/);
    const dirtyEntities = (await db.syncMeta.toArray())
      .filter((meta) => meta.entity.startsWith('wordstate-') && meta.dirtyAt !== null)
      .map((meta) => meta.entity);
    expect(dirtyEntities).toEqual([expectedEntity]);
  });

  it('取消收藏同样只动对应分片', async () => {
    const stateKey = stateKeyOfNorm('lima');
    await setStarred(stateKey, 'core:lima', true);
    await setStarred(stateKey, 'core:lima', false);
    const expectedEntity = wordStateEntityOf(stateKey);
    const dirtyEntities = (await db.syncMeta.toArray())
      .filter((meta) => meta.entity.startsWith('wordstate-') && meta.dirtyAt !== null)
      .map((meta) => meta.entity);
    expect(dirtyEntities).toEqual([expectedEntity]);
    expect((await db.wordStates.get(stateKey))?.isStarred).toBe(false);
  });
});

// ---------- noteRepo ↔ 渲染层往返 ----------

describe('noteRepo 高亮写入 ↔ buildSegments 还原往返', () => {
  it('noteRepo 写入两条同文本先后两色，list 排序 + buildSegments 取最新', async () => {
    const stateKey = stateKeyOfNorm('mike');
    await addHighlight({
      stateKey,
      wordId: 'core:mike',
      scope: 'headword',
      exampleIndex: null,
      text: 'mike',
      color: 1,
    });
    await addHighlight({
      stateKey,
      wordId: 'core:mike',
      scope: 'headword',
      exampleIndex: null,
      text: 'mike',
      color: 3,
    });

    const rows = await listHighlightsByStateKey(stateKey);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.createdAt).toBeLessThanOrEqual(rows[1]?.createdAt ?? 0);

    const segments = buildSegments('mike', rows);
    expect(segments).toEqual([{ text: 'mike', highlight: rows[1] }]);
    expect(segments[0]?.highlight?.color).toBe(3);
  });
});
