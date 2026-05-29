import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/eval-artifact.schema.json';
const visibleAgentSurfaceSchemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/visible-agent-surface.v1.schema.json';
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
const expectedArtifactReferenceFields = {
	wordpress_state: ['runtime.references.observations'],
	rendered_site: ['runtime.references.screenshots', 'runtime.references.observations'],
	builder_state: ['runtime.references.observations'],
	media_library: ['runtime.references.observations', 'runtime.references.packages'],
	tool_summary: ['runtime.references.commands'],
	final_response: ['runtime.references.transcript'],
	workspace_diff: ['runtime.references.patches'],
	plugin_files: ['runtime.references.packages', 'runtime.references.mounts'],
	grader_result: ['reports.result_json'],
};
const sensitiveValueRules = [
	{ code: 'private_key_marker', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i, label: 'private key material' },
	{ code: 'bearer_token_marker', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i, label: 'bearer token' },
	{ code: 'basic_auth_marker', pattern: /\bBasic\s+[A-Za-z0-9+/=]{12,}/i, label: 'basic auth header' },
	{ code: 'openai_key_marker', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/, label: 'provider API key' },
	{ code: 'github_token_marker', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/, label: 'GitHub token' },
	{ code: 'slack_token_marker', pattern: /\bxox(?:b|p|a|r|s)-[A-Za-z0-9-]{16,}\b/, label: 'Slack token' },
	{ code: 'wordpress_cookie_marker', pattern: /\bwordpress_(?:logged_in|sec|test_cookie|settings)[^=\s]*=/i, label: 'WordPress auth cookie' },
	{ code: 'nonce_query_marker', pattern: /(?:\?|&|\b)(?:_wpnonce|nonce|wp_nonce)=[A-Za-z0-9_-]{6,}/i, label: 'nonce value' },
	{ code: 'local_path_marker', pattern: /(?:\/Users\/[^\s"'<>]+|\/home\/[^\s"'<>]+|[A-Z]:\\\\Users\\\\[^\s"'<>]+)/, label: 'local filesystem path' },
	{ code: 'local_url_marker', pattern: /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|[^\s/"'<>]+\.(?:local|test|internal))(?:[:/][^\s"'<>]*)?/i, label: 'local or internal URL' },
];
const sensitiveKeyPattern = /(?:^|[_-])(?:authorization|cookie|set_cookie|x_wp_nonce|nonce|password|passwd|secret|api_key|apikey|access_token|refresh_token|id_token|client_secret|private_key|auth_token)(?:$|[_-])/i;
const maxSensitiveScanBytes = 2 * 1024 * 1024;

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
		const sensitivity = validateArtifactSensitivity(evalArtifact, baseDir);
		artifactChecks.push(...sensitivity.checks);
		compatibilityGaps.push(...sensitivity.gaps);

		const provenance = validateBenchmarkProvenance(evalArtifact);
		artifactChecks.push(...provenance.checks);
		compatibilityGaps.push(...provenance.gaps);

		const runnerSurface = validateRunnerSurface(evalArtifact, baseDir);
		artifactChecks.push(...runnerSurface.checks);
		compatibilityGaps.push(...runnerSurface.gaps);

		const expectedArtifacts = scenarioExpectedArtifacts(evalArtifact, options);
		for (const artifact of expectedArtifacts) {
			const matches = expectedArtifactReferences(evalArtifact, artifact);
			if (!matches.length) {
				compatibilityGaps.push(gap(
					'missing_expected_artifact',
					'error',
					`expected_artifacts.${artifact}`,
					`Benchmark-mode validation requires scenario expected_artifacts entry ${artifact}.`
				));
				continue;
			}

			for (const match of matches) {
				const check = validateArtifactReference(match.reference, baseDir, match.field, artifact);
				artifactChecks.push(check);
				compatibilityGaps.push(...check.gaps);
			}
		}

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
				compatibilityGaps.push(...check.gaps);
			}
		}

		const gradeAgreement = validateTerminalGradeAgreement(evalArtifact, baseDir);
		artifactChecks.push(...gradeAgreement.checks);
		compatibilityGaps.push(...gradeAgreement.gaps);
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
	const artifactReferences = normalizeHomeboyArtifactReferences(sealed.artifacts?.references || [], sealed.artifacts?.hashes || sealed.hashes?.artifact_hashes || {});
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
			provenance: sealed.provenance || undefined,
			reports: {
				workflow_run_url: sealed.runner?.workflow_run_url || null,
				result_json: artifactReferences.reports.result_json,
				replay: artifactReferences.reports.replay,
			},
		},
		gaps,
	};
}

function validateBenchmarkProvenance(evalArtifact) {
	const checks = [];
	const gaps = [];
	const provenance = evalArtifact.provenance;

	if (!provenance || typeof provenance !== 'object') {
		return {
			checks,
			gaps: [gap(
				'missing_benchmark_provenance',
				'error',
				'provenance',
				'Benchmark-mode rows must include pinned workflow, runtime, provider, tool-policy, and input provenance.'
			)],
		};
	}

	const requiredFields = [
		['provenance.workflow.repository', 'Benchmark provenance must name the workflow repository.'],
		['provenance.workflow.ref', 'Benchmark provenance must record the workflow ref that was executed.'],
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
		checks.push({ field, present: hasDottedPath({ provenance }, field), ok: hasDottedPath({ provenance }, field) });
		if (!hasDottedPath({ provenance }, field)) {
			gaps.push(gap('missing_benchmark_provenance_field', 'error', field, message));
		}
	}

	for (const field of [
		'provenance.workflow.sha',
		'provenance.runner.sha',
	]) {
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

	if (provenance.provider?.provider && provenance.provider.provider !== evalArtifact.runner?.provider) {
		gaps.push(gap('provenance_provider_mismatch', 'error', 'provenance.provider.provider', 'Provenance provider must match runner.provider.'));
	}
	if (provenance.provider?.model && provenance.provider.model !== evalArtifact.runner?.model) {
		gaps.push(gap('provenance_model_mismatch', 'error', 'provenance.provider.model', 'Provenance model must match runner.model.'));
	}
	if (provenance.tool_policy?.sha256 && evalArtifact.runner?.tool_policy_sha256 && provenance.tool_policy.sha256 !== evalArtifact.runner.tool_policy_sha256) {
		gaps.push(gap('provenance_tool_policy_mismatch', 'error', 'provenance.tool_policy.sha256', 'Tool-policy provenance must match runner.tool_policy_sha256.'));
	}
	if (provenance.inputs?.prompt_sha256 && evalArtifact.scenario?.prompt_sha256 && provenance.inputs.prompt_sha256 !== evalArtifact.scenario.prompt_sha256) {
		gaps.push(gap('provenance_prompt_mismatch', 'error', 'provenance.inputs.prompt_sha256', 'Prompt provenance must match scenario.prompt_sha256.'));
	}
	if (provenance.inputs?.bundle_sha256 && evalArtifact.runner?.bundle_sha256 && provenance.inputs.bundle_sha256 !== evalArtifact.runner.bundle_sha256) {
		gaps.push(gap('provenance_bundle_mismatch', 'error', 'provenance.inputs.bundle_sha256', 'Bundle provenance must match runner.bundle_sha256.'));
	}

	return { checks, gaps };
}

function validateImmutableReference(value, field, gaps) {
	if (!value || typeof value !== 'object') {
		return;
	}

	const ref = value.ref || '';
	const sha = value.sha || value.digest || '';
	if (ref && isMutableRef(ref) && !sha) {
		gaps.push(gap(
			'mutable_provenance_ref',
			'error',
			`${field}.ref`,
			`${field}.ref uses mutable ref ${ref}; benchmark-mode provenance requires an immutable ref, commit sha, or digest.`
		));
	}
}

function isMutableRef(ref) {
	const normalized = String(ref).trim();
	if (!normalized) {
		return false;
	}
	if (isGitSha(normalized) || /^sha256:[a-f0-9]{64}$/i.test(normalized)) {
		return false;
	}
	const refPart = normalized.includes('@') ? normalized.split('@').pop() : normalized;
	return /^(HEAD|main|master|trunk|dev|develop|latest)$/i.test(refPart)
		|| /^refs\/heads\//.test(refPart)
		|| /^release\//i.test(refPart);
}

function isGitSha(value) {
	return /^[a-f0-9]{40}([a-f0-9]{24})?$/i.test(String(value || ''));
}

function isSha256(value) {
	return /^[a-f0-9]{64}$/i.test(String(value || ''));
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

function hasDottedPath(value, dottedPath) {
	const current = getDottedPath(value, dottedPath);
	return current !== undefined && current !== null && current !== '';
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
		} else if (/wordpress[_-]?state|wp[_-]?state/.test(name)) {
			appendReference(runtime, 'observations', normalized);
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

function scenarioExpectedArtifacts(evalArtifact, options) {
	if (Array.isArray(options.expectedArtifacts)) {
		return options.expectedArtifacts;
	}
	if (Array.isArray(evalArtifact.scenario?.expected_artifacts)) {
		return evalArtifact.scenario.expected_artifacts;
	}

	const scenarioId = evalArtifact.scenario?.id;
	if (!scenarioId) {
		return [];
	}

	for (const scenarioFile of collectScenarioFiles(path.join(root, 'scenarios'))) {
		const manifest = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
		if (manifest.id === scenarioId && Array.isArray(manifest.expected_artifacts)) {
			return manifest.expected_artifacts;
		}
	}

	return [];
}

function collectScenarioFiles(dir) {
	const files = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectScenarioFiles(entryPath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(entryPath);
		}
	}
	return files;
}

function expectedArtifactReferences(evalArtifact, artifact) {
	const matches = [];
	for (const item of collectArtifactReferences(evalArtifact)) {
		if (item.reference?.source_field === artifact || item.reference?.kind === artifact) {
			matches.push(item);
		}
	}

	if (matches.length) {
		return matches;
	}

	const fields = expectedArtifactReferenceFields[artifact] || [];
	return collectArtifactReferences(evalArtifact).filter((item) => fields.includes(item.field));
}

function collectArtifactReferences(evalArtifact) {
	const references = [];
	for (const [field, refs] of [
		['reports.result_json', evalArtifact.reports?.result_json],
		['reports.replay', evalArtifact.reports?.replay],
		['runtime.references.events', evalArtifact.runtime?.references?.events],
		['runtime.references.commands', evalArtifact.runtime?.references?.commands],
		['runtime.references.observations', evalArtifact.runtime?.references?.observations],
		['runtime.references.mounts', evalArtifact.runtime?.references?.mounts],
		['runtime.references.patches', evalArtifact.runtime?.references?.patches],
		['runtime.references.packages', evalArtifact.runtime?.references?.packages],
		['runtime.references.screenshots', evalArtifact.runtime?.references?.screenshots],
		['runtime.references.transcript', evalArtifact.runtime?.references?.transcript],
		['runtime.references.replay_bundle', evalArtifact.runtime?.references?.replay_bundle],
		['runner.surface.reference', evalArtifact.runner?.surface?.reference ? [evalArtifact.runner.surface.reference] : []],
	]) {
		for (const reference of refs || []) {
			references.push({ field, reference });
		}
	}
	return references;
}

function validateRunnerSurface(evalArtifact, baseDir) {
	const surface = evalArtifact.runner?.surface;
	const checks = [];
	const gaps = [];
	if (!surface) {
		gaps.push(gap(
			'missing_visible_agent_surface',
			'warning',
			'runner.surface',
			'Benchmark audit cannot inspect the visible prompt/tool/workspace surface until Homeboy Extensions #842 emits the producer artifact.'
		));
		return { checks, gaps };
	}

	if (surface.producer_issue !== 'https://github.com/Extra-Chill/homeboy-extensions/issues/842') {
		gaps.push(gap('unexpected_runner_surface_producer', 'error', 'runner.surface.producer_issue', 'Runner surface artifacts must point at Homeboy Extensions #842.'));
	}

	if (surface.status === 'producer_pending' && !surface.reference) {
		gaps.push(gap('visible_agent_surface_producer_pending', 'warning', 'runner.surface', 'Only the fixture/schema contract is available; leave wp-gym issue #22 open until the producer artifact exists.'));
		return { checks, gaps };
	}

	if (surface.status !== 'captured' || !surface.reference) {
		gaps.push(gap('missing_visible_agent_surface_reference', 'error', 'runner.surface.reference', 'Captured runner surface metadata must include a local, hashable artifact reference.'));
		return { checks, gaps };
	}

	const referenceCheck = validateArtifactReference(surface.reference, baseDir, 'runner.surface.reference', 'runner_surface');
	checks.push(referenceCheck);
	gaps.push(...referenceCheck.gaps);
	if (!referenceCheck.ok || /^https?:\/\//i.test(surface.reference.path_or_url || '')) {
		return { checks, gaps };
	}

	const resolved = path.resolve(baseDir, surface.reference.path_or_url);
	const schemaCheck = validateVisibleAgentSurfaceSchema(resolved);
	checks.push(schemaCheck);
	gaps.push(...schemaCheck.gaps);
	return { checks, gaps };
}

function validateVisibleAgentSurfaceSchema(file) {
	const result = {
		field: 'runner.surface.reference',
		kind: 'visible_agent_surface',
		path_or_url: file,
		ok: true,
		gaps: [],
	};
	let value;
	try {
		value = JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (error) {
		pushCheckGap(result, 'invalid_visible_agent_surface_json', 'error', 'runner.surface.reference', `Visible agent surface artifact is not valid JSON: ${error.message}`);
		return result;
	}

	const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
	const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas/visible-agent-surface.v1.schema.json'), 'utf8'));
	ajv.addSchema(schema);
	const validate = ajv.getSchema(visibleAgentSurfaceSchemaId);
	if (!validate(value)) {
		for (const error of validate.errors || []) {
			pushCheckGap(result, 'visible_agent_surface_schema_mismatch', 'error', error.instancePath || '/', `${error.instancePath || '/'} ${error.message}`);
		}
	}
	if ((value.audit?.classification_counts?.task_sandbox_interference || 0) > 0) {
		pushCheckGap(result, 'visible_agent_surface_interference_found', 'warning', 'runner.surface.reference', 'Visible agent surface includes task-sandbox interference findings; inspect the audit before using the run as clean benchmark signal.');
	}
	return result;
}

function validateArtifactReference(reference, baseDir, field, expectedArtifact = null) {
	const gaps = [];
	const target = reference?.path_or_url || '';
	const result = {
		field,
		expected_artifact: expectedArtifact,
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
			'error',
			field,
			`${target} is remote; benchmark-mode validation requires local, hashable artifacts.`
		));
		result.ok = false;
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

function validateArtifactSensitivity(evalArtifact, baseDir) {
	const checks = [];
	const gaps = [];

	for (const { field, reference } of collectArtifactReferences(evalArtifact)) {
		const check = validateReferenceSensitivity(reference, baseDir, field);
		checks.push(check);
		gaps.push(...check.gaps);
	}

	return { checks, gaps };
}

function validateReferenceSensitivity(reference, baseDir, field) {
	const target = reference?.path_or_url || '';
	const declared = normalizeSensitivityDeclaration(reference);
	const check = {
		field,
		kind: reference?.kind || null,
		path_or_url: target,
		sharing_level: declared.sharingLevel,
		redaction_status: declared.redactionStatus,
		sealed_hash_only: declared.sealedHashOnly,
		sensitive_scan: 'skipped',
		ok: true,
		gaps: [],
	};

	if (declared.sealedHashOnly) {
		if (!reference?.sha256) {
			pushCheckGap(check, 'sealed_sensitive_reference_missing_hash', 'error', field, `${target || '(sealed reference)'} is sealed/hash-only but does not declare sha256.`);
		}
		return check;
	}

	if (!target || /^https?:\/\//i.test(target)) {
		return check;
	}

	const resolved = path.resolve(baseDir, target);
	if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
		return check;
	}

	const size = fs.statSync(resolved).size;
	if (size > maxSensitiveScanBytes) {
		check.sensitive_scan = 'skipped_large_file';
		pushCheckGap(check, 'sensitive_scan_skipped_large_file', 'warning', field, `${target} is larger than ${maxSensitiveScanBytes} bytes and was not scanned for sensitive markers.`);
		return check;
	}

	const content = fs.readFileSync(resolved, 'utf8');
	check.sensitive_scan = 'scanned';
	const findings = scanSensitiveContent(content);
	for (const finding of findings) {
		pushCheckGap(
			check,
			'obvious_sensitive_artifact_marker',
			'error',
			field,
			`${target} contains ${finding.label} at ${finding.location}; redact it or publish only a sealed hash reference.`
		);
	}

	return check;
}

function normalizeSensitivityDeclaration(reference = {}) {
	const redaction = reference.redaction && typeof reference.redaction === 'object' ? reference.redaction : {};
	const sharingLevel = reference.sharing_level || redaction.sharing_level || null;
	const redactionStatus = reference.redaction_status || redaction.status || null;
	const strategy = reference.redaction_strategy || redaction.strategy || null;
	return {
		sharingLevel,
		redactionStatus,
		sealedHashOnly: sharingLevel === 'sealed_hash_only' || strategy === 'sealed_hash_only',
	};
}

function scanSensitiveContent(content) {
	const findings = [];
	let parsed = null;
	try {
		parsed = JSON.parse(content);
	} catch {
		parsed = null;
	}

	if (parsed) {
		findings.push(...scanSensitiveJson(parsed));
	}

	for (const rule of sensitiveValueRules) {
		const match = content.match(rule.pattern);
		if (match) {
			findings.push({ code: rule.code, label: rule.label, location: `text offset ${match.index || 0}` });
		}
	}

	return uniqueSensitiveFindings(findings);
}

function scanSensitiveJson(value, trail = '$') {
	const findings = [];
	if (Array.isArray(value)) {
		value.forEach((item, index) => findings.push(...scanSensitiveJson(item, `${trail}[${index}]`)));
		return findings;
	}
	if (value && typeof value === 'object') {
		for (const [key, item] of Object.entries(value)) {
			const location = `${trail}.${key}`;
			if (sensitiveKeyPattern.test(key) && !isRedactedValue(item)) {
				findings.push({ code: 'sensitive_json_key', label: `sensitive JSON field ${key}`, location });
			}
			findings.push(...scanSensitiveJson(item, location));
		}
		return findings;
	}
	if (typeof value === 'string' && !isRedactedValue(value)) {
		for (const rule of sensitiveValueRules) {
			if (rule.pattern.test(value)) {
				findings.push({ code: rule.code, label: rule.label, location: trail });
			}
		}
	}
	return findings;
}

function isRedactedValue(value) {
	if (value === null || value === undefined) {
		return true;
	}
	if (typeof value !== 'string') {
		return false;
	}
	return /^\[(?:REDACTED|HASHED|SEALED)(?::[^\]]+)?\]$/i.test(value) || value === '';
}

function uniqueSensitiveFindings(findings) {
	const seen = new Set();
	return findings.filter((finding) => {
		const key = `${finding.code}\n${finding.location}`;
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

function pushCheckGap(check, code, severity, field, message) {
	const item = gap(code, severity, field, message);
	check.ok = false;
	check.gaps.push(item);
}

function validateTerminalGradeAgreement(evalArtifact, baseDir) {
	const checks = [];
	const gaps = [];

	for (const reference of evalArtifact.reports?.result_json || []) {
		const target = reference?.path_or_url || '';
		const check = {
			field: 'reports.result_json',
			kind: reference?.kind || null,
			path_or_url: target,
			terminal_grade_agreement: false,
			ok: true,
			gaps: [],
		};
		checks.push(check);

		if (!target || /^https?:\/\//i.test(target)) {
			continue;
		}

		const resolved = path.resolve(baseDir, target);
		if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
			continue;
		}

		let terminalGrade;
		try {
			terminalGrade = extractTerminalGrade(JSON.parse(fs.readFileSync(resolved, 'utf8')));
		} catch (error) {
			const item = gap('terminal_grade_unreadable', 'error', 'reports.result_json', `${target} could not be parsed as JSON: ${error.message}`);
			check.ok = false;
			check.gaps.push(item);
			gaps.push(item);
			continue;
		}

		if (!terminalGrade) {
			const item = gap(
				'terminal_grade_missing',
				'error',
				'reports.result_json',
				`${target} does not contain a grader payload for terminal grade agreement.`
			);
			check.ok = false;
			check.gaps.push(item);
			gaps.push(item);
			continue;
		}

		const expected = stableGradePayload(evalArtifact.grader);
		const actual = stableGradePayload(terminalGrade);
		check.terminal_grade_agreement = JSON.stringify(expected) === JSON.stringify(actual);
		if (!check.terminal_grade_agreement) {
			const item = gap(
				'terminal_grade_mismatch',
				'error',
				'grader',
				`${target} terminal grade output does not match metadata.eval_artifact.grader.`
			);
			check.ok = false;
			check.gaps.push(item);
			gaps.push(item);
		}
	}

	return { checks, gaps };
}

function extractTerminalGrade(value) {
	return value?.metadata?.eval_artifact?.grader || value?.eval_artifact?.grader || value?.grader || null;
}

function stableGradePayload(grader = {}) {
	return stableValue({
		success: grader.success,
		reward: grader.reward,
		failure_reasons: grader.failure_reasons || [],
		grade: grader.grade || {},
		checks: grader.checks || [],
		general_rule_results: grader.general_rule_results || [],
	});
}

function stableValue(value) {
	if (Array.isArray(value)) {
		return value.map(stableValue);
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, stableValue(item)])
		);
	}
	return value;
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
