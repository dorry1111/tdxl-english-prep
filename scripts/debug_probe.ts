/** 调试探针：查看某年各区段提取结果与缺失题号。用法：npx vite-node scripts/debug_probe.ts 2013 */
import { buildYear, cutSections, loadYearText, splitInlineNumbers } from './build_exams';

const year = Number(process.argv[2] ?? 2013);
const paper = buildYear(year);
const bySection = new Map<string, number[]>();
for (const q of paper.questions) {
  const arr = bySection.get(q.sectionType) ?? [];
  arr.push(q.seq);
  bySection.set(q.sectionType, arr);
}
console.log('区段数:', paper.stats.identifiedSections);
for (const [type, seqs] of bySection) {
  const sorted = [...seqs].sort((a, b) => a - b);
  const missing: number[] = [];
  for (let n = (sorted[0] ?? 0); n <= (sorted[sorted.length - 1] ?? 0); n += 1) {
    if (!sorted.includes(n)) missing.push(n);
  }
  console.log(`${type}: ${seqs.length} 题 [${sorted.join(',')}] 缺失:${missing.join(',') || '无'}`);
  const noOpt = paper.questions.filter((q) => q.sectionType === type && q.options.length === 0);
  if (noOpt.length) console.log(`  无选项题: ${noOpt.map((q) => q.seq).join(',')}`);
  const badStem = paper.questions.filter((q) => q.sectionType === type && !q.stem);
  if (badStem.length) console.log(`  空题干: ${badStem.map((q) => q.seq).join(',')}`);
}
console.log(
  'passages:',
  paper.passages.map((p) => `${p.id}(${p.sectionType},${p.content.length}字)`).join(' '),
);

// 区段切分明细
const examText = loadYearText(year, 'exam');
const spans = cutSections(examText.split('\n'));
console.log(
  'cutSections:',
  spans.map((s) => `${s.type}@${s.titleLineNo}(${s.lines.length}行)`).join(' '),
);

// 抽样行
if (process.argv[3] === 'lines') {
  const target = Number(process.argv[4] ?? 0);
  const span = spans[target];
  if (span) {
    for (const l of span.lines.slice(0, 400)) {
      if (l.trim()) console.log(`  | ${l.slice(0, 120)}`);
    }
  }
}
void splitInlineNumbers;
