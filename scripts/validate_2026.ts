import { validateExamJson } from '@/lib/importers/examJson';
import { readFileSync } from 'node:fs';

const p = 'public/data/exams/2026.json';
const json = JSON.parse(readFileSync(p, 'utf-8'));
const res = validateExamJson(json, { allowRecalledGaps: true });
console.log('ok:', res.ok);
if (!res.ok) {
  console.log('ERRORS:');
  for (const e of res.errors) console.log('  -', e);
}
console.log('WARNINGS (前 20):');
for (const w of res.warnings.slice(0, 20)) console.log('  -', w);
console.log('warning total:', res.warnings.length);
