import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

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

function validateRunRegistryEntry(entry, options = {}) {
	const benchmarkMode = Boolean(options.benchmarkMode);
	const baseDir = options.baseDir || root;
	const validate = options.validate || createValidator();
	const gaps = validateSchema(entry, validate);

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

	return {
		ok: !gaps.some((item) => item.severity === 'error'),
		compatibility_gaps: gaps,
	};
}

function parseArgs(argv) {
	const args = { input: registryFixtureRoot, benchmarkMode: /^(1|true|yes)$/i.test(process.env.BENCHMARK_MODE || '') };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--input') {
			args.input = path.resolve(argv[++i]);
		} else if (arg === '--benchmark-mode') {
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
		console.error('Usage: node scripts/validate-run-registry.mjs [--input <registry-json-or-dir>] [--benchmark-mode]');
		process.exit(0);
	}

	const validate = createValidator();
	const inputStat = fs.statSync(args.input);
	const files = inputStat.isFile() ? [args.input] : collectJsonFiles(args.input);
	const results = files.map((file) => {
		const entry = readJson(file);
		const expectedErrors = entry._expected_error_codes || [];
		const result = validateRunRegistryEntry(entry, { benchmarkMode: args.benchmarkMode, baseDir: root, validate });
		const actualCodes = new Set(result.compatibility_gaps.map((item) => item.code));
		const expectedSatisfied = expectedErrors.every((code) => actualCodes.has(code));
		const expectedInvalid = expectedErrors.length > 0;
		const ok = expectedInvalid ? !result.ok && expectedSatisfied : result.ok;
		return {
			file: repoRelative(file),
			ok,
			valid: result.ok,
			expected_error_codes: expectedErrors,
			compatibility_gaps: result.compatibility_gaps,
		};
	});

	const ok = results.every((result) => result.ok);
	console.log(JSON.stringify({ ok, benchmark_mode: args.benchmarkMode, results }, null, 2));
	if (!ok) {
		process.exit(1);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}

export { validateRunRegistryEntry };
