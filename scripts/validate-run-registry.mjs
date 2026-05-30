import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { replayRegradeInput } from './replay-regrade.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/run-registry-entry.v1.schema.json';
const registryFixtureRoot = path.join(root, 'fixtures', 'run-registry');

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256File(file) {
	return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function repoRelative(file) {
	return path.relative(root, file).replace(/\\/g, '/');
}

function collectJsonFiles(dir) {
	const files = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectJsonFiles(entryPath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(entryPath);
		}
	}
	return files.sort();
}

function createValidator() {
	const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
	ajv.addSchema(readJson(path.join(root, 'schemas/run-registry-entry.v1.schema.json')));
	const validate = ajv.getSchema(schemaId);
	if (!validate) {
		throw new Error(`Missing compiled schema: ${schemaId}`);
	}
	return validate;
}

function gap(code, severity, field, message) {
	return { code, severity, field, message };
}

function hasDottedPath(value, dottedPath) {
	let current = value;
	for (const part of dottedPath.split('.')) {
		if (!current || typeof current !== 'object' || !(part in current)) {
			return false;
		}
		current = current[part];
	}
	return current !== undefined && current !== null && current !== '';
}

function getDottedPath(value, dottedPath) {
	let current = value;
	for (const part of dottedPath.split('.')) {
		if (!current || typeof current !== 'object' || !(part in current)) {
			return undefined;
		}
		current = current[part];
	}
	return current;
}

function isGitSha(value) {
	return /^[a-f0-9]{40}([a-f0-9]{24})?$/i.test(String(value || ''));
}

function isSha256(value) {
	return /^[a-f0-9]{64}$/i.test(String(value || ''));
}

function isImmutableRef(value) {
	const ref = String(value || '').trim();
	if (!ref) {
		return false;
	}
	const refPart = ref.includes('@') ? ref.split('@').pop() : ref;
	return isGitSha(refPart) || /^sha256:[a-f0-9]{64}$/i.test(refPart);
}

function validateImmutableReference(value, field, gaps) {
	if (!value || typeof value !== 'object') {
		return;
	}
	if (value.ref && !isImmutableRef(value.ref)) {
		gaps.push(gap('mutable_provenance_ref', 'error', `${field}.ref`, `${field}.ref must be an immutable commit sha or digest, not ${value.ref}.`));
	}
	if (value.sha !== undefined && value.sha !== null && value.sha !== '' && !isGitSha(value.sha)) {
		gaps.push(gap('invalid_provenance_git_sha', 'error', `${field}.sha`, `${field}.sha must be a 40- or 64-character git sha.`));
	}
	if (value.digest !== undefined && value.digest !== null && value.digest !== '' && !/^sha256:[a-f0-9]{64}$/i.test(String(value.digest))) {
		gaps.push(gap('invalid_provenance_digest', 'error', `${field}.digest`, `${field}.digest must be a sha256 digest.`));
	}
}

function provenanceFingerprints(provenance = {}) {
	provenance = provenance && typeof provenance === 'object' ? provenance : {};
	return {
		workflow_sha: provenance.workflow?.sha || null,
		runner_sha: provenance.runner?.sha || null,
		runtime_package_lock_sha256: provenance.runtime?.package_lock_sha256 || null,
		provider: provenance.provider?.provider || null,
		model: provenance.provider?.model || null,
		model_snapshot: provenance.provider?.model_snapshot || provenance.provider?.snapshot || null,
		tool_policy_sha256: provenance.tool_policy?.sha256 || null,
		enabled_tools_sha256: provenance.tool_policy?.enabled_tools_sha256 || null,
		agent_instructions_sha256: provenance.tool_policy?.agent_instructions_sha256 || null,
		scenario_sha256: provenance.inputs?.scenario_sha256 || null,
		prompt_sha256: provenance.inputs?.prompt_sha256 || null,
		grader_sha256: provenance.inputs?.grader_sha256 || null,
		task_set_sha256: provenance.inputs?.task_set_sha256 || null,
		bundle_sha256: provenance.inputs?.bundle_sha256 || null,
	};
}

function validateBenchmarkProvenance(entry) {
	const gaps = [];
	const provenance = entry.provenance;
	if (!provenance || typeof provenance !== 'object') {
		return [gap('missing_benchmark_provenance', 'error', 'provenance', 'Benchmark-mode registry entries must include immutable workflow, runner, runtime, provider, tool-policy, and input provenance.')];
	}

	const requiredFields = [
		['provenance.workflow.repository', 'Benchmark provenance must name the workflow repository.'],
		['provenance.workflow.ref', 'Benchmark provenance must record the immutable workflow ref that was executed.'],
		['provenance.workflow.sha', 'Benchmark provenance must pin workflow code to an immutable commit sha.'],
		['provenance.runner.name', 'Benchmark provenance must name the runner/orchestrator.'],
		['provenance.runtime.wordpress_version', 'Benchmark provenance must record the WordPress version.'],
		['provenance.runtime.php_version', 'Benchmark provenance must record the PHP version.'],
		['provenance.runtime.node_version', 'Benchmark provenance must record the Node.js version.'],
		['provenance.runtime.wp_codebox_version', 'Benchmark provenance must record the WP Codebox/runtime package version.'],
		['provenance.runtime.package_lock_sha256', 'Benchmark provenance must hash the package lock used by the runner.'],
		['provenance.provider.provider', 'Benchmark provenance must record the provider.'],
		['provenance.provider.model', 'Benchmark provenance must record the model.'],
		['provenance.tool_policy.sha256', 'Benchmark provenance must hash the effective tool policy.'],
		['provenance.tool_policy.enabled_tools_sha256', 'Benchmark provenance must hash the enabled tool surface.'],
		['provenance.tool_policy.agent_instructions_sha256', 'Benchmark provenance must hash agent instructions.'],
		['provenance.inputs.scenario_sha256', 'Benchmark provenance must hash the scenario manifest.'],
		['provenance.inputs.prompt_sha256', 'Benchmark provenance must hash the model-facing prompt.'],
		['provenance.inputs.grader_sha256', 'Benchmark provenance must hash the hidden grader.'],
		['provenance.inputs.task_set_sha256', 'Benchmark provenance must hash the task-set manifest.'],
		['provenance.inputs.bundle_sha256', 'Benchmark provenance must hash the agent bundle.'],
	];

	for (const [field, message] of requiredFields) {
		if (!hasDottedPath({ provenance }, field)) {
			gaps.push(gap('missing_benchmark_provenance_field', 'error', field, message));
		}
	}

	for (const field of ['provenance.workflow.sha', 'provenance.runner.sha']) {
		const value = getDottedPath({ provenance }, field);
		if (value !== undefined && value !== null && value !== '' && !isGitSha(value)) {
			gaps.push(gap('invalid_provenance_git_sha', 'error', field, `${field} must be a 40- or 64-character git sha.`));
		}
	}

	for (const field of [
		'provenance.runtime.package_lock_sha256',
		'provenance.tool_policy.sha256',
		'provenance.tool_policy.enabled_tools_sha256',
		'provenance.tool_policy.agent_instructions_sha256',
		'provenance.inputs.scenario_sha256',
		'provenance.inputs.prompt_sha256',
		'provenance.inputs.grader_sha256',
		'provenance.inputs.task_set_sha256',
		'provenance.inputs.bundle_sha256',
	]) {
		const value = getDottedPath({ provenance }, field);
		if (value !== undefined && value !== null && value !== '' && !isSha256(value)) {
			gaps.push(gap('invalid_provenance_sha256', 'error', field, `${field} must be a sha256 hex digest.`));
		}
	}

	for (const pinned of [
		{ field: 'provenance.workflow', value: provenance.workflow },
		{ field: 'provenance.runner', value: provenance.runner },
		...(Array.isArray(provenance.provider_plugins) ? provenance.provider_plugins.map((value, index) => ({ field: `provenance.provider_plugins[${index}]`, value })) : []),
	]) {
		validateImmutableReference(pinned.value, pinned.field, gaps);
	}

	if (provenance.provider?.provider && provenance.provider.provider !== entry.runner?.provider) {
		gaps.push(gap('provenance_provider_mismatch', 'error', 'provenance.provider.provider', 'Provenance provider must match runner.provider.'));
	}
	if (provenance.provider?.model && provenance.provider.model !== entry.runner?.model) {
		gaps.push(gap('provenance_model_mismatch', 'error', 'provenance.provider.model', 'Provenance model must match runner.model.'));
	}
	if (provenance.tool_policy?.sha256 && entry.runner?.tool_policy_sha256 && provenance.tool_policy.sha256 !== entry.runner.tool_policy_sha256) {
		gaps.push(gap('provenance_tool_policy_mismatch', 'error', 'provenance.tool_policy.sha256', 'Tool-policy provenance must match runner.tool_policy_sha256.'));
	}
	if (provenance.inputs?.prompt_sha256 && entry.scenario?.prompt_sha256 && provenance.inputs.prompt_sha256 !== entry.scenario.prompt_sha256) {
		gaps.push(gap('provenance_prompt_mismatch', 'error', 'provenance.inputs.prompt_sha256', 'Prompt provenance must match scenario.prompt_sha256.'));
	}
	if (provenance.inputs?.grader_sha256 && entry.grade_identity?.grader_sha256 && provenance.inputs.grader_sha256 !== entry.grade_identity.grader_sha256) {
		gaps.push(gap('provenance_grader_mismatch', 'error', 'provenance.inputs.grader_sha256', 'Grader provenance must match grade_identity.grader_sha256.'));
	}
	if (provenance.inputs?.task_set_sha256 && entry.task_set?.sha256 && provenance.inputs.task_set_sha256 !== entry.task_set.sha256) {
		gaps.push(gap('provenance_task_set_mismatch', 'error', 'provenance.inputs.task_set_sha256', 'Task-set provenance must match task_set.sha256.'));
	}
	if (provenance.inputs?.scenario_sha256 && entry.scenario?.sha256 && provenance.inputs.scenario_sha256 !== entry.scenario.sha256) {
		gaps.push(gap('provenance_scenario_mismatch', 'error', 'provenance.inputs.scenario_sha256', 'Scenario provenance must match scenario.sha256.'));
	}

	return gaps;
}

function validateSchema(entry, validate) {
	if (validate(entry)) {
		return [];
	}
	return (validate.errors || []).map((error) => gap('schema_mismatch', 'error', error.instancePath || '/', `${error.instancePath || '/'} ${error.message}`));
}

function localReferencePath(reference, baseDir) {
	const target = reference?.path_or_url || '';
	if (!target || /^https?:\/\//i.test(target) || target.startsWith('sealed://')) {
		return null;
	}
	return path.resolve(baseDir, target);
}

function validateReference(reference, baseDir, field, benchmarkMode) {
	const gaps = [];
	const target = reference?.path_or_url || '';
	if (!target) {
		return [gap('missing_artifact_path', 'error', field, 'Artifact reference is missing path_or_url.')];
	}
	if (/^https?:\/\//i.test(target)) {
		if (benchmarkMode) {
			gaps.push(gap('remote_artifact_not_hashable_locally', 'error', field, `${target} is remote; benchmark-mode registry entries require local, hashable artifacts.`));
		}
		return gaps;
	}
	if (target.startsWith('sealed://')) {
		if (!reference.sha256) {
			gaps.push(gap('missing_artifact_hash', 'error', field, `${target} is sealed but does not declare sha256.`));
		}
		return gaps;
	}

	const resolved = localReferencePath(reference, baseDir);
	if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
		gaps.push(gap('missing_local_artifact', 'error', field, `${target} does not exist as a local file.`));
		return gaps;
	}
	if (!reference.sha256) {
		gaps.push(gap('missing_artifact_hash', 'error', field, `${target} is local and hashable but does not declare sha256.`));
		return gaps;
	}
	const computed = sha256File(resolved);
	if (reference.sha256 !== computed) {
		gaps.push(gap('stale_artifact_hash', 'error', field, `${target} sha256 does not match file contents.`));
	}
	return gaps;
}

function artifactEntries(entry) {
	return Array.isArray(entry?.artifact_index?.entries) ? entry.artifact_index.entries : [];
}

function replayReference(entry) {
	return artifactEntries(entry).find((artifact) => artifact.category === 'replay' || artifact.name === 'replay_bundle') || null;
}

async function validateReplayRegrade(entry, baseDir) {
	const reference = replayReference(entry);
	if (!reference) {
		return [];
	}

	const replayFile = localReferencePath(reference, baseDir);
	if (!replayFile || !fs.existsSync(replayFile) || !fs.statSync(replayFile).isFile()) {
		return [];
	}

	let result;
	try {
		result = await replayRegradeInput(replayFile, { benchmarkMode: true, regrade: true });
	} catch (error) {
		return [gap(
			'replay_regrade_failed',
			'error',
			'artifact_index.entries.replay',
			`Replay/regrade failed for ${reference.path_or_url}: ${error instanceof Error ? error.message : String(error)}.`
		)];
	}

	const gaps = [];
	for (const compatibilityGap of result.compatibility_gaps || []) {
		gaps.push(gap(
			'replay_regrade_failed',
			compatibilityGap.severity || 'error',
			'artifact_index.entries.replay',
			`Replay/regrade failed for ${reference.path_or_url}: ${compatibilityGap.message || compatibilityGap.code}.`
		));
	}
	for (const replayResult of result.results || []) {
		if (replayResult.ok) {
			continue;
		}
		const status = replayResult.regrade_status || {};
		gaps.push(gap(
			status.grade_drift ? 'replay_regrade_drift' : 'replay_regrade_failed',
			'error',
			'artifact_index.entries.replay',
			`Replay/regrade failed for ${reference.path_or_url}: ${status.failure_reason || status.compatibility_error_codes?.join(', ') || 'sealed artifact was not reproducible'}.`
		));
	}
	return gaps;
}

async function validateRunRegistryEntry(entry, options = {}) {
	const benchmarkMode = Boolean(options.benchmarkMode);
	const baseDir = options.baseDir || root;
	const validate = options.validate || createValidator();
	const gaps = validateSchema(entry, validate);

	if (benchmarkMode) {
		gaps.push(...validateBenchmarkProvenance(entry));
	}

	if (!entry.grade_identity) {
		gaps.push(gap('missing_grade_identity', 'error', 'grade_identity', 'Registry entries must identify the grader and result hashes used for scoring.'));
	}

	if (entry.calibration?.row_type === 'repeated_attempts') {
		if (!entry.run?.result_set_id || !entry.calibration?.result_set_id) {
			gaps.push(gap('missing_result_set_id', 'error', 'run.result_set_id', 'Repeated-attempt registry entries must identify the result set they belong to.'));
		} else if (entry.run.result_set_id !== entry.calibration.result_set_id) {
			gaps.push(gap('result_set_id_mismatch', 'error', 'calibration.result_set_id', 'Repeated-attempt run and calibration result set IDs must match.'));
		}
		if (!entry.run?.attempt_id) {
			gaps.push(gap('missing_attempt_id', 'error', 'run.attempt_id', 'Repeated-attempt registry entries must record a stable attempt ID.'));
		}
		if (!Number.isInteger(entry.run?.attempt_count) || entry.run.attempt_count < 2) {
			gaps.push(gap('incomplete_repeated_attempt_set', 'error', 'run.attempt_count', 'Repeated-attempt registry entries must declare at least two attempts in the result set.'));
		}
		if (entry.run?.attempt > entry.run?.attempt_count) {
			gaps.push(gap('attempt_index_out_of_range', 'error', 'run.attempt', 'Attempt index cannot exceed attempt_count.'));
		}
	}

	if (!artifactEntries(entry).some((artifact) => artifact.category === 'replay' || artifact.name === 'replay_bundle')) {
		gaps.push(gap('missing_replay_bundle', 'error', 'artifact_index.entries', 'Registry entries must include a replay bundle entry.'));
	}

	if (entry.eval_artifact) {
		gaps.push(...validateReference(entry.eval_artifact, baseDir, 'eval_artifact', benchmarkMode));
	}

	for (const [index, artifact] of artifactEntries(entry).entries()) {
		gaps.push(...validateReference(artifact, baseDir, `artifact_index.entries[${index}]`, benchmarkMode));
	}

	for (const [field, manifest] of [
		['scenario', entry.scenario],
		['task_set', entry.task_set],
	]) {
		if (!manifest?.source_path || !manifest?.sha256) {
			continue;
		}
		if (manifest.source_path.startsWith('sealed://')) {
			continue;
		}
		const resolved = path.resolve(baseDir, manifest.source_path);
		if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
			gaps.push(gap('missing_manifest_source', 'error', `${field}.source_path`, `${manifest.source_path} does not exist as a local file.`));
			continue;
		}
		const computed = sha256File(resolved);
		if (computed !== manifest.sha256) {
			gaps.push(gap('manifest_hash_mismatch', 'error', `${field}.sha256`, `${field} sha256 does not match ${manifest.source_path}.`));
		}
	}

	if (entry.scenario?.id && entry.eval_artifact?.path_or_url) {
		const evalArtifactFile = localReferencePath(entry.eval_artifact, baseDir);
		if (evalArtifactFile && fs.existsSync(evalArtifactFile)) {
			const evalArtifact = readJson(evalArtifactFile);
			if (evalArtifact.scenario?.id && evalArtifact.scenario.id !== entry.scenario.id) {
				gaps.push(gap('eval_artifact_scenario_mismatch', 'error', 'eval_artifact.scenario.id', `Eval artifact scenario ${evalArtifact.scenario.id} does not match registry scenario ${entry.scenario.id}.`));
			}
			if (evalArtifact.task_set?.id && evalArtifact.task_set.id !== entry.task_set?.id) {
				gaps.push(gap('eval_artifact_task_set_mismatch', 'error', 'eval_artifact.task_set.id', `Eval artifact task set ${evalArtifact.task_set.id} does not match registry task set ${entry.task_set?.id}.`));
			}
			if (entry.grade_identity?.result_sha256 && entry.grade_identity.result_sha256 !== entry.eval_artifact.sha256) {
				gaps.push(gap('grade_result_hash_mismatch', 'error', 'grade_identity.result_sha256', 'grade_identity.result_sha256 must match the canonical eval artifact reference hash.'));
			}
		}
	}

	if (options.regrade && !gaps.some((item) => item.severity === 'error')) {
		gaps.push(...await validateReplayRegrade(entry, baseDir));
	}

	return {
		ok: !gaps.some((item) => item.severity === 'error'),
		immutable_fingerprints: provenanceFingerprints(entry.provenance),
		compatibility_gaps: gaps,
	};
}

function parseArgs(argv) {
	const args = { input: registryFixtureRoot, benchmarkMode: /^(1|true|yes)$/i.test(process.env.BENCHMARK_MODE || ''), regrade: false };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--input') {
			args.input = path.resolve(argv[++i]);
		} else if (arg === '--benchmark-mode') {
			args.benchmarkMode = true;
		} else if (arg === '--regrade') {
			args.regrade = true;
			args.benchmarkMode = true;
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
		console.error('Usage: node scripts/validate-run-registry.mjs [--input <registry-json-or-dir>] [--benchmark-mode] [--regrade]');
		process.exit(0);
	}

	const validate = createValidator();
	const inputStat = fs.statSync(args.input);
	const files = inputStat.isFile() ? [args.input] : collectJsonFiles(args.input);
	const results = [];
	for (const file of files) {
		const entry = readJson(file);
		const expectedErrors = entry._expected_error_codes || [];
		const result = await validateRunRegistryEntry(entry, { benchmarkMode: args.benchmarkMode, regrade: args.regrade, baseDir: root, validate });
		const actualCodes = new Set(result.compatibility_gaps.map((item) => item.code));
		const expectedSatisfied = expectedErrors.every((code) => actualCodes.has(code));
		const expectedInvalid = expectedErrors.length > 0;
		const ok = expectedInvalid ? !result.ok && expectedSatisfied : result.ok;
		results.push({
			file: repoRelative(file),
			ok,
			valid: result.ok,
			immutable_fingerprints: result.immutable_fingerprints,
			expected_error_codes: expectedErrors,
			compatibility_gaps: result.compatibility_gaps,
		});
	}

	const ok = results.every((result) => result.ok);
	console.log(JSON.stringify({ ok, benchmark_mode: args.benchmarkMode, results }, null, 2));
	if (!ok) {
		process.exit(1);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}

export { provenanceFingerprints, validateRunRegistryEntry };
