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
		operations: {
			estimated_cost_usd: 0,
			billed_cost_usd: 0,
			input_tokens: 0,
			output_tokens: 0,
			total_tokens: 0,
			wall_ms: 0,
			queue_ms: 0,
			runner_ms: 0,
			provider_ms: 0,
			retry_count: 0,
			max_concurrency: 0,
			timing_rows: 0,
			cost_rows: 0,
			retry_dispositions: {},
		},
	};
}

function largeNSummary(summary, minimumAttempts) {
	return {
		key: summary.key,
		row_count: summary.runs,
		threshold_met: summary.runs >= minimumAttempts,
		pass_at_1: summary.pass_at_1,
		pass_at_n: summary.pass_at_n,
		pass_rate: summary.pass_rate,
		confidence_interval_95: summary.confidence_interval_95,
		reward_mean: summary.reward_mean,
		reward_variance: summary.reward_variance,
		reward_stddev: summary.reward_stddev,
		reward_confidence_interval_95: summary.reward_confidence_interval_95,
		failure_classes: summary.failure_classes,
		data_quality_gaps: summary.data_quality_gaps,
	};
}

function largeNSummaryMap(map, minimumAttempts) {
	return Object.fromEntries(Object.entries(map).map(([key, summary]) => [key, largeNSummary(summary, minimumAttempts)]));
}

function addCount(object, key, amount = 1) {
	const normalized = key || 'unknown';
	object[normalized] = (object[normalized] || 0) + amount;
}

function replayRegradeSummary() {
	return {
		enabled: false,
		attempted: 0,
		deterministic: 0,
		failed: 0,
		success_rate: 0,
		drift: 0,
		drift_rate: 0,
		missing_artifacts: 0,
		failure_classes: {},
		gap_codes: {},
	};
}

function replayGapClass(code) {
	if (/drift|mismatch/i.test(code)) {
		return 'drift';
	}
	if (/missing.*artifact|missing.*evidence|missing_local_artifact|missing_wordpress_state|missing_replay_trace/i.test(code)) {
		return 'missing_artifacts';
	}
	if (/hash|sha256/i.test(code)) {
		return 'artifact_integrity';
	}
	if (/grader/i.test(code)) {
		return 'grader_failure';
	}
	if (/episode|trace|action|replay/i.test(code)) {
		return 'replay_incompatibility';
	}
	return 'data_quality';
}

function addReplayRegradeResult(summary, validation) {
	summary.enabled = true;
	summary.attempted += 1;
	const gaps = validation.compatibility_gaps || [];
	const errorCodes = gaps.filter((gap) => gap.severity === 'error').map((gap) => gap.code || 'unknown');
	if (validation.ok) {
		summary.deterministic += 1;
		addCount(summary.failure_classes, 'none');
		return;
	}

	summary.failed += 1;
	if (errorCodes.some((code) => /drift|mismatch/i.test(code))) {
		summary.drift += 1;
	}
	if (errorCodes.some((code) => /missing.*artifact|missing.*evidence|missing_local_artifact|missing_wordpress_state|missing_replay_trace/i.test(code))) {
		summary.missing_artifacts += 1;
	}
	for (const code of errorCodes) {
		addCount(summary.gap_codes, code);
	}
	addCount(summary.failure_classes, replayGapClass(errorCodes[0] || 'unknown'));
}

function finalizeReplayRegradeSummary(summary) {
	summary.success_rate = summary.attempted > 0 ? Number((summary.deterministic / summary.attempted).toFixed(4)) : 0;
	summary.drift_rate = summary.attempted > 0 ? Number((summary.drift / summary.attempted).toFixed(4)) : 0;
	return summary;
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
	const operations = row.operations || {};
	const cost = operations.cost || {};
	const usage = operations.usage || {};
	const timing = operations.timing || {};
	const concurrency = operations.concurrency || {};
	const retry = operations.retry || {};
	const estimatedCost = Number(cost.estimated_usd || 0);
	const billedCost = Number(cost.billed_usd || 0);
	if (estimatedCost || billedCost) {
		summary.operations.cost_rows += 1;
	}
	summary.operations.estimated_cost_usd += estimatedCost;
	summary.operations.billed_cost_usd += billedCost;
	summary.operations.input_tokens += Number(usage.input_tokens || 0);
	summary.operations.output_tokens += Number(usage.output_tokens || 0);
	summary.operations.total_tokens += Number(usage.total_tokens || 0);
	const wallMs = Number(timing.wall_ms || 0);
	const queueMs = Number(timing.queue_ms || 0);
	const runnerMs = Number(timing.runner_ms || 0);
	const providerMs = Number(timing.provider_ms || 0);
	if (wallMs || queueMs || runnerMs || providerMs) {
		summary.operations.timing_rows += 1;
	}
	summary.operations.wall_ms += wallMs;
	summary.operations.queue_ms += queueMs;
	summary.operations.runner_ms += runnerMs;
	summary.operations.provider_ms += providerMs;
	summary.operations.retry_count += Number(retry.retry_count || 0);
	summary.operations.max_concurrency = Math.max(summary.operations.max_concurrency, Number(concurrency.effective || concurrency.requested || concurrency.matrix_max || 0));
	addCount(summary.operations.retry_dispositions, retry.disposition || 'unknown');
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
	summary.operations.estimated_cost_usd = Number(summary.operations.estimated_cost_usd.toFixed(6));
	summary.operations.billed_cost_usd = Number(summary.operations.billed_cost_usd.toFixed(6));
	summary.operations.avg_wall_ms = summary.operations.timing_rows > 0 ? Number((summary.operations.wall_ms / summary.operations.timing_rows).toFixed(0)) : null;
	summary.operations.avg_queue_ms = summary.operations.timing_rows > 0 ? Number((summary.operations.queue_ms / summary.operations.timing_rows).toFixed(0)) : null;
	summary.operations.runs_per_wall_hour = summary.operations.wall_ms > 0 ? Number((summary.runs / (summary.operations.wall_ms / 3600000)).toFixed(4)) : null;
	summary.operations.cost_per_run_usd = summary.runs > 0 ? Number((summary.operations.estimated_cost_usd / summary.runs).toFixed(6)) : null;
	summary.operations.tokens_per_run = summary.runs > 0 ? Number((summary.operations.total_tokens / summary.runs).toFixed(0)) : null;
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
	const replayRegrade = replayRegradeSummary();
	for (const file of entries) {
		const row = readJson(file);
		const validation = await validateRunRegistryEntry(row, { benchmarkMode: options.benchmarkMode, regrade: options.regrade, baseDir: options.baseDir || root });
		const rowSummary = { file: repoRelative(file), ok: validation.ok, compatibility_gaps: validation.compatibility_gaps };
		if (options.regrade) {
			addReplayRegradeResult(replayRegrade, validation);
		}
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
	const byModelTier = groupBy(rows, modelTier);
	const byTaskModelTier = groupBy(rows, (row) => `${row.scenario?.id || 'unknown'}:${modelTier(row)}`);
	const byTaskFamilyModelTier = groupBy(rows, (row) => `${row.scenario?.task_family || 'unknown'}:${modelTier(row)}`);

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
		replay_regrade: finalizeReplayRegradeSummary(replayRegrade),
		overall,
		by_provider_model: groupBy(rows, (row) => `${row.runner?.provider || 'unknown'}/${row.runner?.model || 'unknown'}`),
		by_model_tier: byModelTier,
		by_calibration_row_type: groupBy(rows, (row) => row.calibration?.row_type || 'unknown'),
		by_scenario_model: groupBy(rows, (row) => `${row.scenario?.id || 'unknown'}:${row.runner?.provider || 'unknown'}/${row.runner?.model || 'unknown'}`),
		by_task_model_tier: byTaskModelTier,
		by_task_family_model_tier: byTaskFamilyModelTier,
		by_failure_class: groupBy(rows, (row) => row.grade_identity?.failure_class || 'unknown'),
		by_result_set: groupBy(rows, resultSetKey),
		by_task: groupBy(rows, (row) => row.scenario?.id || 'unknown'),
		by_task_family: groupBy(rows, (row) => row.scenario?.task_family || 'unknown'),
		by_capability: groupBy(rows, (row) => row.scenario?.capabilities?.primary || 'unknown'),
		by_benchmark_release: groupBy(rows, (row) => row.benchmark?.release_id || 'unknown'),
		large_n_calibration: {
			min_attempts_per_model_tier: options.largeNMinAttempts,
			benchmark_ready_threshold_met: Object.keys(byModelTier).length > 0 && Object.values(byModelTier).every((summary) => summary.runs >= options.largeNMinAttempts),
			by_model_tier: largeNSummaryMap(byModelTier, options.largeNMinAttempts),
			by_task_model_tier: largeNSummaryMap(byTaskModelTier, options.largeNMinAttempts),
			by_task_family_model_tier: largeNSummaryMap(byTaskFamilyModelTier, options.largeNMinAttempts),
		},
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
			operations: row.operations || null,
			capability: row.scenario?.capabilities?.primary || null,
			benchmark_eligible: row.benchmark?.eligible,
			headline_score_eligible: row.benchmark?.headline_score_eligible,
			benchmark_release: row.benchmark ? {
				release_id: row.benchmark.release_id || null,
				release_version: row.benchmark.release_version || null,
				release_type: row.benchmark.release_type || null,
				release_status: row.benchmark.release_status || null,
				release_manifest: row.benchmark.release_manifest || null,
				release_manifest_sha256: row.benchmark.release_manifest_sha256 || null,
			} : null,
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
		String(summary.operations.estimated_cost_usd),
		String(summary.operations.total_tokens),
		summary.operations.runs_per_wall_hour === null ? 'n/a' : String(summary.operations.runs_per_wall_hour),
		String(summary.operations.retry_count),
		String(summary.failed),
		String(summary.errored),
	]);
}

const summaryHeaders = ['Runs', 'Pass@1', 'Pass@n', 'Reward mean', 'Reward stddev', 'Reward 95% CI', 'Est. cost USD', 'Tokens', 'Runs/wall hour', 'Retries', 'Failed', 'Errored'];

function formatCounts(counts = {}) {
	const entries = Object.entries(counts).filter(([, count]) => count > 0).sort(([left], [right]) => left.localeCompare(right));
	return entries.length > 0 ? entries.map(([key, count]) => `${key}: ${count}`).join(', ') : 'none';
}

function renderLargeNMap(map) {
	return Object.values(map).map((summary) => [
		summary.key,
		String(summary.row_count),
		summary.threshold_met ? 'yes' : 'no',
		percent(summary.pass_at_1),
		percent(summary.pass_at_n),
		String(summary.reward_mean),
		String(summary.reward_variance),
		summary.confidence_interval_95 ? summary.confidence_interval_95.map((value) => String(value)).join(' - ') : 'n/a',
		formatCounts(summary.failure_classes),
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
		'## Replay / Regrade',
		'',
		renderTable(['Enabled', 'Attempted', 'Deterministic', 'Failed', 'Success rate', 'Drift rate', 'Missing artifacts'], [[
			report.replay_regrade.enabled ? 'yes' : 'no',
			String(report.replay_regrade.attempted),
			String(report.replay_regrade.deterministic),
			String(report.replay_regrade.failed),
			percent(report.replay_regrade.success_rate),
			percent(report.replay_regrade.drift_rate),
			String(report.replay_regrade.missing_artifacts),
		]]),
		'',
		'## Overall',
		'',
		renderTable(['Runs', 'Pass@1', 'Pass@n', 'Reward mean', 'Reward stddev', 'Reward 95% CI', 'Est. cost USD', 'Tokens', 'Runs/wall hour', 'Retries', 'Passed', 'Failed', 'Errored'], [[
			String(report.overall.runs),
			percent(report.overall.pass_at_1),
			percent(report.overall.pass_at_n),
			String(report.overall.reward_mean),
			String(report.overall.reward_stddev),
			report.overall.reward_confidence_interval_95 ? report.overall.reward_confidence_interval_95.map((value) => String(value)).join(' - ') : 'n/a',
			String(report.overall.operations.estimated_cost_usd),
			String(report.overall.operations.total_tokens),
			report.overall.operations.runs_per_wall_hour === null ? 'n/a' : String(report.overall.operations.runs_per_wall_hour),
			String(report.overall.operations.retry_count),
			String(report.overall.passed),
			String(report.overall.failed),
			String(report.overall.errored),
		]]),
		'',
		'## Provider / Model',
		'',
		renderTable(['Provider/model', ...summaryHeaders], renderSummaryMap(report.by_provider_model)),
		'',
		'## Model Tier',
		'',
		renderTable(['Model tier', ...summaryHeaders], renderSummaryMap(report.by_model_tier)),
		'',
		'## Calibration Row Type',
		'',
		renderTable(['Row type', ...summaryHeaders], renderSummaryMap(report.by_calibration_row_type)),
		'',
		'## Scenario / Model',
		'',
		renderTable(['Scenario/model', ...summaryHeaders], renderSummaryMap(report.by_scenario_model)),
		'',
		'## Result Sets',
		'',
		renderTable(['Result set', ...summaryHeaders], renderSummaryMap(report.by_result_set)),
		'',
		'## Tasks',
		'',
		renderTable(['Task', ...summaryHeaders], renderSummaryMap(report.by_task)),
		'',
		'## Task Families',
		'',
		renderTable(['Family', ...summaryHeaders], renderSummaryMap(report.by_task_family)),
		'',
		'## Task Family / Model Tier',
		'',
		renderTable(['Family/tier', ...summaryHeaders], renderSummaryMap(report.by_task_family_model_tier)),
		'',
		'## Failure Classes',
		'',
		renderTable(['Failure class', ...summaryHeaders], renderSummaryMap(report.by_failure_class)),
		'',
		'## Large-N Calibration',
		'',
		`- **Minimum attempts per model tier:** ${report.large_n_calibration.min_attempts_per_model_tier}`,
		`- **Benchmark-ready threshold met:** ${report.large_n_calibration.benchmark_ready_threshold_met ? 'yes' : 'no'}`,
		'',
		'### Large-N By Model Tier',
		'',
		renderTable(['Model tier', 'Rows', 'Meets min', 'Pass@1', 'Pass@n', 'Reward mean', 'Reward variance', 'Pass 95% CI', 'Failure classes'], renderLargeNMap(report.large_n_calibration.by_model_tier)),
		'',
		'### Large-N By Task / Model Tier',
		'',
		renderTable(['Task/tier', 'Rows', 'Meets min', 'Pass@1', 'Pass@n', 'Reward mean', 'Reward variance', 'Pass 95% CI', 'Failure classes'], renderLargeNMap(report.large_n_calibration.by_task_model_tier)),
		'',
		'### Large-N By Task Family / Model Tier',
		'',
		renderTable(['Family/tier', 'Rows', 'Meets min', 'Pass@1', 'Pass@n', 'Reward mean', 'Reward variance', 'Pass 95% CI', 'Failure classes'], renderLargeNMap(report.large_n_calibration.by_task_family_model_tier)),
		'',
		'## Benchmark Releases',
		'',
		renderTable(['Release', 'Runs', 'Pass@1', 'Pass@n', 'Reward mean', 'Reward stddev', 'Reward 95% CI', 'Failed', 'Errored'], renderSummaryMap(report.by_benchmark_release)),
		'',
		'## Rows',
		'',
		renderTable(['Task', 'Release', 'Held-out pack', 'Provider/model', 'Model tier', 'Row type', 'Attempt', 'Result set', 'Outcome', 'Reward', 'Failure class', 'Est. cost USD', 'Tokens', 'Wall ms', 'Queue ms', 'Retries', 'Retry disposition', 'Concurrency', 'Headline', 'Workflow SHA', 'Tool policy SHA', 'Bundle SHA', 'Exclusions'], report.rows.map((row) => [
			row.scenario || '',
			row.benchmark_release?.release_id || '',
			row.held_out_pack?.pack_id || '',
			`${row.provider || 'unknown'}/${row.model || 'unknown'}`,
			row.model_tier || 'unknown',
			row.calibration_row_type || 'unknown',
			row.attempt_index ? `${row.attempt_index}/${row.attempt_count || '?'}` : '',
			row.result_set_id || '',
			row.outcome || '',
			String(row.reward ?? ''),
			row.failure_class || '',
			String(row.operations?.cost?.estimated_usd ?? ''),
			String(row.operations?.usage?.total_tokens ?? ''),
			String(row.operations?.timing?.wall_ms ?? ''),
			String(row.operations?.timing?.queue_ms ?? ''),
			String(row.operations?.retry?.retry_count ?? ''),
			row.operations?.retry?.disposition || '',
			String(row.operations?.concurrency?.effective || row.operations?.concurrency?.requested || ''),
			row.headline_score_eligible ? 'yes' : 'no',
			row.immutable_fingerprints?.workflow_sha || '',
			row.immutable_fingerprints?.tool_policy_sha256 || '',
			row.immutable_fingerprints?.bundle_sha256 || '',
			(row.exclusion_reasons || []).join(', ') || 'none',
		])),
	];

	if (report.rejected.length > 0) {
		lines.push('', '## Data Quality Gaps', '');
		lines.push(renderTable(['File', 'Gap codes'], report.rejected.map((row) => [row.file, (row.compatibility_gaps || []).map((gap) => gap.code).join(', ') || 'invalid_registry_entry'])));
	}

	return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
	const args = { registry: '', json: '', markdown: '', scope: 'pilot', benchmarkMode: false, includeInvalid: false, regrade: false, largeNMinAttempts: 30 };
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
		} else if (arg === '--regrade') {
			args.regrade = true;
			args.benchmarkMode = true;
		} else if (arg === '--include-invalid') {
			args.includeInvalid = true;
		} else if (arg === '--large-n-min-attempts') {
			args.largeNMinAttempts = Number(argv[++index]);
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
	if (!Number.isInteger(args.largeNMinAttempts) || args.largeNMinAttempts < 1) {
		throw new Error('--large-n-min-attempts must be a positive integer');
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || !args.registry) {
		console.error('Usage: node scripts/aggregate-run-registry.mjs --registry <registry-json-or-dir> [--scope pilot|benchmark|headline|all] [--json <file>] [--markdown <file>] [--benchmark-mode] [--regrade] [--large-n-min-attempts <count>]');
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

export { aggregate, renderMarkdown };
