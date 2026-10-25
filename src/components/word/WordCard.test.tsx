/**
 * WordCard 边界测试（QA 二层验证）：空数据渲染不崩溃、缺块整块不渲染。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { WordCard } from './WordCard';
import { now } from '@/lib/time';
import type { Word } from '@/types';

function mount(ui: React.ReactNode): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
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

function makeWord(overrides?: Partial<Word>): Word {
  const stamp = now();
  return {
    id: 'core:test',
    bookId: 'core',
    headword: 'test',
    norm: 'test',
    meanings: [{ pos: 'n.', cn: '测试' }],
    frequencyRank: 1,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
    ...overrides,
  };
}

const baseProps = {
  revealed: false,
  kind: 'new' as const,
  onReveal: () => {},
  onSpeak: () => {},
  speakDisabled: false,
};

describe('WordCard 边界', () => {
  it('word=null（词条缺失）→ 渲染兜底文案，不崩溃', () => {
    const page = mount(<WordCard {...baseProps} word={null} />);
    expect(page.container.textContent).toContain('没有找到这个单词。');
    page.unmount();
  });

  it('答案态：meanings 为空数组 → 义项列表为空但不崩溃，例句/助记/词根整块不渲染', () => {
    const page = mount(
      <WordCard
        {...baseProps}
        revealed
        word={makeWord({ meanings: [] })}
      />,
    );
    expect(page.container.textContent).toContain('test'); // 单词仍在
    expect(page.container.querySelectorAll('li')).toHaveLength(0); // 无义项行
    expect(page.container.textContent).not.toContain('例句');
    expect(page.container.textContent).not.toContain('助记');
    expect(page.container.textContent).not.toContain('词根词缀');
    page.unmount();
  });

  it('未揭示时点喇叭不触发揭示（stopPropagation）', () => {
    let revealed = false;
    const page = mount(
      <WordCard
        {...baseProps}
        word={makeWord()}
        onReveal={() => {
          revealed = true;
        }}
      />,
    );
    const speak = page.container.querySelector('button[aria-label="发音"]');
    expect(speak).not.toBeNull();
    act(() => {
      (speak as HTMLButtonElement).click();
    });
    expect(revealed).toBe(false);
    page.unmount();
  });
});
