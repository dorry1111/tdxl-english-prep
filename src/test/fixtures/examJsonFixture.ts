/**
 * 标准整卷 JSON fixture（T13/T14/T15 测试共用）。
 *
 * 严格按 PRD 3.4.1 官方结构：口语 10×1 / 词汇 10×1 / 阅读 25×1（5 篇文章）/
 * 完形 10×1 / 短文完成 20×1 / 英译汉 1×10 / 写作 1×15 = 77 题 100 分、限时 9000s。
 * 答案自洽（answerKey 按 seq 循环 A-D），解析逐题生成。
 */
import type { ExamJsonFile } from '@/lib/importers/examJson';
import type { SectionType } from '@/types';

/** 区段定义（与 examRepo.STANDARD_PAPER_STRUCTURE 一致） */
const SECTION_SPECS: ReadonlyArray<{ type: SectionType; count: number; score: number }> = [
  { type: 'dialogue', count: 10, score: 10 },
  { type: 'vocabulary', count: 10, score: 10 },
  { type: 'reading', count: 25, score: 25 },
  { type: 'cloze', count: 10, score: 10 },
  { type: 'short-completion', count: 20, score: 20 },
  { type: 'translation', count: 1, score: 10 },
  { type: 'writing', count: 1, score: 15 },
];

const OBJECTIVE_TYPES: ReadonlySet<string> = new Set([
  'dialogue',
  'vocabulary',
  'reading',
  'cloze',
  'short-completion',
]);

/** 第 seq 题的答案字母（确定循环，便于测试手算分数） */
export function standardAnswerKeyOf(seq: number): string {
  return ['A', 'B', 'C', 'D'][seq % 4] as string;
}

/**
 * 构建标准整卷 JSON（PRD 8.3 结构，validateExamJson 全绿）。
 */
export function buildStandardExamJson(title = '标准模拟卷 A'): ExamJsonFile {
  const passages: ExamJsonFile['passages'] = [];
  const questions: ExamJsonFile['questions'] = [];

  // 阅读 5 篇（每篇 5 题）
  for (let index = 1; index <= 5; index += 1) {
    passages.push({
      id: `std-p-read-${index}`,
      sectionType: 'reading',
      order: index,
      content: `Reading Passage ${index}. The quick brown fox jumps over the lazy dog. This is test passage number ${index} for the standard mock exam paper.`,
      translation: `阅读文章 ${index} 的参考译文。`,
    });
  }
  // 完形 1 篇
  passages.push({
    id: 'std-p-cloze-1',
    sectionType: 'cloze',
    order: 1,
    content: 'Cloze passage. Learning a language takes time and patience. Every learner must practice daily to make progress in vocabulary and grammar.',
  });
  // 短文完成 1 篇
  passages.push({
    id: 'std-p-short-1',
    sectionType: 'short-completion',
    order: 1,
    content: 'Short completion passage. Choose the correct sentence from the box to fill each blank in the passage below.',
  });

  let seq = 0;
  for (const spec of SECTION_SPECS) {
    const isObjective = OBJECTIVE_TYPES.has(spec.type);
    for (let index = 1; index <= spec.count; index += 1) {
      seq += 1;
      const answerKey = isObjective ? standardAnswerKeyOf(seq) : null;
      let passageId: string | null = null;
      let blankIndex: number | null = null;
      if (spec.type === 'reading') {
        passageId = `std-p-read-${Math.floor((index - 1) / 5) + 1}`;
      } else if (spec.type === 'cloze') {
        passageId = 'std-p-cloze-1';
        blankIndex = index;
      } else if (spec.type === 'short-completion') {
        passageId = 'std-p-short-1';
        blankIndex = index;
      }
      questions.push({
        id: `std-q${seq}`,
        sectionType: spec.type,
        passageId,
        seq,
        stem:
          spec.type === 'cloze' || spec.type === 'short-completion'
            ? `第 ${index} 空：Choose the best answer for blank ${index}.`
            : `Question ${seq}: sample stem for ${spec.type}.`,
        blankIndex,
        options: isObjective
          ? (['A', 'B', 'C', 'D'] as const).map((key) => ({
              key,
              text: `选项 ${key}-${seq}`,
            }))
          : [],
        answerKey,
        referenceAnswer:
          spec.type === 'translation'
            ? '这是第 76 题英译汉的参考译文。'
            : spec.type === 'writing'
              ? 'This is the model essay for question 77.'
              : null,
        explanation: `解析：第 ${seq} 题${answerKey ? `选 ${answerKey}` : '为主观题'}。`,
        score: spec.score / spec.count,
      });
    }
  }

  return {
    schemaVersion: 1,
    paper: {
      title,
      timeLimitSec: 9000,
      totalScore: 100,
      sections: SECTION_SPECS.map((spec, index) => ({
        type: spec.type,
        order: index + 1,
        questionCount: spec.count,
        score: spec.score,
      })),
    },
    passages,
    questions,
  };
}
