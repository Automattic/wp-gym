import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRunRegistryEntry } from './validate-run-registry.mjs';
import { aggregate, renderMarkdown } from './aggregate-run-registry.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const historicalFixture = path.join(root, 'fixtures/run-registry/valid-canonical-eval-artifact.json');
const localEvidencePattern = /(?:\/Users\/|\/home\/|https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0))/i;

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function copyRetainedFile(sourceRelativePath, tempRoot) {
	const source = path.join(root, sourceRelativePath);
	const target = path.join(tempRoot, sourceRelativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.copyFileSync(source, target);
}

function sha256File(file) {
	return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fixtureRun(id, overrides = {}) {
	const entry = structuredClone(readJson(historicalFixture));
	entry.run.id = id;
	entry.run.completed_at = overrides.completedAt;
	entry.run.outcome = overrides.outcome;
	entry.grade_identity.success = overrides.outcome === 'passed';
	entry.grade_identity.reward = overrides.reward;
	entry.grade_identity.failure_class = overrides.outcome === 'passed' ? 'none' : 'task_failure';
	if (entry.grade_identity.failure_class === 'task_failure' && entry.operations?.retry) {
		entry.operations.retry.disposition = 'task_terminal';
	}
	entry.artifact_index.index_id = `${id}/index`;
	entry.runner.workflow_run_url = `https://github.com/Automattic/wp-gym/actions/runs/${overrides.workflowRunId}`;
	return entry;
}

function retainedRunSet(tempRoot) {
	for (const source of [
		'task-sets/benchmark-readiness-pilot.json',
		'scenarios/block-markup/valid-semantic-blocks.json',
		'fixtures/eval-artifacts/direct-wp-gym-row.json',
		'fixtures/replay-regrade/valid-artifact.json',
		'fixtures/replay-regrade/tampered-grade-mismatch.json',
		'fixtures/replay-regrade/browser-editor-audit-trace.json',
		'fixtures/replay-regrade/episode-trace.json',
		'fixtures/replay-regrade/wordpress-state.json',
		'fixtures/replay-regrade/events.jsonl',
		'fixtures/replay-regrade/result.json',
		'fixtures/replay-regrade/replay.zip',
	]) {
		copyRetainedFile(source, tempRoot);
	}

	const entriesDir = path.join(tempRoot, 'artifacts/wp-gym-run-registry/entries');
	const entries = Array.from({ length: 30 }, (_, index) => {
		const attempt = index + 1;
		const passed = attempt % 5 !== 0;
		const entry = fixtureRun(`historical-2026-05-${String(attempt).padStart(2, '0')}-openai-gpt-5-5-valid-semantic-blocks`, {
			completedAt: `2026-05-${String(attempt).padStart(2, '0')}T00:01:00Z`,
			outcome: passed ? 'passed' : 'failed',
			reward: passed ? 1 : 0,
			workflowRunId: String(111111111 + index),
		});
		entry.run.attempt = attempt;
		entry.run.attempt_id = `historical-valid-semantic-blocks-attempt-${String(attempt).padStart(3, '0')}`;
		entry.run.attempt_count = 30;
		entry.run.result_set_id = 'historical-valid-semantic-blocks-retained-scale';
		entry.calibration.row_type = 'repeated_attempts';
		entry.calibration.model_tier = 'frontier_model';
		entry.calibration.result_set_id = entry.run.result_set_id;
		return entry;
	});

	for (const entry of entries) {
		writeJson(path.join(entriesDir, `${entry.run.id}.json`), entry);
	}

	return { entriesDir, entries };
}

function collectJsonFiles(dir) {
	return fs.readdirSync(dir)
		.filter((entry) => entry.endsWith('.json'))
		.map((entry) => path.join(dir, entry))
		.sort();
}

async function assertRetentionValidation(entries, tempRoot) {
	for (const entry of entries) {
		const result = await validateRunRegistryEntry(entry, { benchmarkMode: true, baseDir: tempRoot });
		assert.equal(result.ok, true, JSON.stringify(result, null, 2));
	}

	const missingReplay = structuredClone(entries[0]);
	missingReplay.artifact_index.entries.find((artifact) => artifact.name === 'replay_bundle').path_or_url = 'fixtures/replay-regrade/missing-artifact.json';
	const missingReplayResult = await validateRunRegistryEntry(missingReplay, { benchmarkMode: true, baseDir: tempRoot });
	assert.equal(missingReplayResult.ok, false);
	assert(missingReplayResult.compatibility_gaps.some((gap) => gap.code === 'missing_local_artifact' && gap.field.startsWith('artifact_index.entries')));

	const staleEvalArtifact = structuredClone(entries[0]);
	staleEvalArtifact.eval_artifact.sha256 = '0'.repeat(64);
	const staleEvalArtifactResult = await validateRunRegistryEntry(staleEvalArtifact, { benchmarkMode: true, baseDir: tempRoot });
	assert.equal(staleEvalArtifactResult.ok, false);
	assert(staleEvalArtifactResult.compatibility_gaps.some((gap) => gap.code === 'stale_artifact_hash' && gap.field === 'eval_artifact'));

	const unhashableTranscript = structuredClone(entries[0]);
	unhashableTranscript.artifact_index.entries.push({
		name: 'transcript',
		category: 'transcript',
		kind: 'jsonl',
		path_or_url: 'https://example.com/wp-gym/transcripts/historical.jsonl',
		required: true,
	});
	const unhashableTranscriptResult = await validateRunRegistryEntry(unhashableTranscript, { benchmarkMode: true, baseDir: tempRoot });
	assert.equal(unhashableTranscriptResult.ok, false);
	assert(unhashableTranscriptResult.compatibility_gaps.some((gap) => gap.code === 'remote_artifact_not_hashable_locally'));

	const graderMismatch = structuredClone(entries[0]);
	const tamperedAuditArtifact = readJson(path.join(tempRoot, 'fixtures/replay-regrade/tampered-grade-mismatch.json'));
	for (const references of [
		tamperedAuditArtifact.runtime.references.replay_trace,
		tamperedAuditArtifact.reports.replay,
	]) {
		references[0].path_or_url = 'browser-editor-audit-trace.json';
		references[0].sha256 = '0cc4ed19ffc66389cf6d19ffbd044e45c19a48865d378f14d2b501bb007af3bb';
	}
	const tamperedAuditPath = path.join(tempRoot, 'fixtures/replay-regrade/tampered-browser-audit-grade-mismatch.json');
	writeJson(tamperedAuditPath, tamperedAuditArtifact);
	const replayBundle = graderMismatch.artifact_index.entries.find((artifact) => artifact.name === 'replay_bundle');
	replayBundle.path_or_url = 'fixtures/replay-regrade/tampered-browser-audit-grade-mismatch.json';
	replayBundle.sha256 = sha256File(tamperedAuditPath);
	const graderMismatchResult = await validateRunRegistryEntry(graderMismatch, { benchmarkMode: true, regrade: true, baseDir: tempRoot });
	assert.equal(graderMismatchResult.ok, false);
	assert(graderMismatchResult.compatibility_gaps.some((gap) => gap.code === 'replay_regrade_drift'));
}

async function assertReportRegeneration(entriesDir) {
	const report = await aggregate(collectJsonFiles(entriesDir), {
		scope: 'all',
		benchmarkMode: true,
		includeInvalid: false,
		regrade: true,
		largeNMinAttempts: 30,
		baseDir: path.dirname(path.dirname(path.dirname(entriesDir))),
	});
	assert.equal(report.inputs.inspected, 30);
	assert.equal(report.inputs.accepted, 30);
	assert.equal(report.inputs.rejected, 0);
	assert.equal(report.overall.runs, 30);
	assert.equal(report.overall.passed, 24);
	assert.equal(report.overall.failed, 6);
	assert.equal(report.overall.reward_mean, 0.8);
	assert.equal(report.replay_regrade.enabled, true);
	assert.equal(report.replay_regrade.attempted, 30);
	assert.equal(report.replay_regrade.deterministic, 30);
	assert.equal(report.replay_regrade.success_rate, 1);
	assert.equal(report.replay_regrade.drift_rate, 0);
	assert.equal(report.replay_regrade.missing_artifacts, 0);
	assert.equal(report.replay_regrade.grader_mismatches, 0);
	assert.equal(report.large_n_calibration.min_attempts_per_model_tier, 30);
	assert.equal(report.large_n_calibration.by_model_tier.frontier_model.row_count, 30);
	assert.equal(report.large_n_calibration.by_model_tier.frontier_model.threshold_met, true);
	assert(report.rows.some((row) => row.run_id === 'historical-2026-05-01-openai-gpt-5-5-valid-semantic-blocks'));
	assert(report.rows.some((row) => row.run_id === 'historical-2026-05-30-openai-gpt-5-5-valid-semantic-blocks'));

	const markdown = renderMarkdown(report);
	assert(markdown.includes('Grader mismatches'));
	assert(markdown.includes('block-markup-valid-semantic-blocks'));
	assert(markdown.includes('openai/gpt-5.5'));
	assert.equal(localEvidencePattern.test(JSON.stringify(report)), false);
	assert.equal(localEvidencePattern.test(markdown), false);
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'wp-gym-artifact-retention-'));
try {
	const { entriesDir, entries } = retainedRunSet(tempRoot);
	await assertRetentionValidation(entries, tempRoot);
	await assertReportRegeneration(entriesDir);
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}

console.log('Validated historical artifact retention and report regeneration fixtures.');
