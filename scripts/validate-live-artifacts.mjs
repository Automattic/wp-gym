import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/eval-artifact.schema.json';
const canonicalProjectionName = 'wp-gym-eval-artifact';
const canonicalProjectionIssue = 'https://github.com/Automattic/wp-gym/issues/117';
const criticalReferenceGroups = [
	{
		field: 'reports.result_json',
		label: 'runner result JSON',
		refs: (artifact) => artifact.reports?.result_json || [],
	},
	{
		field: 'reports.replay or runtime.references.replay_bundle',
		label: 'replay bundle',
		refs: (artifact) => uniqueReferences([
			...(artifact.reports?.replay || []),
			...(artifact.runtime?.references?.replay_bundle || []),
		]),
	},
	{
		field: 'runtime.references.events',
		label: 'event log',
		refs: (artifact) => artifact.runtime?.references?.events || [],
	},
];

export function validateLiveArtifact(value, options = {}) {
	const benchmarkMode = Boolean(options.benchmarkMode);
	const baseDir = options.baseDir || root;
	const normalized = normalizeEvalArtifact(value, { benchmarkMode });
	const evalArtifact = normalized.artifact;
	const schemaValidation = validateSchema(evalArtifact);
	const compatibilityGaps = [...normalized.gaps];
	const artifactChecks = [];

	if (!evalArtifact) {
		return {
			ok: false,
			validated_fields: [],
			artifact_checks: [],
			compatibility_gaps: [gap('missing_eval_artifact', 'error', 'metadata.eval_artifact or sealed_eval_artifact', 'No eval artifact projection found.')],
			schema_errors: [],
		};
	}

	if (!schemaValidation.ok) {
		compatibilityGaps.push(
			...schemaValidation.errors.map((error) => gap('schema_mismatch', 'error', error.field, error.message))
		);
	}

	if (evalArtifact.projection?.issue !== canonicalProjectionIssue) {
		compatibilityGaps.push(gap(
			'legacy_projection_tracker',
			'warning',
			'projection.issue',
			`Projection should point at the canonical eval artifact row tracker ${canonicalProjectionIssue}.`
		));
	}

	if (benchmarkMode) {
		for (const group of criticalReferenceGroups) {
			const refs = group.refs(evalArtifact);
			if (!refs.length) {
				compatibilityGaps.push(gap(
					'missing_replay_critical_artifact',
					'error',
					group.field,
					`Benchmark-mode validation requires a ${group.label} reference when the runner can provide one.`
				));
				continue;
			}

			for (const reference of refs) {
				const check = validateArtifactReference(reference, baseDir, group.field);
				artifactChecks.push(check);
				if (!check.ok) {
					compatibilityGaps.push(...check.gaps);
				}
			}
		}
	}

	return {
		ok: schemaValidation.ok && !compatibilityGaps.some((item) => item.severity === 'error'),
		validated_fields: validatedFields(evalArtifact),
		artifact_checks: artifactChecks,
		compatibility_gaps: compatibilityGaps,
		schema_errors: schemaValidation.errors,
	};
}

export function unwrapEvalArtifact(value) {
	return normalizeEvalArtifact(value).artifact;
}

function normalizeEvalArtifact(value, options = {}) {
	const benchmarkMode = Boolean(options.benchmarkMode);
	if (value?.metadata?.eval_artifact) {
		return { artifact: value.metadata.eval_artifact, gaps: [] };
	}
	if (value?.eval_artifact) {
		return { artifact: value.eval_artifact, gaps: [] };
	}
	if (value?.schema_version === 1 && value?.projection?.name === canonicalProjectionName) {
		return { artifact: value, gaps: [] };
	}

	const sealed = findHomeboySealedArtifact(value);
	if (sealed) {
		return projectHomeboySealedArtifact(sealed, { benchmarkMode });
	}

	return { artifact: null, gaps: [] };
}

function findHomeboySealedArtifact(value) {
	const candidates = [
		value,
		value?.sealed_eval_artifact,
		value?.homeboy?.sealed_eval_artifact,
		value?.metadata?.sealed_eval_artifact,
		value?.metadata?.homeboy?.sealed_eval_artifact,
	];
	return candidates.find((candidate) => candidate?.schema_name === 'homeboy.sealed_eval_artifact') || null;
}

function projectHomeboySealedArtifact(sealed, options = {}) {
	const benchmarkMode = Boolean(options.benchmarkMode);
	const wpGym = sealed.wp_gym && typeof sealed.wp_gym === 'object' ? sealed.wp_gym : {};
	const gaps = [];
	const missing = (field, message) => {
		gaps.push(gap(
			'missing_homeboy_projection_field',
			benchmarkMode ? 'error' : 'warning',
			field,
			message
		));
	};
	const promptSha256 = normalizeSha256(sealed.hashes?.prompt?.sha256);
	const bundleSha256 = normalizeSha256(sealed.hashes?.bundle?.sha256);
	const toolPolicySha256 = normalizeSha256(sealed.hashes?.tool_policy?.sha256);
	const artifactReferences = normalizeHomeboyArtifactReferences(sealed.artifacts?.references || [], sealed.artifacts?.hashes || {});
	const scenario = { ...(wpGym.scenario || {}) };
	const taskSet = { ...(wpGym.task_set || {}) };
	const grader = { ...(wpGym.grader || {}) };

	if (!scenario.id && sealed.task?.id) {
		scenario.id = String(sealed.task.id);
	}
	if (!scenario.label && sealed.task?.label) {
		scenario.label = String(sealed.task.label);
	}
	if (!scenario.prompt_sha256 && promptSha256) {
		scenario.prompt_sha256 = promptSha256;
	}
	if (!scenario.rules && wpGym.rules) {
		scenario.rules = wpGym.rules;
	}
	if (!grader.grade && sealed.grade && typeof sealed.grade === 'object') {
		grader.grade = sealed.grade;
	}
	if (grader.reward === undefined && sealed.grade?.reward !== undefined) {
		grader.reward = sealed.grade.reward;
	}
	if (!Array.isArray(grader.failure_reasons) && Array.isArray(sealed.failure_reasons)) {
		grader.failure_reasons = sealed.failure_reasons;
	}
	if (!Array.isArray(grader.checks)) {
		grader.checks = [];
	}
	if (grader.success === undefined && typeof grader.reward === 'number') {
		grader.success = grader.reward >= 1;
	}
	if (!grader.grade && typeof grader.reward === 'number') {
		grader.grade = { score: grader.reward, max_score: 1 };
	}
	if (!Array.isArray(grader.failure_reasons)) {
		grader.failure_reasons = [];
	}

	for (const [field, message] of [
		['wp_gym.scenario.id', 'Homeboy sealed artifacts must carry the wp-gym scenario id or task id.'],
		['wp_gym.scenario.label', 'Homeboy sealed artifacts must carry the wp-gym scenario label or task label.'],
		['wp_gym.scenario.task_family', 'Homeboy sealed artifacts must carry the wp-gym task family.'],
		['hashes.prompt.sha256', 'Homeboy sealed artifacts must carry the prompt sha256.'],
		['wp_gym.scenario.rules', 'Homeboy sealed artifacts must carry the wp-gym rule policy.'],
		['wp_gym.task_set.id', 'Homeboy sealed artifacts must carry the wp-gym task-set id.'],
		['wp_gym.grader.success', 'Homeboy sealed artifacts must carry the projected grader success boolean.'],
		['wp_gym.grader.reward', 'Homeboy sealed artifacts must carry the projected reward.'],
		['wp_gym.grader.grade', 'Homeboy sealed artifacts must carry the projected grade object.'],
	]) {
		if (!hasPath({ wp_gym: wpGym, hashes: sealed.hashes }, field) && !hasProjectedField(field, { scenario, taskSet, grader })) {
			missing(`sealed_eval_artifact.${field}`, message);
		}
	}

	const status = wpGym.status || deriveStatus(sealed, grader);
	const artifactBundleId = sealed.hashes?.envelope ? `homeboy:${normalizeSha256(sealed.hashes.envelope) || sealed.hashes.envelope}` : `homeboy:${sealed.generated_at || 'sealed-eval-artifact'}`;

	return {
		artifact: {
			schema_version: 1,
			projection: {
				name: canonicalProjectionName,
				issue: canonicalProjectionIssue,
				created_at: sealed.generated_at || new Date(0).toISOString(),
				source_schema_name: 'homeboy.sealed_eval_artifact',
			},
			status,
			runtime: {
				artifact_bundle: {
					id: artifactBundleId,
					schema_version: sealed.schema_version || 1,
					created_at: sealed.generated_at || null,
					runtime_id: 'homeboy',
					environment_id: sealed.runner?.ref || null,
				},
				references: artifactReferences.runtime,
				source_fields: [{ target: 'runtime.references', source: 'sealed_eval_artifact.artifacts.references', owner: 'runner' }],
			},
			runner: {
				provider: sealed.model?.provider,
				model: sealed.model?.model,
				bundle_sha256: bundleSha256,
				tool_policy_sha256: toolPolicySha256,
				workflow: {
					run_url: sealed.runner?.workflow_run_url || null,
					job_id: sealed.runner?.job_id || sealed.run?.job_id || null,
				},
				source_fields: [{ target: 'runner', source: 'sealed_eval_artifact.runner/model/hashes', owner: 'runner' }],
			},
			scenario: {
				...scenario,
				source_fields: [{ target: 'scenario', source: 'sealed_eval_artifact.wp_gym.scenario', owner: 'wp-gym' }],
			},
			task_set: {
				...taskSet,
				source_fields: [{ target: 'task_set', source: 'sealed_eval_artifact.wp_gym.task_set', owner: 'wp-gym' }],
			},
			grader: {
				...grader,
				source_fields: [{ target: 'grader', source: 'sealed_eval_artifact.wp_gym.grader', owner: 'wp-gym' }],
			},
			reports: {
				workflow_run_url: sealed.runner?.workflow_run_url || null,
				result_json: artifactReferences.reports.result_json,
				replay: artifactReferences.reports.replay,
			},
		},
		gaps,
	};
}

function hasProjectedField(field, projected) {
	const aliases = {
		'wp_gym.scenario.id': projected.scenario.id,
		'wp_gym.scenario.label': projected.scenario.label,
		'wp_gym.scenario.task_family': projected.scenario.task_family,
		'hashes.prompt.sha256': projected.scenario.prompt_sha256,
		'wp_gym.scenario.rules': projected.scenario.rules,
		'wp_gym.task_set.id': projected.taskSet.id,
		'wp_gym.grader.success': projected.grader.success,
		'wp_gym.grader.reward': projected.grader.reward,
		'wp_gym.grader.grade': projected.grader.grade,
	};
	return aliases[field] !== undefined && aliases[field] !== null && aliases[field] !== '';
}

function hasPath(value, dottedPath) {
	let current = value;
	for (const part of dottedPath.split('.')) {
		if (!current || typeof current !== 'object' || !(part in current)) {
			return false;
		}
		current = current[part];
	}
	return current !== undefined && current !== null && current !== '';
}

function normalizeSha256(value) {
	if (typeof value !== 'string') {
		return null;
	}
	const normalized = value.replace(/^sha256:/, '');
	return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function deriveStatus(sealed, grader) {
	if (grader.success === true) {
		return { outcome: 'passed', failure_class: 'none', failure_reason: null, message: null };
	}
	if (grader.success === false) {
		return {
			outcome: 'failed',
			failure_class: 'task_failure',
			failure_reason: Array.isArray(grader.failure_reasons) && grader.failure_reasons.length ? grader.failure_reasons[0] : null,
			message: null,
		};
	}
	return {
		outcome: sealed.status === 'ready_for_replay' ? 'passed' : 'errored',
		failure_class: sealed.status === 'ready_for_replay' ? 'none' : 'runtime_failure',
		failure_reason: null,
		message: null,
	};
}

function normalizeHomeboyArtifactReferences(references, hashes) {
	const runtime = {};
	const reports = { result_json: [], replay: [] };
	for (const reference of references) {
		const name = String(reference.name || 'artifact');
		const pathOrUrl = reference.path || reference.path_or_url;
		if (!pathOrUrl) {
			continue;
		}
		const normalized = {
			kind: normalizeArtifactKind(reference.kind || name),
			path_or_url: pathOrUrl,
			sha256: normalizeSha256(hashes[name]?.sha256),
			source_field: `sealed_eval_artifact.artifacts.references.${name}`,
		};
		if (/result|bench/.test(name)) {
			reports.result_json.push(normalized);
		} else if (/replay|episode/.test(name)) {
			reports.replay.push(normalized);
			appendReference(runtime, 'replay_bundle', normalized);
		} else if (/event|jsonl|log/.test(name)) {
			appendReference(runtime, 'events', normalized);
		} else if (/transcript/.test(name)) {
			appendReference(runtime, 'transcript', normalized);
		} else if (/screenshot/.test(name)) {
			appendReference(runtime, 'screenshots', normalized);
		} else {
			appendReference(runtime, 'packages', normalized);
		}
	}
	return { runtime, reports };
}

function appendReference(target, field, reference) {
	if (!Array.isArray(target[field])) {
		target[field] = [];
	}
	target[field].push(reference);
}

function normalizeArtifactKind(kind) {
	return String(kind).replace(/[^a-z0-9_]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'artifact';
}

function uniqueReferences(references) {
	const seen = new Set();
	return references.filter((reference) => {
		const key = `${reference?.kind || ''}\n${reference?.path_or_url || ''}\n${reference?.sha256 || ''}`;
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

function validateSchema(value) {
	if (!value) {
		return { ok: false, errors: [] };
	}

	const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
	const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas/eval-artifact.schema.json'), 'utf8'));
	ajv.addSchema(schema);
	const validate = ajv.getSchema(schemaId);

	if (validate(value)) {
		return { ok: true, errors: [] };
	}

	return {
		ok: false,
		errors: (validate.errors || []).map((error) => ({
			field: error.instancePath || '/',
			message: `${error.instancePath || '/'} ${error.message}`,
		})),
	};
}

function validateArtifactReference(reference, baseDir, field) {
	const gaps = [];
	const target = reference?.path_or_url || '';
	const result = {
		field,
		kind: reference?.kind || null,
		path_or_url: target,
		local: false,
		hashable: false,
		sha256: reference?.sha256 || null,
		computed_sha256: null,
		ok: true,
		gaps,
	};

	if (!target) {
		gaps.push(gap('missing_artifact_path', 'error', field, 'Artifact reference is missing path_or_url.'));
		result.ok = false;
		return result;
	}

	if (/^https?:\/\//i.test(target)) {
		gaps.push(gap(
			'remote_artifact_not_hashable_locally',
			'warning',
			field,
			`${target} is remote; the scaffold records the reference but cannot hash it without downloaded artifacts.`
		));
		return result;
	}

	const resolved = path.resolve(baseDir, target);
	result.local = true;

	if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
		gaps.push(gap('missing_local_artifact', 'error', field, `${target} does not exist as a local file.`));
		result.ok = false;
		return result;
	}

	result.hashable = true;
	result.computed_sha256 = sha256File(resolved);

	if (!reference.sha256) {
		gaps.push(gap('missing_artifact_hash', 'error', field, `${target} is local and hashable but does not declare sha256.`));
		result.ok = false;
	} else if (reference.sha256 !== result.computed_sha256) {
		gaps.push(gap('artifact_hash_mismatch', 'error', field, `${target} sha256 does not match file contents.`));
		result.ok = false;
	}

	return result;
}

function validatedFields(artifact) {
	if (!artifact) {
		return [];
	}

	return [
		['projection.name', artifact.projection?.name],
		['projection.issue', artifact.projection?.issue],
		['status.outcome', artifact.status?.outcome],
		['status.failure_class', artifact.status?.failure_class],
		['runtime.artifact_bundle.id', artifact.runtime?.artifact_bundle?.id],
		['runner.provider', artifact.runner?.provider],
		['runner.model', artifact.runner?.model],
		['scenario.id', artifact.scenario?.id],
		['scenario.prompt_sha256', artifact.scenario?.prompt_sha256],
		['task_set.id', artifact.task_set?.id],
		['grader.success', artifact.grader?.success],
		['grader.reward', artifact.grader?.reward],
		['grader.checks', Array.isArray(artifact.grader?.checks) ? artifact.grader.checks.length : undefined],
	].map(([field, value]) => ({ field, present: value !== undefined && value !== null && value !== '', value }));
}

function gap(code, severity, field, message) {
	return { code, severity, field, message };
}

function sha256File(file) {
	return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function collectInputFiles(input) {
	const resolved = path.resolve(input);
	const stat = fs.statSync(resolved);
	if (stat.isFile()) {
		return [resolved];
	}
	if (!stat.isDirectory()) {
		throw new Error(`${input} is not a file or directory.`);
	}

	const files = [];
	for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
		const entryPath = path.join(resolved, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectInputFiles(entryPath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(entryPath);
		}
	}
	return files.sort();
}

function parseArgs(argv) {
	const args = { input: '', benchmarkMode: /^(1|true|yes)$/i.test(process.env.BENCHMARK_MODE || '') };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--input') {
			args.input = argv[++i];
		} else if (arg === '--benchmark-mode') {
			args.benchmarkMode = true;
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
		console.error('Usage: node scripts/validate-live-artifacts.mjs --input <result-json-or-artifact-dir> [--benchmark-mode]');
		process.exit(args.help ? 0 : 2);
	}

	const files = collectInputFiles(args.input);
	const results = files.map((file) => {
		const value = JSON.parse(fs.readFileSync(file, 'utf8'));
		return {
			file: path.relative(process.cwd(), file),
			...validateLiveArtifact(value, { benchmarkMode: args.benchmarkMode, baseDir: path.dirname(file) }),
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
