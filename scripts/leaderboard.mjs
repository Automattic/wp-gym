#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error('Usage: leaderboard.mjs <results.jsonl> <leaderboard.md>');
  process.exit(1);
}

const text = await readFile(inputPath, 'utf8');
const rows = text
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .sort((left, right) => (right.reward ?? -1) - (left.reward ?? -1));

const lines = [
  '# wp-rl Leaderboard',
  '',
  '| Rank | Task | Success | Score | Grade | p95 ms |',
  '| ---: | --- | --- | ---: | ---: | ---: |',
];

rows.forEach((row, index) => {
  const grade = row.grade_score === null || row.grade_max_score === null
    ? ''
    : `${row.grade_score}/${row.grade_max_score}`;
  lines.push(`| ${index + 1} | ${row.task_id} | ${row.success === true ? 'yes' : 'no'} | ${row.reward ?? ''} | ${grade} | ${row.p95_ms ?? ''} |`);
});

if (rows.length === 0) {
  lines.push('|  | No scenarios |  |  |  |  |');
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${lines.join('\n')}\n`);
console.log(`wrote leaderboard to ${outputPath}`);
