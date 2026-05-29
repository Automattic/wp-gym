import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const commandName = 'wp-gym benchmark-promotion report';
const hashFields = [
	'manifest_sha256',
	'prompt_sha256',
	'grader_sha256',
	'setup_sha256',
	'expected_artifacts_sha256',
	'replay_contract_sha256',
];
const hashPattern = /^[a-f0-9]{64}$/;
const benchmarkReplayRequiredArtifacts = ['grader_result', 'replay_bundle', 'replay_trace'];
const benchmarkReplayStateArtifacts = ['wordpress_state', 'workspace_diff', 'plugin_files', 'media_library'];
const benchmarkReplayActionTypes = ['wp_cli', 'filesystem'];

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listJsonFiles(dir) {
	const files = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...listJsonFiles(entryPath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(entryPath);
		}
	}
	return files.sort();
}

function repoRelative(root, file) {
	return path.relative(root, file).replace(/\\/g, '/');
}

function stable(value) {
	if (Array.isArray(value)) {
		return value.map(stable);
	}
	if (value && typeof value === 'object') {
		const result = {};
		for (const key of Object.keys(value).sort()) {
			if (key === 'promotion_report') {
				continue;
			}
			result[key] = stable(value[key]);
		}
		return result;
	}
	return value;
}

function sha256(value) {
	return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function gate(code, status, message, evidence = [], blockers = []) {
	return { code, status, message, evidence, blockers };
}

function fail(code, message, blockers, evidence = []) {
	return gate(code, 'fail', message, evidence, blockers);
}

function pass(code, message, evidence = []) {
	return gate(code, 'pass', message, evidence, []);
}

function hasVersionIdentity(metadata) {
	return Boolean(metadata?.version_identity) && hashFields.every((field) => hashPattern.test(metadata.version_identity[field] || ''));
}

function loadScenarios(root) {
	const scenarios = new Map();
	for (const file of listJsonFiles(path.join(root, 'scenarios'))) {
		const manifest = readJson(file);
		scenarios.set(manifest.id, { file, manifest });
	}
	return scenarios;
}

function loadTaskSets(root) {
	const taskSets = new Map();
	for (const file of listJsonFiles(path.join(root, 'task-sets'))) {
		const manifest = readJson(file);
		taskSets.set(manifest.id, { file, manifest });
	}
	return taskSets;
}

function loadShortcutCoverage(root) {
	const coverage = new Map();
	const fixtureRoot = path.join(root, 'fixtures', 'reward-hacking');
	if (!fs.existsSync(fixtureRoot)) {
		return coverage;
	}

	for (const file of listJsonFiles(fixtureRoot)) {
		const fixture = readJson(file);
		if (!fixture.scenario_id) {
			continue;
		}
		if (!coverage.has(fixture.scenario_id)) {
			coverage.set(fixture.scenario_id, { negative: new Map(), positive: new Map() });
		}
		const scenarioCoverage = coverage.get(fixture.scenario_id);
		const relativeFile = repoRelative(root, file);
		if (fixture.type === 'adversarial_negative_fixture' && fixture.shortcut_id) {
			if (!scenarioCoverage.negative.has(fixture.shortcut_id)) {
				scenarioCoverage.negative.set(fixture.shortcut_id, []);
			}
			scenarioCoverage.negative.get(fixture.shortcut_id).push(relativeFile);
		}
		if (fixture.type === 'positive_control_fixture') {
			for (const shortcutId of fixture.covers_shortcut_ids || []) {
				if (!scenarioCoverage.positive.has(shortcutId)) {
					scenarioCoverage.positive.set(shortcutId, []);
				}
				scenarioCoverage.positive.get(shortcutId).push(relativeFile);
			}
		}
	}
	return coverage;
}

function scenarioSourceEnvelope(scenario) {
	return {
		type: 'scenario',
		file: scenario.file,
		manifest: scenario.manifest,
	};
}

function taskSetSourceEnvelope(taskSet, scenariosById) {
	const scenarioEnvelopes = [];
	for (const task of taskSet.manifest.tasks || []) {
		const scenario = scenariosById.get(task.scenario_id);
		if (scenario) {
			scenarioEnvelopes.push(scenarioSourceEnvelope(scenario));
		}
	}
	return {
		type: 'task_set',
		file: taskSet.file,
		manifest: taskSet.manifest,
		scenarios: scenarioEnvelopes.sort((left, right) => left.manifest.id.localeCompare(right.manifest.id)),
	};
}

function sourceSha256ForTarget(target, scenariosById = new Map()) {
	return target.type === 'task_set'
		? sha256(taskSetSourceEnvelope(target, scenariosById))
		: sha256(scenarioSourceEnvelope(target));
}

function evaluateScenario(scenario, context = {}) {
	const manifest = scenario.manifest;
	const calibration = manifest.calibration || {};
	const split = manifest.split || {};
	const coverage = context.shortcutCoverage?.get(manifest.id) || { negative: new Map(), positive: new Map() };
	const gates = [];

	gates.push(calibration.status === 'benchmark_ready' && calibration.benchmark_scope === 'benchmark' && calibration.headline_score_eligible === true
		? pass('scenario_status_benchmark_ready', 'Scenario is marked benchmark-ready and headline eligible.', [scenario.file])
		: fail('scenario_status_benchmark_ready', 'Scenario must be benchmark_ready, benchmark scoped, and headline eligible.', ['scenario_not_benchmark_ready'], [scenario.file]));

	gates.push(Array.isArray(calibration.baseline_result_sets) && calibration.baseline_result_sets.length > 0
		? pass('baseline_result_sets_present', 'Scenario declares baseline result sets.', calibration.baseline_result_sets)
		: fail('baseline_result_sets_present', 'Scenario must declare at least one baseline result set.', ['missing_baseline_results']));

	gates.push(Array.isArray(calibration.calibration_result_sets) && calibration.calibration_result_sets.length > 0
		? pass('calibration_result_sets_present', 'Scenario declares calibration result sets.', calibration.calibration_result_sets)
		: fail('calibration_result_sets_present', 'Scenario must declare at least one calibration result set.', ['missing_calibration_results']));

	gates.push(calibration.difficulty_band && calibration.difficulty_band !== 'uncalibrated'
		? pass('difficulty_band_calibrated', `Difficulty band is ${calibration.difficulty_band}.`)
		: fail('difficulty_band_calibrated', 'Scenario difficulty_band must be calibrated.', ['uncalibrated_difficulty']));

	gates.push(calibration.pass_rate_band && calibration.pass_rate_band !== 'uncalibrated'
		? pass('pass_rate_band_calibrated', `Pass-rate band is ${calibration.pass_rate_band}.`)
		: fail('pass_rate_band_calibrated', 'Scenario pass_rate_band must be calibrated.', ['uncalibrated_pass_rate']));

	gates.push(Array.isArray(calibration.confidence_interval_95) && calibration.confidence_interval_95.length === 2
		? pass('confidence_interval_present', `95% confidence interval is [${calibration.confidence_interval_95.join(', ')}].`)
		: fail('confidence_interval_present', 'Scenario must declare confidence_interval_95.', ['missing_confidence_interval']));

	const shortcutBlockers = [];
	const shortcutEvidence = [];
	for (const shortcutId of calibration.known_shortcuts || []) {
		const negative = coverage.negative.get(shortcutId) || [];
		const positive = coverage.positive.get(shortcutId) || [];
		shortcutEvidence.push(...negative, ...positive);
		if (negative.length === 0) {
			shortcutBlockers.push(`missing_shortcut_negative_fixture:${shortcutId}`);
		}
		if (positive.length === 0) {
			shortcutBlockers.push(`missing_shortcut_positive_fixture:${shortcutId}`);
		}
	}
	gates.push(shortcutBlockers.length === 0
		? pass('known_shortcuts_fixture_covered', 'Known shortcuts are either absent or covered by executable reward fixtures.', shortcutEvidence)
		: fail('known_shortcuts_fixture_covered', 'Known shortcuts must have adversarial negative and nearby positive fixture coverage.', shortcutBlockers, shortcutEvidence));

	gates.push((calibration.known_shortcuts || []).length === 0
		? pass('known_shortcuts_resolved', 'No unresolved known shortcuts remain.')
		: fail('known_shortcuts_resolved', 'Benchmark-ready scenarios must resolve known shortcuts before headline promotion.', ['known_shortcuts_unresolved']));

	gates.push(calibration.held_out_private_variants_ready === true && split.membership === 'held_out_private'
		? pass('held_out_private_ready', 'Held-out private variants are ready and this scenario is in the held-out private split.', [split.held_out_private_variant?.reference].filter(Boolean))
		: fail('held_out_private_ready', 'Scenario must be held-out private and declare held_out_private_variants_ready=true.', ['held_out_private_variants_not_ready']));

	gates.push(calibration.task_contract_level === 'benchmark_replay'
		? pass('replay_contract_benchmark', 'Replay contract is benchmark_replay.')
		: fail('replay_contract_benchmark', 'Scenario task_contract_level must be benchmark_replay.', ['diagnostic_contract_only']));

	const expectedArtifacts = manifest.expected_artifacts || [];
	const missingReplayArtifacts = benchmarkReplayRequiredArtifacts.filter((artifact) => !expectedArtifacts.includes(artifact));
	gates.push(missingReplayArtifacts.length === 0 && expectedArtifacts.some((artifact) => benchmarkReplayStateArtifacts.includes(artifact))
		? pass('replay_artifacts_present', 'Scenario declares replay bundle, trace, grader result, and replayable state artifacts.', expectedArtifacts)
		: fail('replay_artifacts_present', 'Benchmark replay scenarios must declare replay-critical expected artifacts.', [
			...missingReplayArtifacts.map((artifact) => `missing_expected_artifact:${artifact}`),
			...(expectedArtifacts.some((artifact) => benchmarkReplayStateArtifacts.includes(artifact)) ? [] : ['missing_replayable_state_artifact']),
		], expectedArtifacts));

	const unsupportedActions = (manifest.episode_contract?.allowed_action_types || []).filter((actionType) => !benchmarkReplayActionTypes.includes(actionType));
	gates.push(unsupportedActions.length === 0
		? pass('replay_actions_supported', 'Scenario episode actions are supported by local replay.', manifest.episode_contract?.allowed_action_types || [])
		: fail('replay_actions_supported', 'Benchmark replay scenarios may only use locally replayable action types.', unsupportedActions.map((actionType) => `non_replayable_action_type:${actionType}`), manifest.episode_contract?.allowed_action_types || []));

	gates.push(hasVersionIdentity(calibration.benchmark_metadata)
		? pass('version_identity_present', 'Scenario benchmark metadata includes version identity hashes.')
		: fail('version_identity_present', 'Scenario benchmark metadata must include all version identity hashes.', ['missing_version_identity']));

	gates.push(Array.isArray(calibration.benchmark_blockers) && calibration.benchmark_blockers.length === 0
		? pass('scenario_blockers_empty', 'Scenario benchmark_blockers is empty.')
		: fail('scenario_blockers_empty', 'Scenario benchmark_blockers must be empty.', calibration.benchmark_blockers || ['benchmark_blockers_present']));

	return reportFromGates({
		target_type: 'scenario',
		target_id: manifest.id,
		target_file: scenario.file,
		source_sha256: sourceSha256ForTarget(scenario),
		gates,
	});
}

function evaluateTaskSet(taskSet, context = {}) {
	const manifest = taskSet.manifest;
	const scenariosById = context.scenariosById || new Map();
	const gates = [];
	const scenarioReports = [];

	gates.push(manifest.benchmark_status === 'benchmark_ready' && manifest.benchmark === true && manifest.headline_score_eligible === true && manifest.aggregate_score === true && manifest.score_scope === 'benchmark'
		? pass('task_set_status_benchmark_ready', 'Task set is benchmark-ready, headline eligible, aggregate scored, and benchmark scoped.', [taskSet.file])
		: fail('task_set_status_benchmark_ready', 'Task set must be benchmark_ready, benchmark=true, headline_score_eligible=true, aggregate_score=true, and score_scope=benchmark.', ['task_set_not_benchmark_ready'], [taskSet.file]));

	gates.push(manifest.task_contract_level === 'benchmark_replay'
		? pass('task_set_replay_contract_benchmark', 'Task-set contract level is benchmark_replay.')
		: fail('task_set_replay_contract_benchmark', 'Task set must declare task_contract_level=benchmark_replay.', ['diagnostic_contract_only']));

	gates.push(manifest.split_policy?.requires_held_out_private === true && (manifest.split_policy?.allowed_splits || []).includes('held_out_private')
		? pass('task_set_held_out_private_policy', 'Task set requires held-out private splits for headline scores.', manifest.split_policy.contamination_controls || [])
		: fail('task_set_held_out_private_policy', 'Task set split_policy must require and allow held_out_private splits.', ['headline_scores_need_held_out_private_policy']));

	gates.push(hasVersionIdentity(manifest.benchmark_metadata)
		? pass('task_set_version_identity_present', 'Task-set benchmark metadata includes version identity hashes.')
		: fail('task_set_version_identity_present', 'Task-set benchmark metadata must include all version identity hashes.', ['missing_version_identity']));

	gates.push(Array.isArray(manifest.benchmark_blockers) && manifest.benchmark_blockers.length === 0
		? pass('task_set_blockers_empty', 'Task-set benchmark_blockers is empty.')
		: fail('task_set_blockers_empty', 'Task-set benchmark_blockers must be empty.', manifest.benchmark_blockers || ['benchmark_blockers_present']));

	for (const task of manifest.tasks || []) {
		const scenario = scenariosById.get(task.scenario_id);
		if (!scenario) {
			scenarioReports.push({
				target_type: 'scenario',
				target_id: task.scenario_id,
				status: 'fail',
				blockers: ['missing_scenario_manifest'],
				gates: [fail('scenario_manifest_present', 'Task set references a missing scenario manifest.', ['missing_scenario_manifest'])],
			});
			continue;
		}
		scenarioReports.push(evaluateScenario(scenario, context));
	}

	const scenarioBlockers = [...new Set(scenarioReports.flatMap((report) => report.blockers.map((blocker) => `${report.target_id}:${blocker}`)))];
	gates.push(scenarioBlockers.length === 0
		? pass('included_scenarios_promotable', 'Every included scenario passes promotion gates.', scenarioReports.map((report) => report.target_file).filter(Boolean))
		: fail('included_scenarios_promotable', 'Every included scenario must pass promotion gates.', scenarioBlockers));

	const report = reportFromGates({
		target_type: 'task_set',
		target_id: manifest.id,
		target_file: taskSet.file,
		source_sha256: sourceSha256ForTarget(taskSet, scenariosById),
		gates,
	});
	report.scenarios = scenarioReports;
	return report;
}

function reportFromGates({ target_type, target_id, target_file, source_sha256, gates }) {
	const blockers = [...new Set(gates.flatMap((item) => item.blockers || []))].sort();
	return {
		schema_version: 1,
		generated_by: commandName,
		generated_at: new Date().toISOString(),
		target_type,
		target_id,
		target_file,
		status: blockers.length === 0 ? 'pass' : 'fail',
		source_sha256,
		blockers,
		gates,
	};
}

function promotionReportFragment(report) {
	return {
		generated_by: report.generated_by,
		generated_at: report.generated_at,
		target_type: report.target_type,
		target_id: report.target_id,
		status: report.status,
		source_sha256: report.source_sha256,
	};
}

function validateEmbeddedPromotionReport(target, scenariosById = new Map()) {
	const embedded = target.manifest.promotion_report || target.manifest.calibration?.promotion_report || null;
	const targetType = target.type || (target.manifest.scenario_manifests ? 'task_set' : 'scenario');
	const targetId = target.manifest.id;
	const expectedSourceSha256 = sourceSha256ForTarget({ ...target, type: targetType }, scenariosById);
	const gaps = [];

	if (!embedded) {
		gaps.push(fail('promotion_report_present', 'Benchmark-ready metadata must include a promotion_report fragment.', ['missing_promotion_report']));
		return { ok: false, expected_source_sha256: expectedSourceSha256, gaps };
	}

	if (embedded.generated_by !== commandName) {
		gaps.push(fail('promotion_report_command', `promotion_report.generated_by must be ${commandName}.`, ['invalid_promotion_report_command']));
	}
	if (embedded.target_type !== targetType || embedded.target_id !== targetId) {
		gaps.push(fail('promotion_report_target', 'promotion_report target must match the manifest target.', ['promotion_report_target_mismatch']));
	}
	if (embedded.status !== 'pass') {
		gaps.push(fail('promotion_report_status', 'promotion_report.status must be pass.', ['promotion_report_not_passing']));
	}
	if (embedded.source_sha256 !== expectedSourceSha256) {
		gaps.push(fail('promotion_report_freshness', 'promotion_report.source_sha256 is stale for the current manifest inputs.', ['stale_promotion_report']));
	}

	return { ok: gaps.length === 0, expected_source_sha256: expectedSourceSha256, gaps };
}

function buildContext(root) {
	return {
		root,
		scenariosById: loadScenarios(root),
		taskSetsById: loadTaskSets(root),
		shortcutCoverage: loadShortcutCoverage(root),
	};
}

function evaluatePromotionTarget({ root = moduleRoot, scenarioId = null, taskSetId = null } = {}) {
	const context = buildContext(root);
	if (scenarioId) {
		const scenario = context.scenariosById.get(scenarioId);
		if (!scenario) {
			throw new Error(`Unknown scenario: ${scenarioId}`);
		}
		return evaluateScenario({ ...scenario, file: repoRelative(root, scenario.file), type: 'scenario' }, context);
	}
	if (taskSetId) {
		const taskSet = context.taskSetsById.get(taskSetId);
		if (!taskSet) {
			throw new Error(`Unknown task set: ${taskSetId}`);
		}
		const relativeScenarios = new Map([...context.scenariosById].map(([id, scenario]) => [id, { ...scenario, file: repoRelative(root, scenario.file), type: 'scenario' }]));
		return evaluateTaskSet({ ...taskSet, file: repoRelative(root, taskSet.file), type: 'task_set' }, { ...context, scenariosById: relativeScenarios });
	}
	throw new Error('Expected --scenario <id> or --task-set <id>.');
}

function markdownReport(report) {
	const lines = [
		`# Benchmark Promotion Report: ${report.target_id}`,
		'',
		`- Target: ${report.target_type}`,
		`- Status: ${report.status}`,
		`- Source SHA-256: ${report.source_sha256}`,
		`- Blockers: ${report.blockers.length === 0 ? 'none' : report.blockers.join(', ')}`,
		'',
		'## Gates',
		'',
		'| Gate | Status | Blockers | Evidence |',
		'| --- | --- | --- | --- |',
	];
	for (const gateResult of report.gates) {
		lines.push(`| ${gateResult.code} | ${gateResult.status} | ${(gateResult.blockers || []).join(', ') || 'none'} | ${(gateResult.evidence || []).join('<br>') || 'none'} |`);
	}
	if (report.scenarios?.length) {
		lines.push('', '## Included Scenarios', '', '| Scenario | Status | Blockers |', '| --- | --- | --- |');
		for (const scenario of report.scenarios) {
			lines.push(`| ${scenario.target_id} | ${scenario.status} | ${scenario.blockers.join(', ') || 'none'} |`);
		}
	}
	lines.push('', '## Manifest Fragment', '', '```json', JSON.stringify({ promotion_report: promotionReportFragment(report) }, null, 2), '```');
	return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
	const args = { format: 'json', check: false };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--scenario') {
			args.scenarioId = argv[++i];
		} else if (arg === '--task-set') {
			args.taskSetId = argv[++i];
		} else if (arg === '--format') {
			args.format = argv[++i];
		} else if (arg === '--output') {
			args.output = argv[++i];
		} else if (arg === '--check') {
			args.check = true;
		} else if (arg === '--help' || arg === '-h') {
			args.help = true;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.error('Usage: node scripts/benchmark-promotion.mjs --scenario <id>|--task-set <id> [--format json|markdown] [--output <file>] [--check]');
		process.exit(0);
	}

	const report = evaluatePromotionTarget({ scenarioId: args.scenarioId, taskSetId: args.taskSetId });
	const output = args.format === 'markdown' ? markdownReport(report) : `${JSON.stringify(report, null, 2)}\n`;
	if (args.output) {
		fs.writeFileSync(args.output, output);
	} else {
		process.stdout.write(output);
	}
	if (args.check && report.status !== 'pass') {
		process.exit(1);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}

export {
	commandName,
	evaluatePromotionTarget,
	promotionReportFragment,
	validateEmbeddedPromotionReport,
};
