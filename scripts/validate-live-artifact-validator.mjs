import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { validateLiveArtifact, unwrapEvalArtifact } from './validate-live-artifacts.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hash64 = (digit) => digit.repeat(64);

function baseArtifact(overrides = {}) {
	return {
		schema_version: 1,
		projection: {
			name: 'wp-gym-eval-artifact',
			issue: 'https://github.com/Automattic/wp-gym/issues/88',
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

const temp = await mkdtemp(path.join(os.tmpdir(), 'wp-gym-live-artifacts-'));
try {
	await writeFile(path.join(temp, 'result.json'), '{"ok":true}\n');
	await writeFile(path.join(temp, 'result-with-grade.json'), JSON.stringify({ grader: baseArtifact().grader }, null, 2));
	await writeFile(path.join(temp, 'replay.zip'), 'zip-bytes');
	await writeFile(path.join(temp, 'events.jsonl'), '{"event":"started"}\n');
	await writeFile(path.join(temp, 'wordpress-state.json'), '{"posts":[]}\n');

	const benchmarkArtifact = baseArtifact({
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
	assert.equal(remote.ok, true);
	assert(remote.compatibility_gaps.some((item) => item.code === 'remote_artifact_not_hashable_locally'));

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

console.log('Validated live artifact validator scaffold.');
