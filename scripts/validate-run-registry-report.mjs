import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function run(command, args) {
	const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
	}
	return result.stdout;
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function writeEntry(dir, base, options) {
	const entry = structuredClone(base);
	entry.run.id = `large-n-report-${options.tier}-${options.index}`;
	entry.run.attempt_id = `large-n-report-${options.tier}-attempt-${String(options.index).padStart(3, '0')}`;
	entry.run.attempt = options.index;
	entry.run.attempt_count = options.attemptCount;
	entry.run.result_set_id = `large-n-report-${options.tier}`;
	entry.run.outcome = options.passed ? 'passed' : 'failed';
	entry.runner.provider = options.provider;
	entry.runner.model = options.model;
	entry.scenario.id = options.scenario;
	entry.scenario.task_family = options.taskFamily;
	entry.grade_identity.success = options.passed;
	entry.grade_identity.reward = options.passed ? 1 : 0;
	entry.grade_identity.failure_class = options.passed ? 'none' : options.failureClass;
	if (options.failureClass === 'runtime_failure') {
		entry.operations.retry.disposition = 'exhausted';
	} else if (options.failureClass === 'task_failure') {
		entry.operations.retry.disposition = 'task_terminal';
	}
	entry.calibration.row_type = options.rowType;
	entry.calibration.model_tier = options.tier;
	entry.calibration.result_set_id = `large-n-report-${options.tier}`;
	entry.provenance.provider.provider = options.provider;
	entry.provenance.provider.model = options.model;
	fs.writeFileSync(path.join(dir, `${entry.run.id}.json`), `${JSON.stringify(entry, null, 2)}\n`);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-gym-run-registry-report-'));

try {
	const entriesDir = path.join(temp, 'entries');
	const reportJson = path.join(temp, 'report.json');
	const reportMarkdown = path.join(temp, 'report.md');
	fs.mkdirSync(entriesDir, { recursive: true });

	const base = readJson(path.join(root, 'fixtures/run-registry/valid-canonical-eval-artifact.json'));
	const rows = [
		{ tier: 'cheap_model', rowType: 'cheap_model', provider: 'openai', model: 'gpt-5.4-mini', passed: true, failureClass: 'none' },
		{ tier: 'cheap_model', rowType: 'cheap_model', provider: 'openai', model: 'gpt-5.4-mini', passed: false, failureClass: 'agent_failure' },
		{ tier: 'cheap_model', rowType: 'cheap_model', provider: 'openai', model: 'gpt-5.4-mini', passed: false, failureClass: 'runtime_failure' },
		{ tier: 'frontier_model', rowType: 'repeated_attempts', provider: 'openai', model: 'gpt-5.5', passed: true, failureClass: 'none' },
		{ tier: 'frontier_model', rowType: 'repeated_attempts', provider: 'openai', model: 'gpt-5.5', passed: true, failureClass: 'none' },
		{ tier: 'frontier_model', rowType: 'repeated_attempts', provider: 'openai', model: 'gpt-5.5', passed: false, failureClass: 'agent_failure' },
		{ tier: 'no_op', rowType: 'no_op', provider: 'none', model: 'no-op', passed: false, failureClass: 'task_failure' },
		{ tier: 'no_op', rowType: 'no_op', provider: 'none', model: 'no-op', passed: false, failureClass: 'task_failure' },
	];

	const tierIndexes = new Map();
	for (const row of rows) {
		const tierIndex = (tierIndexes.get(row.tier) || 0) + 1;
		tierIndexes.set(row.tier, tierIndex);
		writeEntry(entriesDir, base, {
			...row,
			index: tierIndex,
			attemptCount: rows.filter((candidate) => candidate.tier === row.tier).length,
			scenario: 'block-markup-valid-semantic-blocks',
			taskFamily: 'block-markup',
		});
	}

	run('node', [
		'scripts/aggregate-run-registry.mjs',
		'--registry', entriesDir,
		'--scope', 'all',
		'--json', reportJson,
		'--markdown', reportMarkdown,
		'--large-n-min-attempts', '3',
	]);

	const report = readJson(reportJson);
	const markdown = fs.readFileSync(reportMarkdown, 'utf8');
	assert(report.large_n_calibration.min_attempts_per_model_tier === 3, 'Expected configured large-N minimum in JSON report.');
	assert(report.large_n_calibration.benchmark_ready_threshold_met === false, 'Expected no-op tier to keep large-N threshold unmet.');
	assert(report.large_n_calibration.by_model_tier.cheap_model.row_count === 3, 'Expected cheap-model row count.');
	assert(report.large_n_calibration.by_model_tier.cheap_model.threshold_met === true, 'Expected cheap-model tier to meet threshold.');
	assert(report.large_n_calibration.by_model_tier.no_op.threshold_met === false, 'Expected no-op tier to miss threshold.');
	assert(report.large_n_calibration.by_model_tier.cheap_model.failure_classes.agent_failure === 1, 'Expected cheap-model failure-class count.');
	assert(report.large_n_calibration.by_task_model_tier['block-markup-valid-semantic-blocks:frontier_model'].row_count === 3, 'Expected task/model-tier distribution.');
	assert(markdown.includes('## Large-N Calibration'), 'Expected Markdown large-N section.');
	assert(markdown.includes('Failure classes'), 'Expected Markdown failure-class column.');
	assert(markdown.includes('agent_failure: 1'), 'Expected Markdown failure-class counts.');

	console.log(JSON.stringify({ ok: true, rows: rows.length, report: reportJson }, null, 2));
} finally {
	fs.rmSync(temp, { recursive: true, force: true });
}
