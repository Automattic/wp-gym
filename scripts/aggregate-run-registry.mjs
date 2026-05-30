import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { provenanceFingerprints, validateRunRegistryEntry } from './validate-run-registry.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeFile(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, value);
}

function repoRelative(file) {
	return path.relative(root, file).replace(/\\/g, '/');
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

function percent(value) {
	return `${(value * 100).toFixed(1)}%`;
}

function confidenceInterval(successes, total) {
	if (total < 2) {
		return null;
	}
	const rate = successes / total;
	const margin = 1.96 * Math.sqrt((rate * (1 - rate)) / total);
	return [Math.max(0, rate - margin), Math.min(1, rate + margin)];
}

function sampleVariance(values) {
	if (values.length < 2) {
		return 0;
	}
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	return values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
}

function rewardConfidenceInterval(values) {
	if (values.length < 2) {
		return null;
	}
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	const standardDeviation = Math.sqrt(sampleVariance(values));
	const margin = 1.96 * (standardDeviation / Math.sqrt(values.length));
	return [Number(Math.max(0, mean - margin).toFixed(4)), Number(Math.min(1, mean + margin).toFixed(4))];
}

function emptySummary(key = '') {
	return {
		key,
		runs: 0,
		passed: 0,
		failed: 0,
		errored: 0,
		reward_sum: 0,
		rewards: [],
		reward_mean: 0,
		reward_variance: 0,
		reward_stddev: 0,
		reward_confidence_interval_95: null,
		pass_rate: 0,
		pass_at_1: 0,
		pass_at_n: 0,
		confidence_interval_95: null,
		failure_classes: {},
		failed_checks: {},
		data_quality_gaps: {},
	};
}

function addCount(object, key, amount = 1) {
	const normalized = key || 'unknown';
	object[normalized] = (object[normalized] || 0) + amount;
}

function addEntry(summary, row) {
	summary.runs += 1;
	const outcome = row.run?.outcome || 'errored';
	if (outcome === 'passed') {
		summary.passed += 1;
	} else if (outcome === 'failed') {
		summary.failed += 1;
	} else {
		summary.errored += 1;
	}
	summary.reward_sum += Number(row.grade_identity?.reward || 0);
	summary.rewards.push(Number(row.grade_identity?.reward || 0));
	addCount(summary.failure_classes, row.grade_identity?.failure_class || 'unknown');
	for (const reason of row.benchmark?.exclusion_reasons || []) {
		addCount(summary.data_quality_gaps, reason);
	}
}

function finalizeSummary(summary) {
	summary.reward_mean = summary.runs > 0 ? Number((summary.reward_sum / summary.runs).toFixed(4)) : 0;
	summary.reward_variance = Number(sampleVariance(summary.rewards).toFixed(4));
	summary.reward_stddev = Number(Math.sqrt(summary.reward_variance).toFixed(4));
	summary.reward_confidence_interval_95 = rewardConfidenceInterval(summary.rewards);
	summary.pass_rate = summary.runs > 0 ? Number((summary.passed / summary.runs).toFixed(4)) : 0;
	summary.pass_at_1 = summary.pass_rate;
	summary.pass_at_n = summary.runs > 0 ? Number((summary.passed > 0 ? 1 : 0).toFixed(4)) : 0;
	summary.confidence_interval_95 = confidenceInterval(summary.passed, summary.runs);
	delete summary.reward_sum;
	delete summary.rewards;
	return summary;
}

function scopeIncludes(row, scope) {
	if (scope === 'all') {
		return true;
	}
	if (scope === 'headline') {
		return row.benchmark?.eligible === true && row.benchmark?.headline_score_eligible === true;
	}
	if (scope === 'benchmark') {
		return row.benchmark?.eligible === true;
	}
	return row.task_set?.benchmark_status === 'pilot' || row.calibration?.status === 'pilot' || row.benchmark?.eligible !== true;
}

function groupBy(rows, keyFn) {
	const groups = new Map();
	for (const row of rows) {
		const key = keyFn(row);
		if (!groups.has(key)) {
			groups.set(key, emptySummary(key));
		}
		addEntry(groups.get(key), row);
	}
	return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, summary]) => [key, finalizeSummary(summary)]));
}

function resultSetKey(row) {
	return row.run?.result_set_id || row.calibration?.result_set_id || `${row.scenario?.id || 'unknown'}:${row.runner?.provider || 'unknown'}:${row.runner?.model || 'unknown'}`;
}

function modelTier(row) {
	if (row.calibration?.model_tier) {
		return row.calibration.model_tier;
	}
	const rowType = row.calibration?.row_type || 'unknown';
	if (['no_op', 'heuristic_scripted', 'cheap_model', 'frontier_model', 'human_reference'].includes(rowType)) {
		return rowType;
	}
	const model = row.runner?.model || '';
	if (/mini|small|haiku|flash|nano/i.test(model)) {
		return 'cheap_model';
	}
	if (model) {
		return 'frontier_model';
	}
	return rowType;
}

function rowFailedChecks(row) {
	const evalArtifactPath = row.eval_artifact?.path_or_url;
	if (!evalArtifactPath || /^https?:\/\//i.test(evalArtifactPath)) {
		return [];
	}
	const resolved = path.resolve(root, evalArtifactPath);
	if (!fs.existsSync(resolved)) {
		return [];
	}
	const evalArtifact = readJson(resolved);
	return (evalArtifact.grader?.checks || [])
		.filter((check) => check.passed === false)
		.map((check) => check.id || 'unknown_check');
}

async function aggregate(entries, options) {
	const rows = [];
	const rejected = [];
	for (const file of entries) {
		const row = readJson(file);
		const validation = await validateRunRegistryEntry(row, { benchmarkMode: options.benchmarkMode, baseDir: root });
		const rowSummary = { file: repoRelative(file), ok: validation.ok, compatibility_gaps: validation.compatibility_gaps };
		if (!validation.ok) {
			rejected.push(rowSummary);
			if (!options.includeInvalid) {
				continue;
			}
		}
		if (!scopeIncludes(row, options.scope)) {
			continue;
		}
		for (const check of rowFailedChecks(row)) {
			row._failed_checks = [...(row._failed_checks || []), check];
		}
		rows.push(row);
	}

	const overall = finalizeSummary(rows.reduce((summary, row) => {
		addEntry(summary, row);
		for (const check of row._failed_checks || []) {
			addCount(summary.failed_checks, check);
		}
		return summary;
	}, emptySummary('overall')));

	return {
		schema_version: 1,
		report: {
			name: 'wp-gym-run-registry-report',
			created_at: new Date().toISOString(),
			scope: options.scope,
			benchmark_mode: options.benchmarkMode,
		},
		inputs: {
			inspected: entries.length,
			accepted: rows.length,
			rejected: rejected.length,
		},
		overall,
		by_provider_model: groupBy(rows, (row) => `${row.runner?.provider || 'unknown'}/${row.runner?.model || 'unknown'}`),
		by_model_tier: groupBy(rows, modelTier),
		by_calibration_row_type: groupBy(rows, (row) => row.calibration?.row_type || 'unknown'),
		by_scenario_model: groupBy(rows, (row) => `${row.scenario?.id || 'unknown'}:${row.runner?.provider || 'unknown'}/${row.runner?.model || 'unknown'}`),
		by_task_family_model_tier: groupBy(rows, (row) => `${row.scenario?.task_family || 'unknown'}:${modelTier(row)}`),
		by_result_set: groupBy(rows, resultSetKey),
		by_task: groupBy(rows, (row) => row.scenario?.id || 'unknown'),
		by_task_family: groupBy(rows, (row) => row.scenario?.task_family || 'unknown'),
		by_capability: groupBy(rows, (row) => row.scenario?.capabilities?.primary || 'unknown'),
		rejected,
		rows: rows.map((row) => ({
			run_id: row.run?.id,
			task_set: row.task_set?.id,
			scenario: row.scenario?.id,
			held_out_pack: row.held_out ? {
				pack_id: row.held_out.pack_id,
				pack_version: row.held_out.pack_version,
				entry_id: row.held_out.entry_id,
				public_reference: row.held_out.public_reference,
				sealed_hashes: row.held_out.sealed_hashes,
			} : null,
			task_family: row.scenario?.task_family,
			provider: row.runner?.provider,
			model: row.runner?.model,
			model_tier: modelTier(row),
			calibration_row_type: row.calibration?.row_type || 'unknown',
			outcome: row.run?.outcome,
			reward: row.grade_identity?.reward,
			attempt_id: row.run?.attempt_id || null,
			attempt_index: row.run?.attempt || null,
			attempt_count: row.run?.attempt_count || null,
			result_set_id: row.run?.result_set_id || row.calibration?.result_set_id || null,
			failure_class: row.grade_identity?.failure_class,
			capability: row.scenario?.capabilities?.primary || null,
			benchmark_eligible: row.benchmark?.eligible,
			headline_score_eligible: row.benchmark?.headline_score_eligible,
			immutable_fingerprints: provenanceFingerprints(row.provenance),
			exclusion_reasons: row.benchmark?.exclusion_reasons || [],
			failed_checks: row._failed_checks || [],
		})),
	};
}

function renderTable(headers, rows) {
	return [
		`| ${headers.join(' | ')} |`,
		`| ${headers.map(() => '---').join(' | ')} |`,
		...rows.map((row) => `| ${row.join(' | ')} |`),
	].join('\n');
}

function renderSummaryMap(map) {
	return Object.values(map).map((summary) => [
		summary.key,
		String(summary.runs),
		percent(summary.pass_rate),
		percent(summary.pass_at_n),
		String(summary.reward_mean),
		String(summary.reward_stddev),
		summary.reward_confidence_interval_95 ? summary.reward_confidence_interval_95.map((value) => String(value)).join(' - ') : 'n/a',
		String(summary.failed),
		String(summary.errored),
	]);
}

function renderMarkdown(report) {
	const lines = [
		'# WP Gym Run Registry Report',
		'',
		`- **Scope:** \`${report.report.scope}\``,
		`- **Benchmark mode:** \`${report.report.benchmark_mode}\``,
		`- **Rows:** ${report.inputs.accepted} accepted / ${report.inputs.inspected} inspected`,
		`- **Rejected rows:** ${report.inputs.rejected}`,
		'',
		'## Overall',
		'',
		renderTable(['Runs', 'Pass@1', 'Pass@n', 'Reward mean', 'Reward stddev', 'Reward 95% CI', 'Passed', 'Failed', 'Errored'], [[
			String(report.overall.runs),
			percent(report.overall.pass_at_1),
			percent(report.overall.pass_at_n),
			String(report.overall.reward_mean),
			String(report.overall.reward_stddev),
			report.overall.reward_confidence_interval_95 ? report.overall.reward_confidence_interval_95.map((value) => String(value)).join(' - ') : 'n/a',
			String(report.overall.passed),
			String(report.overall.failed),
			String(report.overall.errored),
		]]),
		'',
		'## Provider / Model',
		'',
		renderTable(['Provider/model', 'Runs', 'Pass@1', 'Pass@n', 'Reward mean', 'Reward stddev', 'Reward 95% CI', 'Failed', 'Errored'], renderSummaryMap(report.by_provider_model)),
		'',
		'## Model Tier',
		'',
		renderTable(['Model tier', 'Runs', 'Pass@1', 'Pass@n', 'Reward mean', 'Reward stddev', 'Reward 95% CI', 'Failed', 'Errored'], renderSummaryMap(report.by_model_tier)),
		'',
		'## Calibration Row Type',
		'',
		renderTable(['Row type', 'Runs', 'Pass@1', 'Pass@n', 'Reward mean', 'Reward stddev', 'Reward 95% CI', 'Failed', 'Errored'], renderSummaryMap(report.by_calibration_row_type)),
		'',
		'## Scenario / Model',
		'',
		renderTable(['Scenario/model', 'Runs', 'Pass@1', 'Pass@n', 'Reward mean', 'Reward stddev', 'Reward 95% CI', 'Failed', 'Errored'], renderSummaryMap(report.by_scenario_model)),
		'',
		'## Result Sets',
		'',
		renderTable(['Result set', 'Runs', 'Pass@1', 'Pass@n', 'Reward mean', 'Reward stddev', 'Reward 95% CI', 'Failed', 'Errored'], renderSummaryMap(report.by_result_set)),
		'',
		'## Tasks',
		'',
		renderTable(['Task', 'Runs', 'Pass@1', 'Pass@n', 'Reward mean', 'Reward stddev', 'Reward 95% CI', 'Failed', 'Errored'], renderSummaryMap(report.by_task)),
		'',
		'## Task Families',
		'',
		renderTable(['Family', 'Runs', 'Pass@1', 'Pass@n', 'Reward mean', 'Reward stddev', 'Reward 95% CI', 'Failed', 'Errored'], renderSummaryMap(report.by_task_family)),
		'',
		'## Task Family / Model Tier',
		'',
		renderTable(['Family/tier', 'Runs', 'Pass@1', 'Pass@n', 'Reward mean', 'Reward stddev', 'Reward 95% CI', 'Failed', 'Errored'], renderSummaryMap(report.by_task_family_model_tier)),
		'',
		'## Rows',
		'',
		renderTable(['Task', 'Held-out pack', 'Provider/model', 'Model tier', 'Row type', 'Attempt', 'Result set', 'Outcome', 'Reward', 'Failure class', 'Headline', 'Workflow SHA', 'Tool policy SHA', 'Bundle SHA', 'Exclusions'], report.rows.map((row) => [
			row.scenario || '',
			row.held_out_pack?.pack_id || '',
			`${row.provider || 'unknown'}/${row.model || 'unknown'}`,
			row.model_tier || 'unknown',
			row.calibration_row_type || 'unknown',
			row.attempt_index ? `${row.attempt_index}/${row.attempt_count || '?'}` : '',
			row.result_set_id || '',
			row.outcome || '',
			String(row.reward ?? ''),
			row.failure_class || '',
			row.headline_score_eligible ? 'yes' : 'no',
			row.immutable_fingerprints?.workflow_sha || '',
			row.immutable_fingerprints?.tool_policy_sha256 || '',
			row.immutable_fingerprints?.bundle_sha256 || '',
			(row.exclusion_reasons || []).join(', ') || 'none',
		])),
	];

	if (report.rejected.length > 0) {
		lines.push('', '## Data Quality Gaps', '');
		lines.push(renderTable(['File', 'Gap codes'], report.rejected.map((row) => [row.file, row.compatibility_gaps.map((gap) => gap.code).join(', ')])));
	}

	return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
	const args = { registry: '', json: '', markdown: '', scope: 'pilot', benchmarkMode: false, includeInvalid: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--registry' || arg === '--input') {
			args.registry = argv[++index];
		} else if (arg === '--json') {
			args.json = argv[++index];
		} else if (arg === '--markdown') {
			args.markdown = argv[++index];
		} else if (arg === '--scope') {
			args.scope = argv[++index];
		} else if (arg === '--benchmark-mode') {
			args.benchmarkMode = true;
		} else if (arg === '--include-invalid') {
			args.includeInvalid = true;
		} else if (arg === '--help' || arg === '-h') {
			args.help = true;
		} else if (!args.registry) {
			args.registry = arg;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	if (!['pilot', 'benchmark', 'headline', 'all'].includes(args.scope)) {
		throw new Error('--scope must be one of: pilot, benchmark, headline, all');
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || !args.registry) {
		console.error('Usage: node scripts/aggregate-run-registry.mjs --registry <registry-json-or-dir> [--scope pilot|benchmark|headline|all] [--json <file>] [--markdown <file>] [--benchmark-mode]');
		process.exit(args.help ? 0 : 2);
	}
	const report = await aggregate(collectJsonFiles(args.registry), args);
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
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
