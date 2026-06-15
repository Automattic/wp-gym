import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WPGym } from '../src/index.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const taskSetId = valueAfter('--task-set') || 'benchmark-readiness-pilot';
const outputDir = valueAfter('--output-dir');
const localEvidencePattern = /(?:\/Users\/|\/home\/|\/private\/|\/tmp\/|\/var\/folders\/|https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0))/i;

function valueAfter(flag) {
	const index = process.argv.indexOf(flag);
	return index === -1 ? null : process.argv[index + 1];
}

function runStep(id, label, command, args, options = {}) {
	const started = Date.now();
	const result = spawnSync(command, args, {
		cwd: root,
		env: { ...process.env, ...(options.env || {}) },
		encoding: 'utf8',
		maxBuffer: 1024 * 1024 * 50,
	});
	const status = result.status ?? 1;
	const expectedStatuses = options.expectedStatuses || [0];
	const json = parseLastJson(result.stdout || '');

	return {
		id,
		label,
		command: options.displayCommand || [command, ...args].join(' '),
		status,
		ok: expectedStatuses.includes(status),
		duration_ms: Date.now() - started,
		summary: summarizeStepJson(id, json),
	};
}

function parseLastJson(value) {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	for (let index = trimmed.length - 1; index >= 0; index--) {
		if (trimmed[index] !== '{') {
			continue;
		}
		try {
			return JSON.parse(trimmed.slice(index));
		} catch {
			// npm can prefix stdout; keep scanning for the outer object.
		}
	}
	return null;
}

function summarizeStepJson(id, json) {
	if (!json) {
		return {};
	}
	if (id === 'external_consumer') {
		return {
			status: json.status,
			proof: json.proof,
			api_version: json.api_version,
			discovered_scenarios: json.discovered_scenarios,
			discovered_task_sets: json.discovered_task_sets,
			step_observation: json.step_observation,
			trace_steps: json.trace_steps,
			registry_validation: json.registry_validation,
		};
	}
	if (id === 'registry_report') {
		return {
			ok: json.ok,
			rows: json.rows,
		};
	}
	if (id === 'benchmark_ops') {
		return {
			ok: json.ok,
			gap_count: Array.isArray(json.gaps) ? json.gaps.length : null,
		};
	}
	if (id === 'benchmark_promotion') {
		return {
			status: json.status,
			blockers: [...new Set(json.blockers || [])].sort(),
			gate_statuses: Object.fromEntries((json.gates || []).map((gate) => [gate.code, gate.status])),
		};
	}
	return {
		ok: json.ok,
		status: json.status,
	};
}

function markdownTable(rows) {
	return [
		'| Check | Status | Command |',
		'| --- | --- | --- |',
		...rows.map((row) => `| ${row.label} | ${row.ok ? 'pass' : 'fail'} | \`${row.command.replaceAll('|', '\\|')}\` |`),
	].join('\n');
}

function renderMarkdown(report) {
	const blockers = report.known_blockers.length
		? report.known_blockers.map((blocker) => `- ${blocker}`).join('\n')
		: '- None reported by benchmark promotion gates.';

	return `# External Lab Readiness Proof

Issue: https://github.com/Automattic/wp-gym/issues/263

Generated at: ${report.generated_at}
Ref: ${report.git.ref}
Commit: ${report.git.commit}
Task set: \`${report.task_set}\`

## Summary

- Overall status: **${report.ok ? 'pass' : 'fail'}**
- Scenarios discovered: ${report.discovery.scenario_count}
- Task sets discovered: ${report.discovery.task_set_count}
- API version: \`${report.discovery.api_version}\`
- Local-only evidence links in report: ${report.local_only_evidence_found ? 'found' : 'none'}
- Benchmark promotion status: **${report.benchmark_promotion.status}**

## Checks

${markdownTable(report.steps)}

## Known Benchmark Blockers

${blockers}

## Reviewer Runbook

1. Run \`npm run external-lab:proof -- --output-dir artifacts/external-lab-readiness-proof\` from \`main\` or the candidate branch.
2. Attach \`artifacts/external-lab-readiness-proof/report.md\` and \`report.json\` to issue #263 or the closing PR.
3. If a fresh live run is part of the proof package, download \`wp-gym-run-registry-<run-id>\`, then rerun \`npm run run-registry:report -- --registry <download>/entries --regrade --json <download>/report.json --markdown <download>/report.md --scope pilot\`.
4. Treat the promotion gate failure as expected until the listed blockers are closed.
`;
}

function git(args) {
	const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
	return result.status === 0 ? result.stdout.trim() : 'unknown';
}

const scenarios = await WPGym.listScenarios({ root });
const taskSets = await WPGym.listTaskSets({ root });
const taskSet = await WPGym.describeTaskSet(taskSetId, { root });
const api = WPGym.api();

const steps = [
	runStep('matrix_discovery', 'Task matrix discovery', process.execPath, ['scripts/resolve-live-run-matrix.mjs', '--check'], {
		displayCommand: 'TASK_SET=benchmark-readiness-pilot node scripts/resolve-live-run-matrix.mjs --check',
		env: { TASK_SET: taskSetId },
	}),
	runStep('matrix_benchmark_mode', 'Benchmark-mode matrix discovery', process.execPath, ['scripts/resolve-live-run-matrix.mjs', '--check'], {
		displayCommand: 'BENCHMARK_MODE=1 TASK_SET=benchmark-readiness-pilot node scripts/resolve-live-run-matrix.mjs --check',
		env: { TASK_SET: taskSetId, BENCHMARK_MODE: '1' },
		expectedStatuses: [0, 1],
	}),
	runStep('local_api', 'Local API proof', 'npm', ['run', 'local-env:validate']),
	runStep('external_consumer', 'External consumer proof', 'npm', ['run', 'external-consumer:test']),
	runStep('registry_emission', 'Registry emission fixture', 'npm', ['run', 'run-registry:emit:test']),
	runStep('registry_validation', 'Registry validation and provenance', 'npm', ['run', 'run-registry:validate']),
	runStep('registry_report', 'Registry report regeneration', 'npm', ['run', 'run-registry:report:test']),
	runStep('replay_regrade', 'Replay/regrade fixtures', 'npm', ['run', 'replay-regrade:test']),
	runStep('artifact_retention', 'Artifact retention proof', 'npm', ['run', 'artifact-retention:test']),
	runStep('benchmark_ops', 'Benchmark operations contract', 'npm', ['run', 'benchmark-ops:validate']),
	runStep('benchmark_promotion', 'Benchmark promotion blockers', 'npm', ['run', 'benchmark-promotion:report', '--', '--task-set', taskSetId, '--check'], { expectedStatuses: [0, 1] }),
];

const promotion = steps.find((step) => step.id === 'benchmark_promotion');
const knownBlockers = promotion?.summary?.blockers || [];
const report = {
	schema_version: 1,
	generated_by: 'wp-gym external-lab-readiness-proof',
	generated_at: new Date().toISOString(),
	issue: 'https://github.com/Automattic/wp-gym/issues/263',
	task_set: taskSetId,
	git: {
		ref: git(['rev-parse', '--abbrev-ref', 'HEAD']),
		commit: git(['rev-parse', 'HEAD']),
		status: git(['status', '--short']),
	},
	discovery: {
		api_version: api.api_version,
		scenario_count: scenarios.length,
		task_set_count: taskSets.length,
		task_set_scenarios: taskSet.tasks.map((task) => task.scenario_id),
	},
	steps,
	benchmark_promotion: {
		status: promotion?.summary?.status || (promotion?.status === 0 ? 'pass' : 'fail'),
		check_exit_status: promotion?.status,
	},
	known_blockers: knownBlockers,
};

report.local_only_evidence_found = localEvidencePattern.test(JSON.stringify(report));
report.ok = steps.every((step) => step.ok) && !report.local_only_evidence_found;

const markdown = renderMarkdown(report);
if (outputDir) {
	fs.mkdirSync(path.join(root, outputDir), { recursive: true });
	fs.writeFileSync(path.join(root, outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
	fs.writeFileSync(path.join(root, outputDir, 'report.md'), `${markdown}\n`);
}

console.log(JSON.stringify(report, null, 2));

if (!report.ok) {
	process.exit(1);
}
