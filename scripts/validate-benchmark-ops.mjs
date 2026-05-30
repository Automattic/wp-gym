import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(file) {
	return fs.readFileSync(path.join(root, file), 'utf8');
}

function gap(code, severity, file, message) {
	return { code, severity, file, message };
}

function workflowBlocks(yaml) {
	const lines = yaml.split('\n');
	const blocks = [];
	for (const [index, line] of lines.entries()) {
		if (!line.includes('actions/upload-artifact@v4')) {
			continue;
		}
		blocks.push(lines.slice(index, index + 24).join('\n'));
	}
	return blocks;
}

function artifactUploadHas(block, pattern) {
	return pattern.test(block);
}

function validateWorkflowRetention(file, expectations) {
	const yaml = read(file);
	const blocks = workflowBlocks(yaml);
	const gaps = [];

	for (const expectation of expectations) {
		const block = blocks.find((candidate) => artifactUploadHas(candidate, expectation.name));
		if (!block) {
			gaps.push(gap('missing_artifact_upload', 'error', file, `Missing upload-artifact block for ${expectation.label}.`));
			continue;
		}
		if (!new RegExp(`retention-days:\\s*${expectation.retentionDays}\\b`).test(block)) {
			gaps.push(gap('missing_artifact_retention_days', 'error', file, `${expectation.label} must set retention-days: ${expectation.retentionDays}.`));
		}
		for (const requiredPath of expectation.paths || []) {
			if (!block.includes(requiredPath)) {
				gaps.push(gap('missing_artifact_payload_path', 'error', file, `${expectation.label} upload must include ${requiredPath}.`));
			}
		}
		if (!/if-no-files-found:\s*error\b/.test(block) && expectation.requireFiles !== false) {
			gaps.push(gap('artifact_upload_not_fail_closed', 'error', file, `${expectation.label} upload must use if-no-files-found: error.`));
		}
	}

	return gaps;
}

function validateOpsWorkflow() {
	const file = '.github/workflows/benchmark-artifact-ops.yml';
	const yaml = read(file);
	const gaps = [];
	for (const required of ['pull_request:', 'workflow_dispatch:', 'schedule:', 'npm run benchmark-ops:validate', 'npm run run-registry:emit:test', 'npm run run-registry:validate', 'npm run remote-archive:test']) {
		if (!yaml.includes(required)) {
			gaps.push(gap('missing_ops_workflow_check', 'error', file, `Ops workflow must include ${required}.`));
		}
	}
	if (!yaml.includes('npm run stability-budget:test')) {
		gaps.push(gap('missing_stability_budget_check', 'error', file, 'Ops workflow must include stability budget fixture validation.'));
	}
	return gaps;
}

function validateOpsDocs() {
	const file = 'docs/benchmark-operations.md';
	const doc = read(file);
	const gaps = [];
	for (const required of [
		'https://github.com/Automattic/wp-gym/issues/244',
		'wp-gym-run-registry',
		'retention-days',
		'Registry reports can be regenerated',
		'Durable Shared Evidence',
		'local-only paths',
		'https://github.com/Automattic/wp-gym/issues/262',
		'Stability Budget',
		'infra/provider/artifact/runner/task/grader',
		'npm run stability-budget:report',
	]) {
		if (!doc.includes(required)) {
			gaps.push(gap('missing_ops_doc_section', 'error', file, `Benchmark operations docs must mention ${required}.`));
		}
	}
	return gaps;
}

function validateBenchmarkOps() {
	const gaps = [
		...validateWorkflowRetention('.github/workflows/datamachine-live-run.yml', [
			{
				label: 'live run registry artifact',
				name: /name:\s*wp-gym-run-registry-/,
				retentionDays: 90,
				paths: [
					'artifacts/wp-gym-run-registry',
					'artifacts/live-replay-bundles',
				],
			},
		]),
		...validateWorkflowRetention('.github/workflows/playground-smoke.yml', [
			{
				label: 'smoke task artifact',
				name: /name:\s*wp-gym-smoke-task/,
				retentionDays: 30,
				requireFiles: false,
				paths: [
					'homeboy-ci-results/bench.json',
					'homeboy-ci-results/results.jsonl',
					'homeboy-ci-results/leaderboard.md',
				],
			},
		]),
		...validateOpsWorkflow(),
		...validateOpsDocs(),
	];

	return {
		ok: !gaps.some((item) => item.severity === 'error'),
		gaps,
	};
}

const report = validateBenchmarkOps();
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
	process.exit(1);
}

export { validateBenchmarkOps };
