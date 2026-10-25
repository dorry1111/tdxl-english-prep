/**
 * WordNotesSection 测试：备注保存（upsert）/ 清空保存 = 删除 /
 * 历史三类结构化笔记合并兜底 / 收藏切换。
 * 串记/联想/谐音 tab 与用户例句入口已按用户要求移除（数据层保留兼容）。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';

import { WordNotesSection } from './WordNotesSection';
import { db } from '@/db';
import { stateKeyOfNorm } from '@/lib/hash';
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
    id: 'core:alpha',
    bookId: 'core',
    headword: 'alpha',
    norm: 'alpha',
    meanings: [{ pos: 'n.', cn: '字母 A' }],
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
    ...overrides,
  };
}

function findByLabel(container: HTMLElement, label: string): HTMLInputElement | HTMLTextAreaElement {
  const element = container.querySelector(
    `[aria-label="${label}"]`,
  ) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!element) {
    throw new Error(`element not found: ${label}`);
  }
  return element;
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const buttons = [...container.querySelectorAll('button')];
  const found = buttons.find((button) => button.textContent === text);
  if (!found) {
    throw new Error(`button not found: ${text}`);
  }
  return found;
}

function setInputValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const setter = Object.getOwnPropertyDescriptor(
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 让组件内的异步写库（fake-indexeddb）与 React 状态更新落定 */
async function flushDb(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

beforeEach(async () => {
  if (!db.isOpen()) {
    await db.open();
  }
});

describe('WordNotesSection 备注', () => {
  it('输入内容点保存 → wordNotes 写入 kind=note 一条', async () => {
    const word = makeWord();
    const page = mount(<WordNotesSection word={word} />);

    const textarea = findByLabel(page.container, '备注');
    act(() => {
      setInputValue(textarea, 'alpha 和 alphabet 串记');
    });
    act(() => {
      buttonByText(page.container, '保存').click();
    });

    await flushDb();

    const stateKey = stateKeyOfNorm('alpha');
    const notes = await db.wordNotes.where('[stateKey+kind]').equals([stateKey, 'note']).toArray();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.content).toBe('alpha 和 alphabet 串记');
    expect(notes[0]?.deletedAt).toBeNull();
    page.unmount();
  });

  it('已有备注再次编辑保存 = 覆盖同一条（不产生第二行）', async () => {
    const stateKey = stateKeyOfNorm('alpha');
    const stamp = now();
    await db.wordNotes.put({
      id: 'wnote_seed',
      stateKey,
      wordId: 'core:alpha',
      kind: 'note',
      content: '旧备注',
      zh: null,
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
    });

    const page = mount(<WordNotesSection word={makeWord()} />);
    // 等加载 effect 完成
    await flushDb();

    const textarea = findByLabel(page.container, '备注');
    expect((textarea as HTMLTextAreaElement).value).toBe('旧备注');
    act(() => {
      setInputValue(textarea, '新备注');
    });
    act(() => {
      buttonByText(page.container, '保存').click();
    });
    await flushDb();

    const rows = await db.wordNotes.where('stateKey').equals(stateKey).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('wnote_seed');
    expect(rows[0]?.content).toBe('新备注');
    page.unmount();
  });

  it('清空保存 = 软删除备注', async () => {
    const stateKey = stateKeyOfNorm('alpha');
    const stamp = now();
    await db.wordNotes.put({
      id: 'wnote_seed',
      stateKey,
      wordId: 'core:alpha',
      kind: 'note',
      content: '旧备注',
      zh: null,
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
    });

    const page = mount(<WordNotesSection word={makeWord()} />);
    await flushDb();

    const textarea = findByLabel(page.container, '备注');
    act(() => {
      setInputValue(textarea, '');
    });
    act(() => {
      buttonByText(page.container, '保存').click();
    });
    await flushDb();

    const rows = await db.wordNotes.where('stateKey').equals(stateKey).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).not.toBeNull();
    page.unmount();
  });

  it('历史三类笔记（无 note 行）→ 加载时按行合并显示，保存后落为 kind=note', async () => {
    const stateKey = stateKeyOfNorm('alpha');
    const stamp = now();
    await db.wordNotes.put({
      id: 'wnote_chunk',
      stateKey,
      wordId: 'core:alpha',
      kind: 'chunk',
      content: '旧串记',
      zh: null,
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
    });
    await db.wordNotes.put({
      id: 'wnote_assoc',
      stateKey,
      wordId: 'core:alpha',
      kind: 'assoc',
      content: '旧联想',
      zh: null,
      createdAt: stamp + 1,
      updatedAt: stamp + 1,
      deletedAt: null,
    });

    const page = mount(<WordNotesSection word={makeWord()} />);
    await flushDb();

    const textarea = findByLabel(page.container, '备注') as HTMLTextAreaElement;
    expect(textarea.value).toBe('旧串记\n旧联想');

    act(() => {
      setInputValue(textarea, '旧串记\n旧联想\n新补充');
    });
    act(() => {
      buttonByText(page.container, '保存').click();
    });
    await flushDb();

    // note 行新建；旧三类行原样保留（不写墓碑，历史数据可追溯）
    const noteRows = await db.wordNotes
      .where('[stateKey+kind]')
      .equals([stateKey, 'note'])
      .toArray();
    expect(noteRows).toHaveLength(1);
    expect(noteRows[0]?.content).toBe('旧串记\n旧联想\n新补充');
    page.unmount();
  });
});

describe('WordNotesSection 收藏', () => {
  it('点收藏 → wordStates 创建初始状态且 isStarred=true，再点取消恢复 false', async () => {
    const stateKey = stateKeyOfNorm('alpha');
    const page = mount(<WordNotesSection word={makeWord()} />);

    const starBtn = buttonByText(page.container, '收藏');
    act(() => {
      starBtn.click();
    });
    await flushDb();
    expect((await db.wordStates.get(stateKey))?.isStarred).toBe(true);

    act(() => {
      buttonByText(page.container, '已收藏').click();
    });
    await flushDb();
    expect((await db.wordStates.get(stateKey))?.isStarred).toBe(false);
    page.unmount();
  });
});
