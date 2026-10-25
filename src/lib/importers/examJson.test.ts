import { describe, expect, it } from 'vitest';
import { validateExamJson, type ExamJsonFile } from './examJson';

/** 构造一份最小合法卷（PRD 8.3 结构） */
function validPaper(): ExamJsonFile {
  return {
    schemaVersion: 1,
    paper: {
      title: '测试卷',
      timeLimitSec: 9000,
      totalScore: 100,
      sections: [
        { type: 'dialogue', order: 1, questionCount: 10, score: 10, minutes: 15 },
        { type: 'vocabulary', order: 2, questionCount: 10, score: 10, minutes: 10 },
        { type: 'reading', order: 3, questionCount: 25, score: 25, minutes: 45 },
        { type: 'cloze', order: 4, questionCount: 10, score: 10, minutes: 10 },
        { type: 'short-completion', order: 5, questionCount: 20, score: 20, minutes: 20 },
        { type: 'translation', order: 6, questionCount: 1, score: 10, minutes: 20 },
        { type: 'writing', order: 7, questionCount: 1, score: 15, minutes: 30 },
      ],
    },
    passages: [{ id: 'p1', sectionType: 'reading', order: 1, content: 'A passage.' }],
    questions: [],
  };
}

/** 生成 n 道某题型的客观题 */
function objQs(type: ExamJsonFile['questions'][number]['sectionType'], from: number, n: number, passageId?: string) {
  return Array.from({ length: n }, (_, i) => ({
    id: `q${from + i}`,
    sectionType: type,
    ...(passageId ? { passageId } : {}),
    seq: from + i,
    stem: `stem ${from + i}`,
    options: [
      { key: 'A', text: 'a' },
      { key: 'B', text: 'b' },
      { key: 'C', text: 'c' },
      { key: 'D', text: 'd' },
    ],
    answerKey: 'A',
    explanation: 'explanation',
    score: type === 'translation' || type === 'writing' ? 10 : 1,
  }));
}

/** 组装一份 77 题全法卷 */
function fullPaper(): ExamJsonFile {
  const p = validPaper();
  p.questions = [
    ...objQs('dialogue', 1, 10),
    ...objQs('vocabulary', 11, 10),
    ...objQs('reading', 21, 25, 'p1'),
    ...objQs('cloze', 46, 10),
    ...objQs('short-completion', 56, 20),
    {
      id: 'q76',
      sectionType: 'translation',
      seq: 76,
      stem: 'Translate this passage.',
      options: [],
      answerKey: null,
      referenceAnswer: '参考译文。',
      score: 10,
    },
    {
      id: 'q77',
      sectionType: 'writing',
      seq: 77,
      stem: 'Write an essay.',
      options: [],
      answerKey: null,
      referenceAnswer: '范文。',
      score: 15,
    },
  ];
  return p;
}

describe('validateExamJson（PRD 8.3）', () => {
  it('合法的 77 题标准卷通过', () => {
    const r = validateExamJson(fullPaper());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.questions).toHaveLength(77);
      expect(r.warnings).toEqual([]);
    }
  });

  it('规则④：answerKey 不在选项集合内 → 报错含 questions[3].answerKey', () => {
    const p = fullPaper();
    (p.questions[3] as { answerKey: string }).answerKey = 'E';
    const r = validateExamJson(p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const hit = r.errors.find((e) => e.includes('questions[3].answerKey'));
      expect(hit, r.errors.join('\n')).toBeTruthy();
    }
  });

  it('规则⑤：seq 不连续 → 报错含字段路径', () => {
    const p = fullPaper();
    (p.questions[5] as { seq: number }).seq = 99;
    const r = validateExamJson(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('.seq'))).toBe(true);
  });

  it('规则②：questionCount 与实际题数不符 → paper.sections[i].questionCount', () => {
    const p = fullPaper();
    p.paper.sections[2] = { ...p.paper.sections[2]!, questionCount: 26 };
    const r = validateExamJson(p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('paper.sections[2].questionCount'))).toBe(true);
    }
  });

  it('规则③：Σ section.score ≠ totalScore → 报错', () => {
    const p = fullPaper();
    p.paper.totalScore = 99;
    const r = validateExamJson(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('totalScore'))).toBe(true);
  });

  it('规则①：题型重复 → 报错；缺题型 → 仅警告', () => {
    const p = fullPaper();
    p.paper.sections[1] = { ...p.paper.sections[1]!, type: 'dialogue' };
    // 修正题量使其它规则不受干扰：dialogue 20 题
    const r = validateExamJson(p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('paper.sections[1].type') && e.includes('重复'))).toBe(true);
    }
    const q = fullPaper();
    q.paper.sections = q.paper.sections.filter((s) => s.type !== 'cloze');
    q.questions = q.questions.filter((x) => x.sectionType !== 'cloze');
    // 重排 seq 保持连续（缺题型只应产生警告，不应被序号断裂干扰）
    q.questions.forEach((x, i) => {
      (x as { seq: number }).seq = i + 1;
    });
    // 同步总分（规则③不受缺题型干扰）
    q.paper.totalScore = q.paper.sections.reduce((s, x) => s + x.score, 0);
    const r2 = validateExamJson(q);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.warnings.some((w) => w.includes('cloze'))).toBe(true);
  });

  it('主观题带 answerKey / 缺 referenceAnswer → 报错', () => {
    const p = fullPaper();
    (p.questions[75] as { answerKey: string | null }).answerKey = 'A';
    const r = validateExamJson(p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('questions[75].answerKey'))).toBe(true);
    }
    const p2 = fullPaper();
    (p2.questions[76] as { referenceAnswer: string | null }).referenceAnswer = null;
    const r2 = validateExamJson(p2);
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.errors.some((e) => e.includes('questions[76].referenceAnswer'))).toBe(true);
    }
  });

  it('passageId 引用不存在的文章 → 报错', () => {
    const p = fullPaper();
    (p.questions[20] as { passageId: string | null }).passageId = 'p404';
    const r = validateExamJson(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('questions[20].passageId'))).toBe(true);
  });

  it('schemaVersion 错误 → 报错且不抛异常', () => {
    const p = fullPaper();
    (p as { schemaVersion: number }).schemaVersion = 2;
    const r = validateExamJson(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
  });

  it('四选项题型选项数 ≠4 → 警告（非错误），口语/短文完成豁免', () => {
    // vocabulary 选项被黏连缺陷吃掉一个（2020 seq15 "recommendD. debate" 场景）
    const p = fullPaper();
    (p.questions[10] as { options: Array<{ key: string; text: string }> }).options = [
      { key: 'A', text: 'a' },
      { key: 'B', text: 'b' },
      { key: 'C', text: 'recommendD' },
    ];
    const r = validateExamJson(p);
    expect(r.ok).toBe(true); // 仅告警，不阻塞导入
    if (r.ok) {
      expect(r.warnings.some((w) => w.includes('questions[10].options') && w.includes('3'))).toBe(true);
    }
    // 口语 3 选项合法，不告警
    const p2 = fullPaper();
    (p2.questions[0] as { options: Array<{ key: string; text: string }> }).options = [
      { key: 'A', text: 'a' },
      { key: 'B', text: 'b' },
      { key: 'C', text: 'c' },
    ];
    const r2 = validateExamJson(p2);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.warnings.some((w) => w.includes('questions[0].options'))).toBe(false);
  });
});
