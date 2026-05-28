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

const directFixture = await readFixture('direct-wp-gym-row.json');
const directFixtureResult = validateLiveArtifact(directFixture);
assert.equal(directFixtureResult.ok, true);

const homeboyWrappedFixture = await readFixture('homeboy-wrapped-row.json');
const projectedHomeboy = unwrapEvalArtifact(homeboyWrappedFixture);
assert.equal(projectedHomeboy?.projection.name, 'wp-gym-eval-artifact');
assert.equal(projectedHomeboy?.projection.source_schema_name, 'homeboy.sealed_eval_artifact');
assert.equal(projectedHomeboy?.scenario.task_family, 'block-markup');
const homeboyWrappedResult = validateLiveArtifact(homeboyWrappedFixture, { benchmarkMode: true });
assert.equal(homeboyWrappedResult.ok, true);

const missingProjectionFixture = await readFixture('homeboy-missing-projection-fields.json');
const missingProjectionNonBenchmark = validateLiveArtifact(missingProjectionFixture);
assert.equal(missingProjectionNonBenchmark.ok, false);
assert(missingProjectionNonBenchmark.compatibility_gaps.some((item) => item.code === 'missing_homeboy_projection_field'));
const missingProjectionBenchmark = validateLiveArtifact(missingProjectionFixture, { benchmarkMode: true });
assert.equal(missingProjectionBenchmark.ok, false);
assert(missingProjectionBenchmark.compatibility_gaps.some((item) => item.code === 'missing_homeboy_projection_field' && item.severity === 'error'));

const temp = await mkdtemp(path.join(os.tmpdir(), 'wp-gym-live-artifacts-'));
try {
	await writeFile(path.join(temp, 'result.json'), '{"ok":true}\n');
	await writeFile(path.join(temp, 'replay.zip'), 'zip-bytes');
	await writeFile(path.join(temp, 'events.jsonl'), '{"event":"started"}\n');

	const benchmarkArtifact = baseArtifact({
		runtime: {
			...baseArtifact().runtime,
			references: {
				events: [{ kind: 'jsonl', path_or_url: 'events.jsonl', sha256: sha256('{"event":"started"}\n') }],
				replay_bundle: [{ kind: 'zip', path_or_url: 'replay.zip', sha256: sha256('zip-bytes') }],
			},
		},
		reports: {
			result_json: [{ kind: 'json', path_or_url: 'result.json', sha256: sha256('{"ok":true}\n') }],
		},
	});

	const benchmarkResult = validateLiveArtifact({ metadata: { eval_artifact: benchmarkArtifact } }, { benchmarkMode: true, baseDir: temp });
	assert.equal(benchmarkResult.ok, true);
	assert.equal(benchmarkResult.artifact_checks.length, 3);
	assert.equal(benchmarkResult.artifact_checks.every((check) => check.hashable), true);

	const missingReplay = validateLiveArtifact(baseArtifact(), { benchmarkMode: true, baseDir: temp });
	assert.equal(missingReplay.ok, false);
	assert(missingReplay.compatibility_gaps.some((item) => item.code === 'missing_replay_critical_artifact'));

	const mismatchedHash = structuredClone(benchmarkArtifact);
	mismatchedHash.reports.result_json[0].sha256 = hash64('0');
	const mismatch = validateLiveArtifact(mismatchedHash, { benchmarkMode: true, baseDir: temp });
	assert.equal(mismatch.ok, false);
	assert(mismatch.compatibility_gaps.some((item) => item.code === 'artifact_hash_mismatch'));
} finally {
	await rm(temp, { recursive: true, force: true });
}

async function readFixture(name) {
	return JSON.parse(await readFile(path.join(root, 'fixtures/eval-artifacts', name), 'utf8'));
}

console.log('Validated live artifact validator scaffold.');
