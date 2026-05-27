import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/eval-artifact.schema.json';
const criticalReferenceGroups = [
	{
		field: 'reports.result_json',
		label: 'runner result JSON',
		refs: (artifact) => artifact.reports?.result_json || [],
	},
	{
		field: 'reports.replay or runtime.references.replay_bundle',
		label: 'replay bundle',
		refs: (artifact) => [
			...(artifact.reports?.replay || []),
			...(artifact.runtime?.references?.replay_bundle || []),
		],
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
	const evalArtifact = unwrapEvalArtifact(value);
	const schemaValidation = validateSchema(evalArtifact);
	const compatibilityGaps = [];
	const artifactChecks = [];

	if (!evalArtifact) {
		return {
			ok: false,
			validated_fields: [],
			artifact_checks: [],
			compatibility_gaps: [gap('missing_eval_artifact', 'error', 'metadata.eval_artifact', 'No eval artifact projection found.')],
			schema_errors: [],
		};
	}

	if (!schemaValidation.ok) {
		compatibilityGaps.push(
			...schemaValidation.errors.map((error) => gap('schema_mismatch', 'error', error.field, error.message))
		);
	}

	if (evalArtifact.projection?.issue !== 'https://github.com/Automattic/wp-gym/issues/88') {
		compatibilityGaps.push(gap(
			'legacy_projection_tracker',
			'warning',
			'projection.issue',
			'Projection still points at the original eval-artifact tracker; live-run artifact validation is tracked by the intended title "Validate live-run artifacts against the canonical eval contract" until issue creation is unblocked.'
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
	if (value?.metadata?.eval_artifact) {
		return value.metadata.eval_artifact;
	}
	if (value?.eval_artifact) {
		return value.eval_artifact;
	}
	if (value?.schema_version === 1 && value?.projection?.name === 'wp-gym-eval-artifact') {
		return value;
	}
	return null;
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
