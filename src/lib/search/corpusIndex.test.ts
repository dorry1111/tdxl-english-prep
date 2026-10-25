/**
 * corpusIndex 测试：切句 / 搜索 / 失效重建。
 *
 * 环境由 src/test/setup.ts 提供：fake-indexeddb + 每用例清库。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  invalidateCorpusIndex,
  searchCorpus,
  splitSentences,
} from '@/lib/search/corpusIndex';
import type { Exam, Passage, Question } from '@/types';

function examRow(partial: Partial<Exam>): Exam {
  return {
    id: 'builtin-2023',
    title: '2023年真题',
    source: 'builtin',
    sections: [],
    totalQuestions: 2,
    totalScore: 100,
    timeLimitSec: 7200,
    parseStatus: 'verified',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...partial,
  };
}

function passageRow(partial: Partial<Passage>): Passage {
  return {
    id: 'p1',
    paperId: 'builtin-2023',
    sectionType: 'reading',
    order: 1,
    content: '',
    updatedAt: 1,
    deletedAt: null,
    ...partial,
  };
}

function questionRow(partial: Partial<Question>): Question {
  return {
    id: 'q1',
    paperId: 'builtin-2023',
    sectionType: 'reading',
    passageId: 'p1',
    seq: 1,
    stem: '',
    blankIndex: null,
    options: [],
    answerKey: 'A',
    referenceAnswer: null,
    explanation: '',
    score: 1,
    isObjective: true,
    updatedAt: 1,
    deletedAt: null,
    ...partial,
  };
}

beforeEach(async () => {
  if (!db.isOpen()) {
    await db.open();
  }
  // 模块级索引缓存必须每个用例重置，否则读到上一个用例的库
  invalidateCorpusIndex();
});

describe('splitSentences', () => {
  it('按英文句末标点切句并去空', () => {
    expect(splitSentences('Climate is real. It matters! Really?')).toEqual([
      'Climate is real.',
      'It matters!',
      'Really?',
    ]);
  });

  it('按换行切段，段内再切句；中文句号同样切分', () => {
    expect(splitSentences('第一句话。第二句话！\n\nEnglish one. Two?')).toEqual([
      '第一句话。',
      '第二句话！',
      'English one.',
      'Two?',
    ]);
  });
});

describe('searchCorpus', () => {
  it('大小写不敏感命中原文句，返回整句 + 试卷标题 + 定位题目', async () => {
    await db.exams.bulkPut([
      examRow({}),
      examRow({ id: 'builtin-2024', title: '2024年真题', createdAt: 2 }),
    ]);
    await db.passages.bulkPut([
      passageRow({ content: 'Climate change affects agriculture. Farmers adapt slowly.' }),
      passageRow({
        id: 'p2',
        paperId: 'builtin-2024',
        content: 'The ocean absorbs heat. Coral reefs suffer.',
      }),
    ]);
    await db.questions.bulkPut([
      questionRow({}),
      questionRow({ id: 'q2', paperId: 'builtin-2024', passageId: 'p2', seq: 2 }),
    ]);

    const hits = await searchCorpus('CLIMATE');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.text).toBe('Climate change affects agriculture.');
    expect(hits[0]?.paperTitle).toBe('2023年真题');
    expect(hits[0]?.questionId).toBe('q1');
    expect(hits[0]?.source).toBe('passage');
  });

  it('题干与解析也进索引；无题目关联的孤文不进', async () => {
    await db.exams.bulkPut([examRow({})]);
    await db.passages.bulkPut([
      passageRow({ id: 'p-orphan', content: 'Orphan passage sentence about gravity.' }),
      passageRow({ id: 'p2', content: 'Reading text about photosynthesis in plants.' }),
    ]);
    await db.questions.bulkPut([
      questionRow({
        id: 'qv',
        passageId: 'p2',
        sectionType: 'vocabulary',
        stem: 'Choose the word closest to photosynthesis.',
        explanation: 'Photosynthesis means converting light into energy.',
      }),
    ]);

    const stemHits = await searchCorpus('closest to photosynthesis');
    expect(stemHits).toHaveLength(1);
    expect(stemHits[0]?.source).toBe('stem');

    const explHits = await searchCorpus('converting light');
    expect(explHits[0]?.source).toBe('explanation');

    const orphanHits = await searchCorpus('gravity');
    expect(orphanHits).toHaveLength(0);
  });

  it('已删除试卷的语料不参与搜索', async () => {
    await db.exams.bulkPut([examRow({ deletedAt: 99 })]);
    await db.passages.bulkPut([passageRow({ content: 'Deleted paper sentence here.' })]);
    await db.questions.bulkPut([questionRow({})]);

    expect(await searchCorpus('Deleted paper')).toHaveLength(0);
  });

  it('invalidateCorpusIndex 后能搜到新导入的卷', async () => {
    await db.exams.bulkPut([examRow({})]);
    await db.passages.bulkPut([passageRow({ content: 'First version of the text.' })]);
    await db.questions.bulkPut([questionRow({})]);
    expect(await searchCorpus('second version')).toHaveLength(0);

    // 模拟 examRepo 写入后的失效调用
    await db.passages.put(passageRow({ content: 'Second version of the text.', updatedAt: 2 }));
    invalidateCorpusIndex();
    const hits = await searchCorpus('second version');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.text).toBe('Second version of the text.');
  });

  it('空查询与未命中都返回空数组', async () => {
    await db.exams.bulkPut([examRow({})]);
    await db.passages.bulkPut([passageRow({ content: 'Some ordinary sentence.' })]);
    await db.questions.bulkPut([questionRow({})]);
    expect(await searchCorpus('')).toHaveLength(0);
    expect(await searchCorpus('   ')).toHaveLength(0);
    expect(await searchCorpus('zzzznotexist')).toHaveLength(0);
  });
});
