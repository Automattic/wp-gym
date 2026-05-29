import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unwrapEvalArtifact, validateLiveArtifact } from './validate-live-artifacts.mjs';
import { validateRunRegistryEntry } from './validate-run-registry.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256Buffer(buffer) {
	return createHash('sha256').update(buffer).digest('hex');
}

function sha256File(file) {
	return sha256Buffer(fs.readFileSync(file));
}

function stableValue(value) {
	if (Array.isArray(value)) {
		return value.map(stableValue);
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]));
	}
	return value;
}

function sha256Json(value) {
	return sha256Buffer(Buffer.from(JSON.stringify(stableValue(value))));
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

function evalArtifactRecords(value, sourceFile) {
	const records = [];
	const direct = unwrapEvalArtifact(value);
	if (direct) {
		records.push({ raw: value, evalArtifact: direct, sourceFile });
	}

	for (const [index, scenario] of (Array.isArray(value?.scenarios) ? value.scenarios : []).entries()) {
		const evalArtifact = unwrapEvalArtifact(scenario);
		if (evalArtifact) {
			records.push({
				raw: scenario,
				evalArtifact,
				sourceFile,
				sourceLabel: `${sourceFile}#scenarios[${index}]`,
			});
		}
	}

	return records;
}

function listScenarioFiles(dir = path.join(root, 'scenarios')) {
	if (!fs.existsSync(dir)) {
		return [];
	}
	const files = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...listScenarioFiles(entryPath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(entryPath);
		}
	}
	return files.sort();
}

function loadScenarioIndex() {
	const index = new Map();
	for (const file of listScenarioFiles()) {
		const scenario = readJson(file);
		if (scenario.id) {
			index.set(scenario.id, { file: repoRelative(file), manifest: scenario });
		}
	}
	return index;
}

function normalizeSha256(value) {
	return String(value || '').replace(/^sha256:/, '');
}

function slug(value) {
	return String(value || 'run').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'run';
}

function firstReference(evalArtifact, groups) {
	for (const group of groups) {
		const refs = group(evalArtifact);
		if (Array.isArray(refs) && refs.length > 0) {
			return refs[0];
		}
	}
	return null;
}

function localOrRemoteReference(reference, fallbackKind = 'json') {
	if (!reference || typeof reference !== 'object') {
		return null;
	}
	const target = reference.path_or_url || reference.path || reference.url || reference.href || '';
	if (!target) {
		return null;
	}
	return {
		kind: reference.kind || fallbackKind,
		path_or_url: target,
		sha256: normalizeSha256(reference.sha256 || reference.hash),
		...(reference.media_type ? { media_type: reference.media_type } : {}),
	};
}

function artifactEntry(name, category, reference, required = true) {
	if (!reference) {
		return null;
	}
	return {
		name,
		category,
		...reference,
		required,
	};
}

function taskSetMetadata(evalArtifact) {
	const sourcePath = evalArtifact.task_set?.source_path || `task-sets/${evalArtifact.task_set?.id}.json`;
	const resolved = path.join(root, sourcePath);
	const manifest = fs.existsSync(resolved) ? readJson(resolved) : {};
	return {
		id: evalArtifact.task_set?.id || manifest.id || 'unknown-task-set',
		version: manifest.benchmark_metadata?.benchmark_version || evalArtifact.task_set?.version || 'unversioned',
		sha256: fs.existsSync(resolved) ? sha256File(resolved) : normalizeSha256(evalArtifact.task_set?.sha256),
		source_path: sourcePath,
		benchmark_status: manifest.benchmark_status || evalArtifact.task_set?.benchmark_status || 'pilot',
		headline_score_eligible: Boolean(manifest.headline_score_eligible || evalArtifact.task_set?.headline_score_eligible),
		compatibility_group: manifest.benchmark_metadata?.compatibility_group || evalArtifact.task_set?.compatibility_group || evalArtifact.task_set?.id || 'unknown',
		aggregate_score: Boolean(manifest.aggregate_score || evalArtifact.task_set?.aggregate_score),
		benchmark: Boolean(manifest.benchmark || evalArtifact.task_set?.benchmark),
		benchmark_blockers: manifest.benchmark_blockers || evalArtifact.task_set?.benchmark_blockers || [],
	};
}

function scenarioMetadata(evalArtifact, scenarioIndex) {
	const indexed = scenarioIndex.get(evalArtifact.scenario?.id) || {};
	const manifest = indexed.manifest || {};
	const sourcePath = indexed.file || evalArtifact.scenario?.source_path || '';
	return {
		id: evalArtifact.scenario?.id || manifest.id || 'unknown-scenario',
		version: manifest.calibration?.benchmark_metadata?.benchmark_version || evalArtifact.scenario?.version || 'unversioned',
		sha256: sourcePath ? sha256File(path.join(root, sourcePath)) : normalizeSha256(evalArtifact.scenario?.sha256),
		source_path: sourcePath,
		prompt_sha256: normalizeSha256(evalArtifact.scenario?.prompt_sha256 || manifest.prompt_sha256),
		task_family: evalArtifact.scenario?.task_family || manifest.id?.split('-').slice(0, 2).join('-') || 'unknown',
		calibration: manifest.calibration || {},
	};
}

function benchmarkExclusionReasons(taskSet, scenario) {
	const reasons = [];
	if (!taskSet.benchmark) {
		reasons.push('pilot_task_set');
	}
	if (taskSet.benchmark_status !== 'benchmark_ready') {
		reasons.push(`task_set_status_${taskSet.benchmark_status || 'unknown'}`);
	}
	if (!taskSet.headline_score_eligible) {
		reasons.push('task_set_not_headline_eligible');
	}
	if (!taskSet.aggregate_score) {
		reasons.push('task_set_not_aggregate_score_eligible');
	}
	if (scenario.calibration?.status && scenario.calibration.status !== 'benchmark_ready') {
		reasons.push(`scenario_status_${scenario.calibration.status}`);
	}
	if (scenario.calibration?.benchmark_scope && scenario.calibration.benchmark_scope !== 'benchmark') {
		reasons.push(`scenario_scope_${scenario.calibration.benchmark_scope}`);
	}
	if (scenario.calibration?.headline_score_eligible === false) {
		reasons.push('scenario_not_headline_eligible');
	}
	for (const reason of taskSet.benchmark_blockers || []) {
		reasons.push(reason);
	}
	for (const reason of scenario.calibration?.benchmark_blockers || []) {
		reasons.push(reason);
	}
	return [...new Set(reasons)].sort();
}

function buildRegistryEntry({ evalArtifact, evalArtifactFile, sourceFile, replayReference, scenarioIndex }) {
	const taskSet = taskSetMetadata(evalArtifact);
	const scenario = scenarioMetadata(evalArtifact, scenarioIndex);
	const completedAt = evalArtifact.projection?.created_at || new Date().toISOString();
	const provider = evalArtifact.runner?.provider || 'unknown-provider';
	const model = evalArtifact.runner?.model || 'unknown-model';
	const runId = [evalArtifact.runner?.workflow?.run_id, scenario.id, provider, model].filter(Boolean).join('-') || `${scenario.id}-${provider}-${model}`;
	const evalReference = {
		kind: 'json',
		path_or_url: repoRelative(evalArtifactFile),
		sha256: sha256File(evalArtifactFile),
		media_type: 'application/json',
	};
	const resultReference = sourceFile ? {
		kind: 'json',
		path_or_url: repoRelative(sourceFile),
		sha256: sha256File(sourceFile),
		media_type: 'application/json',
	} : evalReference;
	const replay = replayReference || localOrRemoteReference(firstReference(evalArtifact, [
		(artifact) => artifact.reports?.replay,
		(artifact) => artifact.runtime?.references?.replay_bundle,
	]), 'json');
	const exclusionReasons = benchmarkExclusionReasons(taskSet, scenario);

	return {
		schema_version: 1,
		registry: {
			name: 'wp-gym-run-registry',
			issue: 'https://github.com/Automattic/wp-gym/issues/136',
			created_at: new Date().toISOString(),
		},
		run: {
			id: runId,
			actor: evalArtifact.runner?.agent_slug || 'unknown-agent',
			attempt: 1,
			started_at: evalArtifact.runtime?.artifact_bundle?.created_at || null,
			completed_at: completedAt,
			outcome: evalArtifact.status?.outcome || (evalArtifact.grader?.success ? 'passed' : 'failed'),
		},
		task_set: taskSet,
		scenario: Object.fromEntries(Object.entries(scenario).filter(([key]) => key !== 'calibration')),
		runner: {
			provider,
			model,
			agent_slug: evalArtifact.runner?.agent_slug || null,
			workflow_run_url: evalArtifact.runner?.workflow?.run_url || evalArtifact.reports?.workflow_run_url || null,
			job_id: evalArtifact.runner?.workflow?.job_id || null,
		},
		runtime: {
			id: evalArtifact.runtime?.artifact_bundle?.runtime_id || 'unknown-runtime',
			environment_id: evalArtifact.runtime?.artifact_bundle?.environment_id || null,
			artifact_bundle_id: evalArtifact.runtime?.artifact_bundle?.id || 'unknown-artifact-bundle',
		},
		grade_identity: {
			grader_sha256: evalArtifact.provenance?.inputs?.grader_sha256 || '0'.repeat(64),
			result_sha256: evalReference.sha256,
			success: Boolean(evalArtifact.grader?.success),
			reward: Number(evalArtifact.grader?.reward || 0),
			failure_class: evalArtifact.status?.failure_class || (evalArtifact.grader?.success ? 'none' : 'task_failure'),
		},
		calibration: {
			row_type: provider.includes('human') ? 'human_reference' : 'frontier_model',
			included: taskSet.benchmark_status !== 'excluded',
			status: taskSet.benchmark_status,
			result_set_id: scenario.calibration?.baseline_result_sets?.[0] || null,
		},
		benchmark: {
			eligible: exclusionReasons.length === 0,
			headline_score_eligible: Boolean(taskSet.headline_score_eligible && scenario.calibration?.headline_score_eligible),
			compatibility_group: taskSet.compatibility_group,
			exclusion_reasons: exclusionReasons,
		},
		eval_artifact: evalReference,
		artifact_index: {
			schema_version: 1,
			index_id: `${slug(runId)}/index`,
			created_at: new Date().toISOString(),
			entries: [
				artifactEntry('eval_artifact', 'eval_artifact', evalReference),
				artifactEntry('grade_artifact', 'grade', evalReference),
				artifactEntry('result_json', 'log', resultReference, false),
				artifactEntry('replay_bundle', 'replay', replay),
			].filter(Boolean),
		},
	};
}

function parseArgs(argv) {
	const args = { input: '', output: path.join(root, 'artifacts', 'wp-gym-run-registry'), replay: '', benchmarkMode: false, requireEntry: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--input') {
			args.input = argv[++index];
		} else if (arg === '--output') {
			args.output = argv[++index];
		} else if (arg === '--replay') {
			args.replay = argv[++index];
		} else if (arg === '--benchmark-mode') {
			args.benchmarkMode = true;
		} else if (arg === '--require-entry') {
			args.requireEntry = true;
		} else if (arg === '--help' || arg === '-h') {
			args.help = true;
		} else if (!args.input) {
			args.input = arg;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || !args.input) {
		console.error('Usage: node scripts/emit-run-registry.mjs --input <eval-json-or-dir> --output <registry-dir> [--replay <local-replay-file>] [--benchmark-mode] [--require-entry]');
		process.exit(args.help ? 0 : 2);
	}

	const output = path.resolve(args.output);
	const entriesDir = path.join(output, 'entries');
	const evalDir = path.join(output, 'eval-artifacts');
	const scenarioIndex = loadScenarioIndex();
	const files = collectJsonFiles(args.input);
	const replayReference = args.replay ? {
		kind: path.extname(args.replay) === '.zip' ? 'zip' : 'json',
		path_or_url: repoRelative(path.resolve(args.replay)),
		sha256: sha256File(path.resolve(args.replay)),
		media_type: path.extname(args.replay) === '.zip' ? 'application/zip' : 'application/json',
	} : null;
	const results = [];

	for (const file of files) {
		const raw = readJson(file);
		const records = evalArtifactRecords(raw, file);
		if (!records.length) {
			results.push({ file: repoRelative(file), emitted: false, reason: 'missing_eval_artifact' });
			continue;
		}
		for (const record of records) {
			const { evalArtifact } = record;
			const liveValidation = validateLiveArtifact(record.raw, { benchmarkMode: args.benchmarkMode, baseDir: path.dirname(file) });
			const id = slug([evalArtifact.runner?.workflow?.run_id, evalArtifact.scenario?.id, evalArtifact.runner?.provider, evalArtifact.runner?.model].filter(Boolean).join('-'));
			const evalArtifactFile = path.join(evalDir, `${id}.json`);
			writeJson(evalArtifactFile, evalArtifact);
			const entry = buildRegistryEntry({ evalArtifact, evalArtifactFile, sourceFile: file, replayReference, scenarioIndex });
			const registryValidation = validateRunRegistryEntry(entry, { benchmarkMode: args.benchmarkMode, baseDir: root });
			const entryFile = path.join(entriesDir, `${id}.json`);
			writeJson(entryFile, entry);
			results.push({
				file: repoRelative(file),
				source: record.sourceLabel ? repoRelative(record.sourceLabel) : repoRelative(file),
				entry: repoRelative(entryFile),
				eval_artifact: repoRelative(evalArtifactFile),
				emitted: true,
				live_artifact_ok: liveValidation.ok,
				registry_ok: registryValidation.ok,
				compatibility_gaps: [...liveValidation.compatibility_gaps, ...registryValidation.compatibility_gaps],
			});
		}
	}

	const emitted = results.filter((result) => result.emitted).length;
	const ok = (!args.requireEntry || emitted > 0) && results.every((result) => !result.emitted || (result.registry_ok && (!args.benchmarkMode || result.live_artifact_ok)));
	console.log(JSON.stringify({ ok, output: repoRelative(output), entries: emitted, results }, null, 2));
	if (!ok) {
		process.exit(1);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
