#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WPGym } from '../src/index.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const command = process.argv[2];

function printJson(value) {
	console.log(JSON.stringify(value, null, 2));
}

function usage() {
	console.error([
		'Usage:',
		'  wp-gym list scenarios',
		'  wp-gym list task-sets',
		'  wp-gym api',
		'  wp-gym show scenario <scenario-id>',
		'  wp-gym show task-set <task-set-id>',
		'  wp-gym capabilities <scenario-id>',
		'  wp-gym demo [scenario-id]',
		'  wp-gym replay <eval-artifact-json-dir-or-zip> --regrade',
		'  wp-gym replay-regrade --input <eval-artifact-json-or-dir> [--benchmark-mode]',
		'  wp-gym benchmark-promotion report --scenario <id>|--task-set <id> [--format json|markdown] [--check]',
		'  wp-gym benchmark-release generate|validate [--task-set <id>] [--input <path>] [--output <path>]',
		'  wp-gym run-registry emit|report|validate [--regrade] [args...]',
		'  wp-gym remote-archive triage --input <cycle-dir-or-tar> [args...]',
	].join('\n'));
}

if (command === 'replay') {
	const input = process.argv[3];
	if (!input || !process.argv.slice(4).includes('--regrade')) {
		console.error('Usage: wp-gym replay <eval-artifact-json-dir-or-zip> --regrade');
		process.exit(2);
	}
	const result = spawnSync(process.execPath, [path.join(root, 'scripts/replay-regrade.mjs'), '--input', input, ...process.argv.slice(4)], {
		cwd: root,
		stdio: 'inherit',
	});
	process.exit(result.status ?? 1);

} else if (command === 'replay-regrade') {
	const result = spawnSync(process.execPath, [path.join(root, 'scripts/replay-regrade.mjs'), ...process.argv.slice(3)], {
		cwd: root,
		stdio: 'inherit',
	});
	process.exit(result.status ?? 1);

} else if (command === 'benchmark-promotion') {
	const subcommand = process.argv[3];
	if (subcommand !== 'report') {
		console.error('Usage: wp-gym benchmark-promotion report --scenario <id>|--task-set <id> [--format json|markdown] [--check]');
		process.exit(2);
	}
	const result = spawnSync(process.execPath, [path.join(root, 'scripts/benchmark-promotion.mjs'), ...process.argv.slice(4)], {
		cwd: root,
		stdio: 'inherit',
	});
	process.exit(result.status ?? 1);

} else if (command === 'benchmark-release') {
	const subcommand = process.argv[3];
	if (!['generate', 'validate'].includes(subcommand)) {
		console.error('Usage: wp-gym benchmark-release generate|validate [--task-set <id>] [--input <path>] [--output <path>]');
		process.exit(2);
	}
	const result = spawnSync(process.execPath, [path.join(root, 'scripts/benchmark-release.mjs'), subcommand, ...process.argv.slice(4)], {
		cwd: root,
		stdio: 'inherit',
	});
	process.exit(result.status ?? 1);

} else if (command === 'api') {
	printJson(WPGym.api());
	process.exit(0);

} else if (command === 'list') {
	const target = process.argv[3];
	if (target === 'scenarios') {
		printJson(await WPGym.listScenarios({ root }));
	} else if (target === 'task-sets') {
		printJson(await WPGym.listTaskSets({ root }));
	} else {
		usage();
		process.exit(2);
	}
	process.exit(0);

} else if (command === 'show') {
	const target = process.argv[3];
	const id = process.argv[4];
	if (!id) {
		usage();
		process.exit(2);
	}
	if (target === 'scenario') {
		printJson(await WPGym.describeScenario(id, { root }));
	} else if (target === 'task-set') {
		printJson(await WPGym.describeTaskSet(id, { root }));
	} else {
		usage();
		process.exit(2);
	}
	process.exit(0);

} else if (command === 'capabilities') {
	const scenarioId = process.argv[3];
	if (!scenarioId) {
		usage();
		process.exit(2);
	}
	printJson(await WPGym.capabilities(scenarioId, { root }));
	process.exit(0);

} else if (command === 'run-registry') {
	const subcommand = process.argv[3];
	const script = subcommand === 'emit'
		? 'emit-run-registry.mjs'
		: subcommand === 'report'
			? 'aggregate-run-registry.mjs'
			: subcommand === 'validate'
				? 'validate-run-registry.mjs'
				: '';
	if (!script) {
		console.error('Usage: wp-gym run-registry emit|report|validate [args...]');
		process.exit(2);
	}
	const result = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...process.argv.slice(4)], {
		cwd: root,
		stdio: 'inherit',
	});
	process.exit(result.status ?? 1);

} else if (command === 'remote-archive') {
	const subcommand = process.argv[3];
	if (subcommand !== 'triage') {
		console.error('Usage: wp-gym remote-archive triage --input <cycle-dir-or-tar> [args...]');
		process.exit(2);
	}
	const result = spawnSync(process.execPath, [path.join(root, 'scripts/triage-remote-archive.mjs'), ...process.argv.slice(4)], {
		cwd: root,
		stdio: 'inherit',
	});
	process.exit(result.status ?? 1);
} else if (command !== 'demo') {
	usage();
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
