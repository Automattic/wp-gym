#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error('Usage: bench-to-jsonl.mjs <bench-results.json> <output.jsonl>');
  process.exit(1);
}

const raw = JSON.parse(await readFile(inputPath, 'utf8'));
const results = raw.data?.results || (raw.data?.scenarios ? raw.data : raw);
const componentId = results.component_id || results.component || 'wp-rl';
const scenarios = Array.isArray(results.scenarios) ? results.scenarios : [];

const rows = scenarios
  .filter((scenario) => scenario.id && scenario.id !== '__bootstrap')
  .map((scenario) => {
    const metrics = scenario.metrics || {};
    const metadata = scenario.metadata || {};
    return {
      component_id: componentId,
      task_id: metadata.task_id || scenario.id,
      source: scenario.source || 'unknown',
      iterations: scenario.iterations || results.iterations || 0,
      success: metadata.success ?? (metrics.success_mean === undefined ? null : metrics.success_mean >= 1),
      reward: metadata.reward ?? metrics.reward_mean ?? null,
      grade_score: metadata.grade?.score ?? metrics.grade_score_mean ?? null,
      grade_max_score: metadata.grade?.max_score ?? metrics.grade_max_score_mean ?? null,
      p50_ms: metrics.p50_ms ?? null,
      p95_ms: metrics.p95_ms ?? null,
      grade: metadata.grade || null,
      artifacts: scenario.artifacts || {},
    };
  });

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
console.log(`wrote ${rows.length} JSONL row(s) to ${outputPath}`);
