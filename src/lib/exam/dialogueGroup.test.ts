/**
 * 口语交际分组 / 正文还原（dialogueGroup）单测。
 *
 * 用「2019 型」数据（同一段对话复制进每个空位的 stem、自己的空位是 `____`、
 * 其它空位退化成裸数字）验证：按选项签名分组、正文只保留一次、空位还原成 `____(N)`；
 * 再用「2012 型」数据（十段独立对话）验证退化为一题一组。
 */
import { describe, expect, it } from 'vitest';

import {
  buildDialogueText,
  buildQuestionPages,
  dialogueBlankIndex,
  groupDialogueQuestions,
  normalizeDialogueStem,
  splitDialogueText,
} from './dialogueGroup';
import type { Question } from '@/types';

/** 造一道口语题（只填本模块关心的字段） */
function dialogueQuestion(
  seq: number,
  stem: string,
  options: Array<{ key: string; text: string }>,
): Question {
  return {
    id: `q${seq}`,
    paperId: 'p1',
    sectionType: 'dialogue',
    passageId: null,
    seq,
    stem,
    blankIndex: seq,
    options,
    answerKey: 'A',
    referenceAnswer: null,
    explanation: '',
    score: 1,
    isObjective: true,
    updatedAt: 0,
    deletedAt: null,
  };
}

const GROUP_OPTIONS = [
  { key: 'A', text: "You've been saying that forever!" },
  { key: 'B', text: 'There must be ten here.' },
  { key: 'C', text: "Let's read this book." },
];

/** 2019 型：三个空位共用一组选项，stem 是同一段对话的不同窗口 */
function buildSharedDialogue(): Question[] {
  return [
    dialogueQuestion(1, '（第 1 空）Girl:  ____ ', GROUP_OPTIONS),
    dialogueQuestion(
      2,
      "（第 2 空）Girl: That's boring.  ____  It's about a bear and a cat. Dad: Whoa, I thought you said one book. 3",
      GROUP_OPTIONS,
    ),
    dialogueQuestion(
      3,
      "（第 3 空）Girl: That's boring. 2 It's about a bear and a cat. Dad: Whoa, I thought you said one book.  ____ ",
      GROUP_OPTIONS,
    ),
  ];
}

describe('normalizeDialogueStem', () => {
  it('剥离「（第 N 空）」前缀', () => {
    // 前缀剥离 + 自己的空位还原（尾部空格由 mergeDialogueWindows 统一 trim）
    expect(normalizeDialogueStem('（第 1 空）Girl:  ____ ', [1, 2, 3], 1).trim()).toBe('Girl: ____(1)');
  });

  it('把组内其它空位的裸数字还原成 ____(N)', () => {
    const normalized = normalizeDialogueStem(
      "Girl: That's boring.  ____  It's about a bear. Dad: Whoa. 3",
      [1, 2, 3],
      2,
    );
    expect(normalized).toContain('____(2)');
    expect(normalized).toContain('____(3)');
    expect(normalized).not.toMatch(/\s3$/);
  });

  it('不误伤正文里的数字（287 / 200 这类不是空位号）', () => {
    const normalized = normalizeDialogueStem(
      'Karen: I would like to register for Comp Lit 287. Stuart:  ____ ',
      [7, 8],
      7,
    );
    expect(normalized).toContain('287');
    expect(normalized).toContain('____(7)');
  });
});

describe('groupDialogueQuestions', () => {
  it('同一段对话按选项签名合并成一组，正文只出现一次', () => {
    const groups = groupDialogueQuestions(buildSharedDialogue());
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group?.blanks).toEqual([1, 2, 3]);
    expect(group?.anchorSeq).toBe(1);
    // 同一句话不能被拼两遍
    expect(group?.text.match(/That's boring/g) ?? []).toHaveLength(1);
    expect(group?.text).toContain('____(1)');
    expect(group?.text).toContain('____(2)');
    expect(group?.text).toContain('____(3)');
  });

  it('选项不同的独立对话退化为一题一组（2012 型）', () => {
    const questions = [1, 2, 3].map((seq) =>
      dialogueQuestion(seq, `A: line ${seq} B: answer ${seq}`, [
        { key: 'A', text: `option-a-${seq}` },
        { key: 'B', text: `option-b-${seq}` },
      ]),
    );
    const groups = groupDialogueQuestions(questions);
    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.questions.length)).toEqual([1, 1, 1]);
  });

  it('只处理口语题，其它题型不进组', () => {
    const questions: Question[] = [
      ...buildSharedDialogue(),
      { ...dialogueQuestion(4, 'vocab stem', []), sectionType: 'vocabulary', blankIndex: null },
    ];
    expect(groupDialogueQuestions(questions)).toHaveLength(1);
  });
});

describe('buildDialogueText', () => {
  it('窗口互相包含时取最长的一段', () => {
    const text = buildDialogueText(buildSharedDialogue());
    // 第 1 空只有一行，后面整段另起一行；不得重复整段
    expect(text.split('\n')).toHaveLength(2);
  });

  it('空组返回空串', () => {
    expect(buildDialogueText([])).toBe('');
  });
});

describe('splitDialogueText', () => {
  it('切出文本段与空位段', () => {
    const parts = splitDialogueText('Girl: ____(1)\nDad: ____(2) end');
    expect(parts.filter((part) => part.kind === 'blank')).toEqual([
      { kind: 'blank', blank: 1 },
      { kind: 'blank', blank: 2 },
    ]);
  });
});

describe('dialogueBlankIndex', () => {
  it('blankIndex 缺失时回落到 seq', () => {
    const question = dialogueQuestion(5, 'stem', []);
    expect(dialogueBlankIndex({ ...question, blankIndex: null })).toBe(5);
  });
});

describe('buildQuestionPages', () => {
  it('口语整组算一屏，其余一题一屏', () => {
    const questions: Question[] = [
      ...buildSharedDialogue(),
      { ...dialogueQuestion(4, 'v4', []), sectionType: 'vocabulary', blankIndex: null },
      { ...dialogueQuestion(5, 'v5', []), sectionType: 'vocabulary', blankIndex: null },
    ];
    const pages = buildQuestionPages(questions);
    expect(pages).toHaveLength(3);
    expect(pages[0]?.seqs).toEqual([1, 2, 3]);
    expect(pages[0]?.anchorSeq).toBe(1);
    expect(pages[1]?.seqs).toEqual([4]);
    expect(pages[2]?.seqs).toEqual([5]);
  });

  it('每一屏的 seq 覆盖全部题目且不重复', () => {
    const questions = buildSharedDialogue();
    const pages = buildQuestionPages(questions);
    expect(pages.flatMap((page) => page.seqs)).toEqual([1, 2, 3]);
  });
});
