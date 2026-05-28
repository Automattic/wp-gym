#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WPGym } from '../src/index.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const command = process.argv[2];

if (command === 'replay-regrade') {
	const result = spawnSync(process.execPath, [path.join(root, 'scripts/replay-regrade.mjs'), ...process.argv.slice(3)], {
		cwd: root,
		stdio: 'inherit',
	});
	process.exit(result.status ?? 1);
} else if (command !== 'demo') {
	console.error('Usage: wp-gym demo [scenario-id] | wp-gym replay-regrade --input <eval-artifact-json-or-dir> [--benchmark-mode]');
	process.exit(2);
}

const scenarioId = process.argv[3] || 'block-markup-no-fallback-pricing-section';

const content = await readFile(
	path.join(root, 'fixtures/reward-hacking/block-markup/no-fallback-pricing-meaningful-content.wp.html'),
	'utf8'
);
const env = await WPGym.make(scenarioId, { root });

try {
	const reset = await env.reset();
	const step = await env.step({
		type: 'wp_cli',
		command: [
			'post create',
			'--post_type=page',
			'--post_status=publish',
			`--post_title=${WPGym.quoteCliValue('Simple Pricing Page')}`,
			`--post_content=${WPGym.quoteCliValue(content)}`,
		].join(' '),
	});
	const grade = await env.grade();
	const trace = await env.trace();

	console.log(JSON.stringify({ reset, step, grade, trace }, null, 2));
} finally {
	await env.close();
}
