import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLiveArtifact, unwrapEvalArtifact } from './validate-live-artifacts.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hash64 = (digit) => digit.repeat(64);

function validProvenance(overrides = {}) {
	return {
		workflow: {
			repository: 'Automattic/wp-gym',
			path: '.github/workflows/datamachine-live-run.yml',
			ref: 'Automattic/wp-gym/.github/workflows/datamachine-live-run.yml@abcdef1234567890abcdef1234567890abcdef12',
			sha: 'abcdef1234567890abcdef1234567890abcdef12',
		},
		runner: {
			name: 'homeboy',
			version: '1.0.0-fixture',
			ref: 'abcdef1234567890abcdef1234567890abcdef12',
			sha: 'abcdef1234567890abcdef1234567890abcdef12',
		},
		runtime: {
			wordpress_version: '6.9.0-fixture',
			php_version: '8.3.0',
			node_version: '20.19.0',
			wp_codebox_version: '1.0.0-fixture',
			playground_version: '0.0.0-fixture',
			package_lock_sha256: '3da60c4e5ee6cae7822c77742d13a77ac7dcadfea7f022ba0a1a637580a7bbe8',
		},
		provider: {
			provider: 'openai',
			model: 'gpt-5.5',
			model_snapshot: 'gpt-5.5-2026-05-27-fixture',
		},
		provider_plugins: [],
		tool_policy: {
			sha256: hash64('b'),
			enabled_tools_sha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
			agent_instructions_sha256: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
		},
		inputs: {
			scenario_sha256: '3164081a1c9f26fddf60b3c79b054f8c10fe760b14e3ea8870964784fa9fb209',
			prompt_sha256: hash64('c'),
			grader_sha256: '9cb263f816f9089522b69c31f6a41fa88957c1b4aff6c6526b1a1c96f2cd7b2e',
			task_set_sha256: '016ef1f14ea60a6dc2a1395aff61230894dfbba965f83c5d80a365a4eb2cb6ef',
			bundle_sha256: hash64('a'),
		},
		...overrides,
	};
}

function baseArtifact(overrides = {}) {
	return {
		schema_version: 1,
		projection: {
			name: 'wp-gym-eval-artifact',
			issue: 'https://github.com/Automattic/wp-gym/issues/117',
			created_at: '2026-05-27T00:00:00Z',
		},
		status: {
			outcome: 'passed',
			failure_class: 'none',
			failure_reason: null,
			message: null,
		},
		runtime: {
			artifact_bundle: {
				id: 'bundle-123',
				schema_version: '1',
				created_at: '2026-05-27T00:00:00Z',
				runtime_id: 'wp-codebox',
				environment_id: 'wp-gym-test',
			},
			references: {},
		},
		runner: {
			provider: 'openai',
			model: 'gpt-5.5',
			agent_slug: 'wordpress-task-runner',
			bundle_sha256: hash64('a'),
			tool_policy_sha256: hash64('b'),
			workflow: { run_id: '123', run_url: 'https://github.com/Automattic/wp-gym/actions/runs/123' },
		},
		scenario: {
			id: 'block-markup-valid-semantic-blocks',
			label: 'Valid semantic blocks',
			task_family: 'block-markup',
			prompt_sha256: hash64('c'),
			rules: { general: ['wordpress_editable_blocks'], task_specific: ['semantic_content'] },
		},
		task_set: {
			id: 'benchmark-readiness-pilot',
			label: 'Benchmark readiness pilot',
			source_path: 'task-sets/benchmark-readiness-pilot.json',
		},
		grader: {
			success: true,
			reward: 1,
			grade: { score: 4, max_score: 4 },
			checks: [{ id: 'semantic_blocks', passed: true, score: 1, max_score: 1, failure_reason: null, message: null }],
			failure_reasons: [],
		},
		provenance: validProvenance(),
		reports: {},
		...overrides,
	};
}

assert.equal(unwrapEvalArtifact({ metadata: { eval_artifact: baseArtifact() } })?.projection.name, 'wp-gym-eval-artifact');

const missingArtifact = validateLiveArtifact({ metadata: {} });
assert.equal(missingArtifact.ok, false);
assert.equal(missingArtifact.compatibility_gaps[0].code, 'missing_eval_artifact');

const schemaOnly = validateLiveArtifact(baseArtifact());
assert.equal(schemaOnly.ok, true);
assert.equal(schemaOnly.validated_fields.find((field) => field.field === 'runner.model')?.value, 'gpt-5.5');

const projectedFailedSealedArtifact = unwrapEvalArtifact({
	runner_config: {
		artifact_export: {
			pr_template_values: {
				task_id: 'block-markup-valid-semantic-blocks',
				task_label: 'Valid semantic blocks',
				variant_family: 'block-markup-valid-semantic-blocks',
			},
		},
	},
	sealed_eval_artifact: {
		schema_name: 'homeboy.sealed_eval_artifact',
		schema_version: 1,
		generated_at: '2026-05-27T00:00:00Z',
		status: 'incomplete',
		runner: { workflow_run_url: 'https://github.com/Automattic/wp-gym/actions/runs/123', job_id: 'run-agent' },
		run: { job_status: 'failed - tool_result_failed' },
		task: { id: 'wordpress-task-runner-flow', label: 'Run wordpress-task-runner Data Machine agent' },
		model: { provider: 'openai', model: 'gpt-5.5' },
		hashes: {
			prompt: { sha256: hash64('c') },
			bundle: { sha256: hash64('a') },
			tool_policy: { sha256: hash64('b') },
		},
		grade: [],
		failure_reasons: [],
		termination: { state: 'failed - tool_result_failed' },
		wp_gym: {
			scenario: { id: 'wordpress-task-runner-flow', label: 'Run wordpress-task-runner Data Machine agent' },
			task_set: {},
			grader: { failure_reasons: [], checks: [] },
		},
	},
});
assert.equal(projectedFailedSealedArtifact.scenario.id, 'block-markup-valid-semantic-blocks');
assert.deepEqual(projectedFailedSealedArtifact.status, { outcome: 'failed', failure_class: 'task_failure', failure_reason: null, message: null });
assert.equal(projectedFailedSealedArtifact.grader.success, false);
assert.equal(projectedFailedSealedArtifact.grader.reward, 0);
assert.deepEqual(projectedFailedSealedArtifact.grader.grade, { score: 0, max_score: 1 });

const directFixture = await readFixture('direct-wp-gym-row.json');
const directFixtureResult = validateLiveArtifact(directFixture);
assert.equal(directFixtureResult.ok, true);

const redactedFixture = await readFixture('redacted-artifact.json');
const redactedFixtureResult = validateLiveArtifact(redactedFixture, { benchmarkMode: true, baseDir: path.join(root, 'fixtures/eval-artifacts'), expectedArtifacts: [] });
assert.equal(redactedFixtureResult.ok, true, JSON.stringify(redactedFixtureResult, null, 2));
assert(redactedFixtureResult.artifact_checks.some((check) => check.sensitive_scan === 'scanned' && check.redaction_status === 'redacted'));

const unsafeFixture = await readFixture('unsafe-artifact.json');
const unsafeFixtureResult = validateLiveArtifact(unsafeFixture, { benchmarkMode: true, baseDir: path.join(root, 'fixtures/eval-artifacts'), expectedArtifacts: [] });
assert.equal(unsafeFixtureResult.ok, false);
assert(unsafeFixtureResult.compatibility_gaps.some((item) => item.code === 'obvious_sensitive_artifact_marker'));

const sealedSensitiveFixture = await readFixture('sealed-sensitive-artifact.json');
const sealedSensitiveResult = validateLiveArtifact(sealedSensitiveFixture);
assert.equal(sealedSensitiveResult.ok, true);
const sealedSensitiveBenchmark = validateLiveArtifact(sealedSensitiveFixture, { benchmarkMode: true, baseDir: path.join(root, 'fixtures/eval-artifacts'), expectedArtifacts: [] });
assert(sealedSensitiveBenchmark.artifact_checks.some((check) => check.sealed_hash_only === true && check.ok === true));

const homeboyWrappedFixture = await readFixture('homeboy-wrapped-row.json');
const projectedHomeboy = unwrapEvalArtifact(homeboyWrappedFixture);
assert.equal(projectedHomeboy?.projection.name, 'wp-gym-eval-artifact');
assert.equal(projectedHomeboy?.projection.source_schema_name, 'homeboy.sealed_eval_artifact');
assert.equal(projectedHomeboy?.scenario.task_family, 'block-markup');
const homeboyWrappedResult = validateLiveArtifact(homeboyWrappedFixture, { benchmarkMode: true });
assert.equal(homeboyWrappedResult.ok, false);
assert(homeboyWrappedResult.compatibility_gaps.some((item) => item.code === 'remote_artifact_not_hashable_locally'));

const homeboyHashFallbackFixture = structuredClone(homeboyWrappedFixture);
delete homeboyHashFallbackFixture.sealed_eval_artifact.artifacts.hashes;
const projectedHashFallback = unwrapEvalArtifact(homeboyHashFallbackFixture);
assert.equal(projectedHashFallback?.reports.result_json[0].sha256, 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
assert.equal(projectedHashFallback?.runtime.references.replay_bundle[0].sha256, 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

const missingProjectionFixture = await readFixture('homeboy-missing-projection-fields.json');
const missingProjectionNonBenchmark = validateLiveArtifact(missingProjectionFixture);
assert.equal(missingProjectionNonBenchmark.ok, false);
assert(missingProjectionNonBenchmark.compatibility_gaps.some((item) => item.code === 'missing_homeboy_projection_field'));
const missingProjectionBenchmark = validateLiveArtifact(missingProjectionFixture, { benchmarkMode: true });
assert.equal(missingProjectionBenchmark.ok, false);
assert(missingProjectionBenchmark.compatibility_gaps.some((item) => item.code === 'missing_homeboy_projection_field' && item.severity === 'error'));

const validProvenanceFixture = await readProvenanceFixture('valid-immutable.json');
const validProvenanceResult = validateLiveArtifact(baseArtifact({ provenance: validProvenanceFixture }));
assert.equal(validProvenanceResult.ok, true);

const missingToolPolicyFixture = await readProvenanceFixture('missing-tool-policy-hash.json');
const missingToolPolicy = validateLiveArtifact(baseArtifact({ provenance: missingToolPolicyFixture }), { benchmarkMode: true });
assert.equal(missingToolPolicy.ok, false);
assert(missingToolPolicy.compatibility_gaps.some((item) => item.code === 'missing_benchmark_provenance_field' && item.field === 'provenance.tool_policy.sha256'));

const mutableWorkflowFixture = await readProvenanceFixture('mutable-workflow-ref.json');
const mutableWorkflow = validateLiveArtifact(baseArtifact({ provenance: mutableWorkflowFixture }), { benchmarkMode: true });
assert.equal(mutableWorkflow.ok, false);
assert(mutableWorkflow.compatibility_gaps.some((item) => item.code === 'missing_benchmark_provenance_field' && item.field === 'provenance.workflow.sha'));
assert(mutableWorkflow.compatibility_gaps.some((item) => item.code === 'mutable_provenance_ref' && item.field === 'provenance.workflow.ref'));

const mutableProviderFixture = await readProvenanceFixture('mutable-provider-ref.json');
const mutableProvider = validateLiveArtifact(baseArtifact({ provenance: mutableProviderFixture }), { benchmarkMode: true });
assert.equal(mutableProvider.ok, false);
assert(mutableProvider.compatibility_gaps.some((item) => item.code === 'mutable_provenance_ref' && item.field === 'provenance.provider_plugins[0].ref'));

const missingInputHash = validateLiveArtifact(baseArtifact({
	provenance: validProvenance({
		inputs: {
			...validProvenance().inputs,
			prompt_sha256: undefined,
			grader_sha256: undefined,
		},
	}),
}), { benchmarkMode: true });
assert.equal(missingInputHash.ok, false);
assert(missingInputHash.compatibility_gaps.some((item) => item.field === 'provenance.inputs.prompt_sha256'));
assert(missingInputHash.compatibility_gaps.some((item) => item.field === 'provenance.inputs.grader_sha256'));

const temp = await mkdtemp(path.join(os.tmpdir(), 'wp-gym-live-artifacts-'));
try {
	await writeFile(path.join(temp, 'result.json'), '{"ok":true}\n');
	await writeFile(path.join(temp, 'result-with-grade.json'), JSON.stringify({ grader: baseArtifact().grader }, null, 2));
	await writeFile(path.join(temp, 'replay.zip'), 'zip-bytes');
	await writeFile(path.join(temp, 'events.jsonl'), '{"event":"started"}\n');
	await writeFile(path.join(temp, 'wordpress-state.json'), '{"posts":[]}\n');
	const runnerSurface = await readFile(path.join(root, 'fixtures/runner-surface/visible-agent-surface.fixture.json'), 'utf8');
	await writeFile(path.join(temp, 'visible-agent-surface.json'), runnerSurface);

	const benchmarkArtifact = baseArtifact({
		runner: {
			...baseArtifact().runner,
			surface: {
				status: 'captured',
				producer_issue: 'https://github.com/Extra-Chill/homeboy-extensions/issues/842',
				reference: { kind: 'visible_agent_surface', path_or_url: 'visible-agent-surface.json', sha256: sha256(runnerSurface) },
			},
		},
		runtime: {
			...baseArtifact().runtime,
			references: {
				events: [{ kind: 'jsonl', path_or_url: 'events.jsonl', sha256: sha256('{"event":"started"}\n') }],
				observations: [{ kind: 'wordpress_state', path_or_url: 'wordpress-state.json', sha256: sha256('{"posts":[]}\n') }],
				replay_bundle: [{ kind: 'zip', path_or_url: 'replay.zip', sha256: sha256('zip-bytes') }],
			},
		},
		reports: {
			result_json: [{ kind: 'json', path_or_url: 'result-with-grade.json', sha256: sha256(JSON.stringify({ grader: baseArtifact().grader }, null, 2)) }],
		},
	});

	const benchmarkResult = validateLiveArtifact({ metadata: { eval_artifact: benchmarkArtifact } }, { benchmarkMode: true, baseDir: temp });
	assert.equal(benchmarkResult.ok, true);
	assert(benchmarkResult.artifact_checks.length >= 5);
	assert.equal(benchmarkResult.artifact_checks.filter((check) => 'hashable' in check).every((check) => check.hashable), true);
	assert(benchmarkResult.artifact_checks.some((check) => check.kind === 'visible_agent_surface' && check.ok === true));

	const pendingSurface = validateLiveArtifact(baseArtifact({
		runner: {
			...baseArtifact().runner,
			surface: {
				status: 'producer_pending',
				producer_issue: 'https://github.com/Extra-Chill/homeboy-extensions/issues/842',
			},
		},
	}), { benchmarkMode: true, baseDir: temp });
	assert.equal(pendingSurface.ok, false);
	assert(pendingSurface.compatibility_gaps.some((item) => item.code === 'visible_agent_surface_producer_pending' && item.severity === 'warning'));

	const missingGradePayload = structuredClone(benchmarkArtifact);
	missingGradePayload.reports.result_json[0] = { kind: 'json', path_or_url: 'result.json', sha256: sha256('{"ok":true}\n') };
	const missingGrade = validateLiveArtifact(missingGradePayload, { benchmarkMode: true, baseDir: temp });
	assert.equal(missingGrade.ok, false);
	assert(missingGrade.compatibility_gaps.some((item) => item.code === 'terminal_grade_missing'));

	const missingReplay = validateLiveArtifact(baseArtifact(), { benchmarkMode: true, baseDir: temp });
	assert.equal(missingReplay.ok, false);
	assert(missingReplay.compatibility_gaps.some((item) => item.code === 'missing_replay_critical_artifact'));

	const mismatchedHash = structuredClone(benchmarkArtifact);
	mismatchedHash.reports.result_json[0].sha256 = hash64('0');
	const mismatch = validateLiveArtifact(mismatchedHash, { benchmarkMode: true, baseDir: temp });
	assert.equal(mismatch.ok, false);
	assert(mismatch.compatibility_gaps.some((item) => item.code === 'artifact_hash_mismatch'));

	const missingExpectedArtifact = structuredClone(benchmarkArtifact);
	missingExpectedArtifact.runtime.references.observations = [];
	const missingExpected = validateLiveArtifact(missingExpectedArtifact, { benchmarkMode: true, baseDir: temp });
	assert.equal(missingExpected.ok, false);
	assert(missingExpected.compatibility_gaps.some((item) => item.code === 'missing_expected_artifact'));

	const missingLocalArtifact = structuredClone(benchmarkArtifact);
	missingLocalArtifact.runtime.references.observations[0].path_or_url = 'missing-wordpress-state.json';
	const missingLocal = validateLiveArtifact(missingLocalArtifact, { benchmarkMode: true, baseDir: temp });
	assert.equal(missingLocal.ok, false);
	assert(missingLocal.compatibility_gaps.some((item) => item.code === 'missing_local_artifact'));

	const remoteArtifact = structuredClone(benchmarkArtifact);
	remoteArtifact.runtime.references.observations[0] = { kind: 'wordpress_state', path_or_url: 'https://example.com/wordpress-state.json' };
	const remote = validateLiveArtifact(remoteArtifact, { benchmarkMode: true, baseDir: temp });
	assert.equal(remote.ok, false);
	assert(remote.compatibility_gaps.some((item) => item.code === 'remote_artifact_not_hashable_locally' && item.severity === 'error'));

	for (const [field, gapField, mutate] of [
		['reports.result_json', 'reports.result_json', (artifact) => {
			artifact.reports.result_json[0] = { kind: 'json', path_or_url: 'https://example.com/result.json' };
		}],
		['runtime.references.replay_bundle', 'reports.replay or runtime.references.replay_bundle', (artifact) => {
			artifact.runtime.references.replay_bundle[0] = { kind: 'zip', path_or_url: 'https://example.com/replay.zip' };
		}],
		['runtime.references.events', 'runtime.references.events', (artifact) => {
			artifact.runtime.references.events[0] = { kind: 'jsonl', path_or_url: 'https://example.com/events.jsonl' };
		}],
	]) {
		const remoteCritical = structuredClone(benchmarkArtifact);
		mutate(remoteCritical);
		const remoteCriticalResult = validateLiveArtifact(remoteCritical, { benchmarkMode: true, baseDir: temp });
		assert.equal(remoteCriticalResult.ok, false, `${field} remote references must fail benchmark mode`);
		assert(remoteCriticalResult.compatibility_gaps.some((item) => item.code === 'remote_artifact_not_hashable_locally' && item.field === gapField));
	}

	const missingHash = structuredClone(benchmarkArtifact);
	delete missingHash.runtime.references.observations[0].sha256;
	const noHash = validateLiveArtifact(missingHash, { benchmarkMode: true, baseDir: temp });
	assert.equal(noHash.ok, false);
	assert(noHash.compatibility_gaps.some((item) => item.code === 'missing_artifact_hash'));

	const gradeMismatchArtifact = structuredClone(benchmarkArtifact);
	await writeFile(path.join(temp, 'grade-mismatch.json'), JSON.stringify({
		grader: {
			...baseArtifact().grader,
			checks: [{ id: 'semantic_blocks', passed: true, score: 1, max_score: 1, failure_reason: null, message: 'changed', evidence: { source: 'fixture' } }],
		},
	}, null, 2));
	gradeMismatchArtifact.reports.result_json[0] = {
		kind: 'json',
		path_or_url: 'grade-mismatch.json',
		sha256: sha256(JSON.stringify({
			grader: {
				...baseArtifact().grader,
				checks: [{ id: 'semantic_blocks', passed: true, score: 1, max_score: 1, failure_reason: null, message: 'changed', evidence: { source: 'fixture' } }],
			},
		}, null, 2)),
	};
	const gradeMismatch = validateLiveArtifact(gradeMismatchArtifact, { benchmarkMode: true, baseDir: temp });
	assert.equal(gradeMismatch.ok, false);
	assert(gradeMismatch.compatibility_gaps.some((item) => item.code === 'terminal_grade_mismatch'));
} finally {
	await rm(temp, { recursive: true, force: true });
}

async function readFixture(name) {
	return JSON.parse(await readFile(path.join(root, 'fixtures/eval-artifacts', name), 'utf8'));
}

async function readProvenanceFixture(name) {
	return JSON.parse(await readFile(path.join(root, 'fixtures/provenance', name), 'utf8'));
}

console.log('Validated live artifact validator scaffold.');
