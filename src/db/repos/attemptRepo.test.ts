/**
 * attemptRepo / wrongRepo 单测（T11：答卷草稿落库 + 错题本累计/重做闭环）。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  createAttempt,
  getAnswer,
  getAnswers,
  getAttempt,
  listByPaper,
  patchAttempt,
  putAnswers,
  updateAnswer,
} from '@/db/repos/attemptRepo';
import {
  countPending,
  listAll,
  listPending,
  setResolved,
  upsertWrong,
  upsertWrongMany,
} from '@/db/repos/wrongRepo';
import { now } from '@/lib/time';
import type { Attempt, AttemptAnswer, SectionType } from '@/types';

const STAMP = 1_700_000_000_000;

function makeAttempt(id: string, paperId: string, startedAt: number): Attempt {
  return {
    id,
    paperId,
    mode: 'full',
    sectionType: null,
    startedAt,
    submittedAt: null,
    durationSec: 0,
    objectiveScore: 0,
    subjectiveScore: null,
    totalScore: 100,
    deviceId: 'dev-test',
    updatedAt: STAMP,
    deletedAt: null,
  };
}

function makeAnswer(attemptId: string, questionId: string, choice: string | null): AttemptAnswer {
  return {
    id: `${attemptId}:${questionId}`,
    attemptId,
    questionId,
    choice,
    text: null,
    isCorrect: null,
    flagged: false,
    selfScore: null,
    answeredAt: now(),
  };
}

describe('attemptRepo', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it('创建 → 读取 → patchAttempt 局部更新（交卷写分数）', async () => {
    await createAttempt(makeAttempt('att-1', 'paper-1', STAMP));
    expect((await getAttempt('att-1'))?.paperId).toBe('paper-1');
    const patched = await patchAttempt('att-1', {
      submittedAt: STAMP + 1000,
      durationSec: 3600,
      objectiveScore: 70,
    });
    expect(patched?.submittedAt).toBe(STAMP + 1000);
    expect(patched?.objectiveScore).toBe(70);
    expect(patched?.totalScore).toBe(100); // 未提交的字段保持原值
    expect(await patchAttempt('att-missing', { durationSec: 1 })).toBeUndefined();
  });

  it('putAnswers 批量写入 + getAnswers 读取；getAnswer 复合主键查询', async () => {
    await createAttempt(makeAttempt('att-1', 'paper-1', STAMP));
    const answers = [
      makeAnswer('att-1', 'q1', 'A'),
      makeAnswer('att-1', 'q2', 'C'),
      makeAnswer('att-1', 'q3', null), // 主观题，未作答
    ];
    await putAnswers('paper-1', answers);
    const all = await getAnswers('att-1');
    expect(all).toHaveLength(3);
    const single = await getAnswer('att-1', 'q2');
    expect(single?.choice).toBe('C');
    expect(await getAnswer('att-other', 'q2')).toBeUndefined();
  });

  it('updateAnswer 单条落库（3s 草稿）：新写 + 覆盖同主键', async () => {
    await createAttempt(makeAttempt('att-1', 'paper-1', STAMP));
    await updateAnswer(makeAnswer('att-1', 'q1', 'A'));
    expect((await getAnswer('att-1', 'q1'))?.choice).toBe('A');
    // 同主键覆盖 → 模拟草稿每 3s 重写
    await updateAnswer(makeAnswer('att-1', 'q1', 'B'));
    expect((await getAnswer('att-1', 'q1'))?.choice).toBe('B');
    expect(await db.attemptAnswers.count()).toBe(1);
    // 脏标记挂在答卷所属试卷的 exams/<paperId>.json 上
    const meta = await db.syncMeta.get('exams/paper-1.json');
    expect(meta?.pendingCount).toBe(2);
  });

  it('listByPaper 按开考时间倒序（历史成绩都保留）', async () => {
    await createAttempt(makeAttempt('att-1', 'paper-1', STAMP));
    await createAttempt(makeAttempt('att-2', 'paper-1', STAMP + 5000));
    await createAttempt(makeAttempt('att-3', 'paper-2', STAMP + 9000));
    const list = await listByPaper('paper-1');
    expect(list.map((attempt) => attempt.id)).toEqual(['att-2', 'att-1']);
  });
});

describe('wrongRepo', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  it('重复答错累计 wrongCount，不产生重复条目', async () => {
    const first = await upsertWrong({
      questionId: 'q1',
      paperId: 'paper-1',
      sectionType: 'reading' as SectionType,
    });
    const second = await upsertWrong({
      questionId: 'q1',
      paperId: 'paper-1',
      sectionType: 'reading' as SectionType,
      wrongAt: STAMP + 1000,
    });
    expect(first.wrongCount).toBe(1);
    expect(second.wrongCount).toBe(2);
    expect(second.lastWrongAt).toBe(STAMP + 1000);
    expect(await db.wrongItems.count()).toBe(1);
  });

  it('重做答对 → resolved=true 移出待复习；再次答错 → 复位并继续累计', async () => {
    await upsertWrong({ questionId: 'q1', paperId: 'paper-1', sectionType: 'cloze' });
    await setResolved('q1', true);
    expect(await countPending()).toBe(0);
    expect(await listPending()).toEqual([]);
    const all = await listAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.resolved).toBe(true);
    // 重做又答错：复位 resolved，wrongCount 继续累加
    await upsertWrong({ questionId: 'q1', paperId: 'paper-1', sectionType: 'cloze' });
    const pending = await listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.wrongCount).toBe(2);
    expect(pending[0]?.resolved).toBe(false);
  });

  it('setResolved 对不存在的题目是安全的 no-op', async () => {
    await setResolved('q-ghost', true);
    expect(await db.wrongItems.count()).toBe(0);
  });

  it('upsertWrongMany 单事务批量写入；批内重复 questionId 也正确累计', async () => {
    const results = await upsertWrongMany([
      { questionId: 'q1', paperId: 'paper-1', sectionType: 'dialogue' },
      { questionId: 'q2', paperId: 'paper-1', sectionType: 'vocabulary' },
      { questionId: 'q1', paperId: 'paper-1', sectionType: 'dialogue' },
    ]);
    expect(results).toHaveLength(3);
    expect(results[0]?.wrongCount).toBe(1);
    expect(results[2]?.wrongCount).toBe(2);
    expect(await db.wrongItems.count()).toBe(2);
    expect(await countPending()).toBe(2);
    // 空数组直接返回，不写事务
    expect(await upsertWrongMany([])).toEqual([]);
  });
});
