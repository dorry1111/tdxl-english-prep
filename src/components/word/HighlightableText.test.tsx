/**
 * HighlightableText 测试：分段还原（纯函数）+ 渲染还原 + 删除交互 + 划选色板。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { buildSegments, HighlightableText } from './HighlightableText';
import { now } from '@/lib/time';
import type { WordHighlight } from '@/types';

function makeHighlight(overrides: Partial<WordHighlight>): WordHighlight {
  const stamp = now();
  return {
    id: 'whl_test',
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

describe('buildSegments（纯函数）', () => {
  it('无高亮 → 单段原文', () => {
    expect(buildSegments('hello world', [])).toEqual([{ text: 'hello world', highlight: null }]);
  });

  it('空文本 → 空分段', () => {
    expect(buildSegments('', [makeHighlight({})])).toEqual([]);
  });

  it('命中子串 → 三段（前/高亮/后）', () => {
    const hl = makeHighlight({ text: 'world', color: 2 });
    const segments = buildSegments('hello world', [hl]);
    expect(segments).toEqual([
      { text: 'hello ', highlight: null },
      { text: 'world', highlight: hl },
    ]);
  });

  it('同文本两条高亮 → 每个字符取 createdAt 最新的一条', () => {
    const old = makeHighlight({ id: 'a', text: 'test', color: 1, createdAt: 100 });
    const newer = makeHighlight({ id: 'b', text: 'test', color: 3, createdAt: 200 });
    const segments = buildSegments('test', [old, newer]);
    expect(segments).toEqual([{ text: 'test', highlight: newer }]);
    // 反序传入结果一致
    expect(buildSegments('test', [newer, old])).toEqual([{ text: 'test', highlight: newer }]);
  });

  it('不同子串重叠 → 重叠字符归最新一条，分段按覆盖合并', () => {
    const first = makeHighlight({ id: 'a', text: 'abcd', color: 1, createdAt: 100 });
    const second = makeHighlight({ id: 'b', text: 'cdef', color: 2, createdAt: 200 });
    const segments = buildSegments('abcdef', [first, second]);
    expect(segments).toEqual([
      { text: 'ab', highlight: first },
      { text: 'cdef', highlight: second },
    ]);
  });

  it('未命中的高亮记录不影响渲染', () => {
    const miss = makeHighlight({ text: 'zzz' });
    expect(buildSegments('hello', [miss])).toEqual([{ text: 'hello', highlight: null }]);
  });
});

// ---------- 渲染层 ----------

function mount(ui: React.ReactNode): { container: HTMLElement; root: Root; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    root,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('HighlightableText 渲染', () => {
  it('高亮段落渲染为带 bg-hl-N 类的 span，全文保持原序完整', () => {
    const hl = makeHighlight({ text: 'world', color: 2 });
    const page = mount(<HighlightableText text="hello world" highlights={[hl]} />);
    const marked = page.container.querySelectorAll('span[data-whl-id]');
    expect(marked).toHaveLength(1);
    expect(marked[0]?.className).toContain('bg-hl-2');
    expect(marked[0]?.textContent).toBe('world');
    expect(page.container.textContent).toBe('hello world');
    page.unmount();
  });

  it('无高亮时渲染纯文本，无 data-whl-id 节点', () => {
    const page = mount(<HighlightableText text="plain" highlights={[]} />);
    expect(page.container.querySelectorAll('span[data-whl-id]')).toHaveLength(0);
    expect(page.container.textContent).toBe('plain');
    page.unmount();
  });

  it('点击高亮段 → 出现删除按钮 → 点击删除回调携带 id', () => {
    const hl = makeHighlight({ id: 'whl_x', text: 'world', color: 4 });
    let deleted: string | null = null;
    const page = mount(
      <HighlightableText
        text="hello world"
        highlights={[hl]}
        onAddHighlight={() => {}}
        onDeleteHighlight={(id) => {
          deleted = id;
        }}
      />,
    );
    const marked = page.container.querySelector('span[data-whl-id]') as HTMLElement;
    act(() => {
      marked.click();
    });
    const deleteBtn = document.querySelector('button[data-whl-delete]') as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();
    expect(deleteBtn.getAttribute('aria-label')).toBe('删除高亮');
    act(() => {
      deleteBtn.click();
    });
    expect(deleted).toBe('whl_x');
    page.unmount();
  });

  it('再次点击同一高亮段收起删除按钮', () => {
    const hl = makeHighlight({ id: 'whl_y', text: 'world', color: 1 });
    const page = mount(
      <HighlightableText
        text="hello world"
        highlights={[hl]}
        onAddHighlight={() => {}}
        onDeleteHighlight={() => {}}
      />,
    );
    const marked = page.container.querySelector('span[data-whl-id]') as HTMLElement;
    act(() => {
      marked.click();
    });
    expect(document.querySelector('button[data-whl-delete]')).not.toBeNull();
    act(() => {
      marked.click();
    });
    expect(document.querySelector('button[data-whl-delete]')).toBeNull();
    page.unmount();
  });

  it('划选文本 + mouseup → 色板出现 → 点颜色回调携带选中文本与颜色档位', () => {
    let received: { text: string; color: number } | null = null;
    const page = mount(
      <HighlightableText
        text="hello world"
        highlights={[]}
        onAddHighlight={(text, color) => {
          received = { text, color };
        }}
      />,
    );
    const host = page.container.firstElementChild as HTMLElement;
    const textNode = host.firstChild?.firstChild as Text;

    // 模拟划选 "world"（jsdom 支持 Range + Selection 的最小实现）
    const selection = window.getSelection();
    expect(selection).not.toBeNull();
    const range = document.createRange();
    range.selectNodeContents(host.firstChild as Node);
    // 只选后半段：手动设置起止
    range.setStart(textNode, 6);
    range.setEnd(textNode, 11);
    act(() => {
      selection?.removeAllRanges();
      selection?.addRange(range);
    });

    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });

    const palette = document.querySelector('[role="toolbar"]');
    expect(palette).not.toBeNull();

    const blue = palette?.querySelector('button[aria-label="高亮颜色 3"]') as HTMLButtonElement;
    expect(blue).not.toBeNull();
    act(() => {
      blue.click();
    });
    expect(received).toEqual({ text: 'world', color: 3 });
    // 选色后色板收起
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    page.unmount();
  });

  it('只读模式（不传 onAddHighlight）划选不出色板', () => {
    const page = mount(<HighlightableText text="hello world" highlights={[]} />);
    const host = page.container.firstElementChild as HTMLElement;
    const textNode = host.firstChild?.firstChild as Text;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);
    act(() => {
      selection?.removeAllRanges();
      selection?.addRange(range);
      window.dispatchEvent(new MouseEvent('mouseup'));
    });
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    page.unmount();
  });
});
