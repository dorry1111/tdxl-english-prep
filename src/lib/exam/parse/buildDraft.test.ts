import { describe, expect, it } from 'vitest';
import { buildDraft, parsePastedPaper, validateDraft } from './buildDraft';
import { PAPER_2013_TEXT, PAPER_2013_META } from '@/test/fixtures/paperText';

/** 与官方结构（3.4.1）对齐的区段题量 */
const OFFICIAL_COUNTS: Record<string, number> = {
  dialogue: 10,
  vocabulary: 10,
  reading: 25,
  cloze: 10,
  'short-completion': 20,
  translation: 1,
  writing: 1,
};

describe('buildDraft · 77 题整卷 fixture（2013 真题）', () => {
  const { draft, validation, normalizeReport } = parsePastedPaper(PAPER_2013_TEXT);

  it('区段识别 7/7，各区段题量为 10/10/25/10/20/1/1', () => {
    expect(draft.sections.map((s) => s.type)).toEqual([
      'dialogue',
      'vocabulary',
      'reading',
      'cloze',
      'short-completion',
      'translation',
      'writing',
    ]);
    for (const s of draft.sections) {
      expect(s.questionCount, `区段 ${s.type}`).toBe(OFFICIAL_COUNTS[s.type]);
    }
  });

  it('totalQuestions = 77，Σ section.score = 100，无硬错误', () => {
    expect(draft.questions).toHaveLength(77);
    expect(draft.sections.reduce((s, x) => s + x.score, 0)).toBe(100);
    expect(validation.errors).toEqual([]);
  });

  it('识别率 100%：75 道客观题答案与选项齐全，2 道主观题有参考答案', () => {
    const objective = draft.questions.filter((q) => q.isObjective);
    const subjective = draft.questions.filter((q) => !q.isObjective);
    expect(objective).toHaveLength(75);
    expect(subjective.map((q) => q.sectionType)).toEqual(['translation', 'writing']);
    for (const q of objective) {
      expect(q.answerKey, `seq=${q.seq} 缺答案`).toBeTruthy();
      expect(q.options.length, `seq=${q.seq} 缺选项`).toBeGreaterThanOrEqual(3);
      expect(q.options.some((o) => o.key === q.answerKey), `seq=${q.seq} 答案不在选项内`).toBe(true);
      expect(q.stem.length, `seq=${q.seq} 缺题干`).toBeGreaterThan(0);
    }
    for (const q of subjective) {
      expect(q.referenceAnswer?.length ?? 0, `seq=${q.seq} 缺参考答案`).toBeGreaterThan(20);
    }
  });

  it('文章归属：阅读 5 篇 / 短文完成 3 篇，题干挂 passageId', () => {
    const reading = draft.sections.find((s) => s.type === 'reading');
    expect(reading?.passageIds.length).toBe(5);
    const short = draft.sections.find((s) => s.type === 'short-completion');
    expect(short?.passageIds.length).toBe(3);
    const readingQ = draft.questions.find((q) => q.seq === 21);
    expect(readingQ?.passageId).toBeTruthy();
    expect(draft.passages.find((p) => p.id === readingQ?.passageId)?.content.length).toBeGreaterThan(100);
  });

  it('无一行被静默丢弃：fixture 解析 unresolved 为空', () => {
    expect(draft.unresolved).toEqual([]);
    expect(validation.warnings).toEqual([]);
  });

  it('幂等：同一文本连续解析 3 次，输出深度相等', () => {
    const a = JSON.stringify(parsePastedPaper(PAPER_2013_TEXT).draft);
    const b = JSON.stringify(parsePastedPaper(PAPER_2013_TEXT).draft);
    const c = JSON.stringify(parsePastedPaper(PAPER_2013_TEXT).draft);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('性能：77 题解析 < 150ms', () => {
    const t0 = performance.now();
    buildDraft(PAPER_2013_TEXT);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(150);
  });

  it('规范化统计来自真实输入（fixture 含全角字符与页码行）', () => {
    expect(normalizeReport.fullWidthConverted).toBeGreaterThan(0);
  });
});

describe('buildDraft · 容错与校验', () => {
  it('未识别行进入 unresolved，不静默丢弃', () => {
    const text = [
      '口语交际',
      '1. hello',
      'A. hi B. yo C. hey',
      '【答案】A',
      '完全无法归类的一行孤文',
    ].join('\n');
    const { draft, validation } = parsePastedPaper(text);
    expect(draft.unresolved.length).toBeGreaterThanOrEqual(1);
    expect(draft.unresolved.some((u) => u.text.includes('完全无法归类'))).toBe(true);
    expect(validation.warnings.some((w) => w.includes('未识别内容'))).toBe(true);
  });

  it('客观题答案不在选项内 → questions[i].answerKey 错误', () => {
    const text = [
      '词汇',
      '1. stem text here',
      'A. one',
      'B. two',
      'C. three',
      '【答案】D',
    ].join('\n');
    const draft = buildDraft(text);
    const validation = validateDraft(draft);
    expect(validation.errors.some((e) => e.includes('questions[0].answerKey'))).toBe(true);
  });

  it('序号不连续 → questions[i].seq 错误', () => {
    const text = [
      '词汇',
      '1. a stem',
      'A. x B. y C. z',
      '【答案】A',
      '3. another stem',
      'A. x B. y C. z',
      '【答案】B',
    ].join('\n');
    const draft = buildDraft(text);
    const validation = validateDraft(draft);
    expect(validation.errors.some((e) => e.includes('.seq 序号不连续'))).toBe(true);
  });

  it('非官方结构（77 题 / 100 分不符）→ warnings 而非静默通过', () => {
    const text = ['词汇', '1. a stem', 'A. x B. y C. z', '【答案】A'].join('\n');
    const draft = buildDraft(text);
    const validation = validateDraft(draft);
    expect(validation.warnings.some((w) => w.includes('总题数'))).toBe(true);
    expect(validation.warnings.some((w) => w.includes('总分') || w.includes('分值合计'))).toBe(true);
  });

  it('fixture 元数据与解析结果一致（防 fixture 漂移）', () => {
    const draft = buildDraft(PAPER_2013_TEXT);
    expect(PAPER_2013_META.totalQuestions).toBe(draft.questions.length);
    expect(PAPER_2013_META.sectionCounts).toEqual(
      Object.fromEntries(draft.sections.map((s) => [s.type, s.questionCount])),
    );
  });
});
