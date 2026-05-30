import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const failureClasses = ['infra', 'provider', 'artifact', 'runner', 'task', 'grader'];
const defaultBudgets = {
	workflow: {
		'datamachine-live-run': { total: 0.05, infra: 0.02, provider: 0.03, artifact: 0.01, runner: 0.02, task: 0.02, grader: 0.01 },
		'benchmark-artifact-ops': { total: 0.02, infra: 0.01, provider: 0, artifact: 0.01, runner: 0.01, task: 0, grader: 0 },
		'playground-smoke': { total: 0.08, infra: 0.03, provider: 0.03, artifact: 0.02, runner: 0.03, task: 0.03, grader: 0.01 },
		default: { total: 0.05, infra: 0.02, provider: 0.03, artifact: 0.01, runner: 0.02, task: 0.02, grader: 0.01 },
	},
	task_family: {
		'block-markup': { total: 0.05, infra: 0.02, provider: 0.03, artifact: 0.01, runner: 0.02, task: 0.02, grader: 0.01 },
		'wordpress-api': { total: 0.07, infra: 0.02, provider: 0.03, artifact: 0.01, runner: 0.03, task: 0.03, grader: 0.01 },
		default: { total: 0.05, infra: 0.02, provider: 0.03, artifact: 0.01, runner: 0.02, task: 0.02, grader: 0.01 },
	},
};

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeFile(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, value);
}

function collectJsonFiles(input) {
	const resolved = path.resolve(input);
	const stat = fs.statSync(resolved);
	if (stat.isFile()) {
		return [resolved];
	}
	const files = [];
	for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
		const entryPath = path.join(resolved, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectJsonFiles(entryPath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(entryPath);
		}
	}
	return files.sort();
}

function repoRelative(file) {
	return path.relative(root, file).replace(/\\/g, '/');
}

function completedAt(row) {
	return row.run?.completed_at || row.completed_at || row.stability?.completed_at || '';
}

function runSucceeded(row) {
	return row.run?.outcome === 'passed' || row.grade_identity?.success === true || row.success === true || row.outcome === 'passed';
}

function normalizeFailureClass(value) {
	const normalized = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
	const aliases = {
		none: 'none',
		infra: 'infra',
		infrastructure: 'infra',
		infrastructure_failure: 'infra',
		provider: 'provider',
		provider_failure: 'provider',
		model_provider: 'provider',
		artifact: 'artifact',
		artifact_failure: 'artifact',
		artifact_upload_failure: 'artifact',
		artifact_download_failure: 'artifact',
		runner: 'runner',
		runner_failure: 'runner',
		runtime_failure: 'runner',
		task: 'task',
		task_failure: 'task',
		agent_failure: 'task',
		grader: 'grader',
		grader_failure: 'grader',
	};
	return aliases[normalized] || '';
}

function textForClassification(row) {
	return [
		row.stability?.message,
		row.stability?.error,
		row.error,
		row.message,
		row.run?.error,
		row.grade_identity?.failure_reason,
		...(row.grade_identity?.failure_reasons || []),
		...(row.benchmark?.exclusion_reasons || []),
	].filter(Boolean).join(' ').toLowerCase();
}

function classifyStabilityFailure(row) {
	if (runSucceeded(row)) {
		return { failure_class: 'none', flaky: false, source: 'outcome' };
	}

	const explicit = normalizeFailureClass(row.stability?.failure_class || row.operations?.failure_class || row.failure_class || row.grade_identity?.failure_class);
	if (explicit && explicit !== 'none') {
		return { failure_class: explicit, flaky: Boolean(row.stability?.flaky), source: 'explicit' };
	}

	const text = textForClassification(row);
	const patterns = [
		['artifact', /upload-artifact|download-artifact|artifact (upload|download)|missing artifact|if-no-files-found/],
		['provider', /429|rate limit|quota|provider|model timeout|api timeout|overloaded|temporarily unavailable/],
		['infra', /github runner|hosted runner|network|dns|checkout|apt|docker pull|no space left|disk|runner image/],
		['runner', /homeboy|wp-codebox|opencode|runner crashed|process exited|orchestrator|workflow command/],
		['grader', /grader|assertion|expected reward|schema mismatch|grade failed/],
		['task', /scenario|task setup|wordpress fatal|application error|fixture mismatch|prompt contract/],
	];
	for (const [failureClass, pattern] of patterns) {
		if (pattern.test(text)) {
			return { failure_class: failureClass, flaky: Boolean(row.stability?.flaky), source: 'message' };
		}
	}
	return { failure_class: 'runner', flaky: Boolean(row.stability?.flaky), source: 'fallback' };
}

function workflowKey(row) {
	return row.stability?.workflow || row.provenance?.workflow?.name || row.provenance?.workflow?.path?.split('/').pop()?.replace(/\.ya?ml$/, '') || row.runner?.workflow || 'unknown';
}

function taskFamily(row) {
	return row.scenario?.task_family || row.stability?.task_family || 'unknown';
}

function operationKey(row) {
	return [workflowKey(row), taskFamily(row), row.scenario?.id || row.stability?.scenario || 'unknown', row.runner?.provider || 'unknown', row.runner?.model || 'unknown'].join('|');
}

function emptySummary(key) {
	return { key, runs: 0, passed: 0, failures: 0, failure_rates: { total: 0 }, failure_counts: Object.fromEntries(failureClasses.map((item) => [item, 0])), budget: {}, over_budget: [], flaky_operations: [] };
}

function addRow(summary, row) {
	const classification = classifyStabilityFailure(row);
	summary.runs += 1;
	if (classification.failure_class === 'none') {
		summary.passed += 1;
	} else {
		summary.failures += 1;
		summary.failure_counts[classification.failure_class] = (summary.failure_counts[classification.failure_class] || 0) + 1;
	}
}

function resolveBudget(budgets, group, key) {
	return budgets[group]?.[key] || budgets[group]?.default || defaultBudgets[group].default;
}

function finalizeSummary(summary, budget) {
	summary.failure_rates.total = summary.runs > 0 ? Number((summary.failures / summary.runs).toFixed(4)) : 0;
	for (const failureClass of failureClasses) {
		summary.failure_rates[failureClass] = summary.runs > 0 ? Number(((summary.failure_counts[failureClass] || 0) / summary.runs).toFixed(4)) : 0;
	}
	summary.budget = budget;
	summary.over_budget = ['total', ...failureClasses].filter((key) => summary.failure_rates[key] > (budget[key] ?? 0));
	return summary;
}

function summarizeBy(rows, keyFn, group, budgets) {
	const summaries = new Map();
	for (const row of rows) {
		const key = keyFn(row);
		if (!summaries.has(key)) {
			summaries.set(key, emptySummary(key));
		}
		addRow(summaries.get(key), row);
	}
	return Object.fromEntries([...summaries.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, summary]) => [key, finalizeSummary(summary, resolveBudget(budgets, group, key))]));
}

function applyWindow(rows, options) {
	let windowed = [...rows].sort((left, right) => completedAt(left).localeCompare(completedAt(right)));
	if (options.windowDays) {
		const newest = windowed.map(completedAt).filter(Boolean).at(-1);
		if (newest) {
			const cutoff = new Date(new Date(newest).getTime() - (options.windowDays * 24 * 60 * 60 * 1000));
			windowed = windowed.filter((row) => !completedAt(row) || new Date(completedAt(row)) >= cutoff);
		}
	}
	if (options.windowRuns && windowed.length > options.windowRuns) {
		windowed = windowed.slice(windowed.length - options.windowRuns);
	}
	return windowed;
}

function detectFlakyOperations(rows) {
	const operations = new Map();
	for (const row of rows) {
		const key = operationKey(row);
		if (!operations.has(key)) {
			operations.set(key, { key, runs: 0, passed: 0, failures: 0, failure_classes: {} });
		}
		const operation = operations.get(key);
		const classification = classifyStabilityFailure(row);
		operation.runs += 1;
		if (classification.failure_class === 'none') {
			operation.passed += 1;
		} else {
			operation.failures += 1;
			operation.failure_classes[classification.failure_class] = (operation.failure_classes[classification.failure_class] || 0) + 1;
		}
	}
	return [...operations.values()].filter((operation) => operation.passed > 0 && operation.failures > 0).sort((left, right) => left.key.localeCompare(right.key));
}

function buildStabilityReport(rows, options = {}) {
	const budgets = options.budgets || defaultBudgets;
	const windowed = applyWindow(rows, { windowRuns: options.windowRuns || 50, windowDays: options.windowDays || 30 });
	const overall = finalizeSummary(windowed.reduce((summary, row) => {
		addRow(summary, row);
		return summary;
	}, emptySummary('overall')), resolveBudget(budgets, 'workflow', 'default'));
	const flakyOperations = detectFlakyOperations(windowed);
	overall.flaky_operations = flakyOperations.map((operation) => operation.key);
	const byWorkflow = summarizeBy(windowed, workflowKey, 'workflow', budgets);
	const byTaskFamily = summarizeBy(windowed, taskFamily, 'task_family', budgets);
	return {
		schema_version: 1,
		report: {
			name: 'wp-gym-stability-budget-report',
			issue: 'https://github.com/Automattic/wp-gym/issues/262',
			created_at: new Date().toISOString(),
			window_runs: options.windowRuns || 50,
			window_days: options.windowDays || 30,
		},
		inputs: { inspected: rows.length, accepted: windowed.length },
		budget_status: [overall, ...Object.values(byWorkflow), ...Object.values(byTaskFamily)].some((summary) => summary.over_budget.length > 0) ? 'fail' : 'pass',
		overall,
		by_workflow: byWorkflow,
		by_task_family: byTaskFamily,
		flaky_operations: flakyOperations,
		rows: windowed.map((row) => ({
			run_id: row.run?.id || row.id || null,
			completed_at: completedAt(row) || null,
			workflow: workflowKey(row),
			task_family: taskFamily(row),
			scenario: row.scenario?.id || row.stability?.scenario || null,
			provider: row.runner?.provider || null,
			model: row.runner?.model || null,
			outcome: row.run?.outcome || row.outcome || null,
			...classifyStabilityFailure(row),
		})),
	};
}

function percent(value) {
	return `${(value * 100).toFixed(1)}%`;
}

function renderTable(headers, rows) {
	return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
}

function renderSummaryMap(map) {
	return Object.values(map).map((summary) => [
		summary.key,
		String(summary.runs),
		percent(summary.failure_rates.total),
		failureClasses.map((key) => `${key}:${percent(summary.failure_rates[key])}`).join(', '),
		summary.over_budget.join(', ') || 'within budget',
	]);
}

function renderMarkdown(report) {
	return `${[
		'# WP Gym Stability Budget Report',
		'',
		`- **Issue:** ${report.report.issue}`,
		`- **Window:** last ${report.inputs.accepted} accepted rows, capped at ${report.report.window_runs} runs / ${report.report.window_days} days`,
		`- **Budget status:** ${report.budget_status}`,
		'',
		'## Overall',
		'',
		renderTable(['Runs', 'Passed', 'Failures', 'Failure rate', 'Over budget', 'Flaky operations'], [[String(report.overall.runs), String(report.overall.passed), String(report.overall.failures), percent(report.overall.failure_rates.total), report.overall.over_budget.join(', ') || 'within budget', String(report.flaky_operations.length)]]),
		'',
		'## Workflow Budgets',
		'',
		renderTable(['Workflow', 'Runs', 'Failure rate', 'Class rates', 'Status'], renderSummaryMap(report.by_workflow)),
		'',
		'## Task Family Budgets',
		'',
		renderTable(['Task family', 'Runs', 'Failure rate', 'Class rates', 'Status'], renderSummaryMap(report.by_task_family)),
		'',
		'## Flaky Operations',
		'',
		report.flaky_operations.length > 0 ? renderTable(['Operation', 'Runs', 'Passed', 'Failures', 'Failure classes'], report.flaky_operations.map((operation) => [operation.key, String(operation.runs), String(operation.passed), String(operation.failures), Object.entries(operation.failure_classes).map(([key, count]) => `${key}:${count}`).join(', ')])) : 'No flaky operations in this window.',
	].join('\n')}\n`;
}

function parseArgs(argv) {
	const args = { registry: '', json: '', markdown: '', windowRuns: 50, windowDays: 30, failOnBudget: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--registry' || arg === '--input') {
			args.registry = argv[++index];
		} else if (arg === '--json') {
			args.json = argv[++index];
		} else if (arg === '--markdown') {
			args.markdown = argv[++index];
		} else if (arg === '--window-runs') {
			args.windowRuns = Number(argv[++index]);
		} else if (arg === '--window-days') {
			args.windowDays = Number(argv[++index]);
		} else if (arg === '--fail-on-budget') {
			args.failOnBudget = true;
		} else if (arg === '--help' || arg === '-h') {
			args.help = true;
		} else if (!args.registry) {
			args.registry = arg;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || !args.registry) {
		console.error('Usage: node scripts/stability-budget.mjs --registry <json-or-dir> [--window-runs 50] [--window-days 30] [--json <file>] [--markdown <file>] [--fail-on-budget]');
		process.exit(args.help ? 0 : 2);
	}
	const rows = collectJsonFiles(args.registry).map((file) => ({ ...readJson(file), _source_file: repoRelative(file) }));
	const report = buildStabilityReport(rows, args);
	const json = `${JSON.stringify(report, null, 2)}\n`;
	const markdown = renderMarkdown(report);
	if (args.json) {
		writeFile(path.resolve(args.json), json);
	}
	if (args.markdown) {
		writeFile(path.resolve(args.markdown), markdown);
	}
	if (!args.json && !args.markdown) {
		console.log(json);
	}
	if (args.failOnBudget && report.budget_status !== 'pass') {
		process.exit(1);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}

export { buildStabilityReport, classifyStabilityFailure, defaultBudgets, failureClasses, renderMarkdown };
