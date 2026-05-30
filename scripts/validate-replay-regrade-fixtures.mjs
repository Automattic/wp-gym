import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { replayRegradeArtifactFile } from './replay-regrade.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = path.join(root, 'fixtures/replay-regrade');

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function localizeFixtureReferences(artifact) {
	for (const section of [artifact.runtime?.references, artifact.reports]) {
		for (const references of Object.values(section || {})) {
			if (!Array.isArray(references)) {
				continue;
			}
			for (const reference of references) {
				if (reference.path_or_url && !path.isAbsolute(reference.path_or_url) && !/^https?:\/\//i.test(reference.path_or_url)) {
					reference.path_or_url = path.join(fixtureRoot, reference.path_or_url);
				}
			}
		}
	}
	return artifact;
}

const valid = await replayRegradeArtifactFile(path.join(fixtureRoot, 'valid-artifact.json'), { benchmarkMode: true });
assert.equal(valid.ok, true, JSON.stringify(valid, null, 2));
assert.equal(valid.replay.comparison.ok, true);
assert.equal(valid.replay.phase, 'full_episode_replay_regrade');
assert.deepEqual(valid.regrade_status, {
	outcome: 'passed',
	failure_class: 'none',
	failure_reason: null,
	grade_drift: false,
	compatibility_error_codes: [],
});
assert.equal(valid.replay.trace_reference.step_count, 2);
assert.equal(valid.replay.episode_replay.ok, true);
assert.equal(valid.replay.episode_replay.step_comparison.ok, true);

const tampered = await replayRegradeArtifactFile(path.join(fixtureRoot, 'tampered-grade-mismatch.json'), { benchmarkMode: true });
assert.equal(tampered.ok, false);
assert(tampered.compatibility_gaps.some((gap) => gap.code === 'grade_mismatch'));
assert.equal(tampered.regrade_status.failure_class, 'replay_incompatibility');
assert.equal(tampered.regrade_status.grade_drift, true);
assert(tampered.replay.comparison.mismatches.some((mismatch) => mismatch.field === 'success'));

const temp = await mkdtemp(path.join(os.tmpdir(), 'wp-gym-replay-regrade-'));
try {
	const missingStateFile = path.join(temp, 'missing-state.json');
	const missingStateArtifact = JSON.parse(await readFile(path.join(fixtureRoot, 'valid-artifact.json'), 'utf8'));
	delete missingStateArtifact.runtime.references.observations;
	await writeFile(missingStateFile, JSON.stringify(missingStateArtifact, null, 2));

	const missingState = await replayRegradeArtifactFile(missingStateFile, { benchmarkMode: true });
	assert.equal(missingState.ok, false);
	assert.equal(missingState.regrade_status.failure_class, 'replay_incompatibility');
	assert(missingState.compatibility_gaps.some((gap) => gap.code === 'missing_wordpress_state_evidence'));

	const missingTraceFile = path.join(temp, 'missing-trace.json');
	const missingTraceArtifact = localizeFixtureReferences(JSON.parse(await readFile(path.join(fixtureRoot, 'valid-artifact.json'), 'utf8')));
	delete missingTraceArtifact.runtime.references.replay_trace;
	delete missingTraceArtifact.reports.replay;
	await writeFile(missingTraceFile, JSON.stringify(missingTraceArtifact, null, 2));

	const missingTrace = await replayRegradeArtifactFile(missingTraceFile, { benchmarkMode: true });
	assert.equal(missingTrace.ok, false);
	assert(missingTrace.compatibility_gaps.some((gap) => gap.code === 'missing_replay_trace_evidence'));

	const missingActionTrace = JSON.parse(await readFile(path.join(fixtureRoot, 'episode-trace.json'), 'utf8'));
	missingActionTrace.steps = [];
	const missingActionTraceText = JSON.stringify(missingActionTrace, null, 2);
	const missingActionTracePath = path.join(temp, 'missing-action-trace.json');
	await writeFile(missingActionTracePath, missingActionTraceText);
	const missingActionArtifactPath = path.join(temp, 'missing-action-artifact.json');
	const missingActionArtifact = localizeFixtureReferences(JSON.parse(await readFile(path.join(fixtureRoot, 'valid-artifact.json'), 'utf8')));
	missingActionArtifact.runtime.references.replay_trace[0].path_or_url = missingActionTracePath;
	missingActionArtifact.runtime.references.replay_trace[0].sha256 = sha256(missingActionTraceText);
	missingActionArtifact.reports.replay[0].path_or_url = missingActionTracePath;
	missingActionArtifact.reports.replay[0].sha256 = sha256(missingActionTraceText);
	await writeFile(missingActionArtifactPath, JSON.stringify(missingActionArtifact, null, 2));

	const missingAction = await replayRegradeArtifactFile(missingActionArtifactPath, { benchmarkMode: true });
	assert.equal(missingAction.ok, false);
	assert(missingAction.compatibility_gaps.some((gap) => gap.code === 'missing_replay_actions'));

	const tamperedActionTrace = JSON.parse(await readFile(path.join(fixtureRoot, 'episode-trace.json'), 'utf8'));
	tamperedActionTrace.steps[1].action.command = 'post get 999 --field=post_content';
	const tamperedActionTraceText = JSON.stringify(tamperedActionTrace, null, 2);
	const tamperedActionTracePath = path.join(temp, 'tampered-action-trace.json');
	await writeFile(tamperedActionTracePath, tamperedActionTraceText);
	const tamperedActionArtifactPath = path.join(temp, 'tampered-action-artifact.json');
	const tamperedActionArtifact = localizeFixtureReferences(JSON.parse(await readFile(path.join(fixtureRoot, 'valid-artifact.json'), 'utf8')));
	tamperedActionArtifact.runtime.references.replay_trace[0].path_or_url = tamperedActionTracePath;
	tamperedActionArtifact.runtime.references.replay_trace[0].sha256 = sha256(tamperedActionTraceText);
	tamperedActionArtifact.reports.replay[0].path_or_url = tamperedActionTracePath;
	tamperedActionArtifact.reports.replay[0].sha256 = sha256(tamperedActionTraceText);
	await writeFile(tamperedActionArtifactPath, JSON.stringify(tamperedActionArtifact, null, 2));

	const tamperedAction = await replayRegradeArtifactFile(tamperedActionArtifactPath, { benchmarkMode: true });
	assert.equal(tamperedAction.ok, false);
	assert(tamperedAction.compatibility_gaps.some((gap) => gap.code === 'trace_action_result_mismatch' || gap.code === 'episode_replay_step_mismatch'));

	const browserEditorTraceText = await readFile(path.join(fixtureRoot, 'browser-editor-audit-trace.json'), 'utf8');
	const browserEditorTracePath = path.join(temp, 'browser-editor-audit-trace.json');
	await writeFile(browserEditorTracePath, browserEditorTraceText);
	const browserEditorArtifactPath = path.join(temp, 'browser-editor-artifact.json');
	const browserEditorArtifact = localizeFixtureReferences(JSON.parse(await readFile(path.join(fixtureRoot, 'valid-artifact.json'), 'utf8')));
	browserEditorArtifact.runtime.references.replay_trace[0].path_or_url = browserEditorTracePath;
	browserEditorArtifact.runtime.references.replay_trace[0].sha256 = sha256(browserEditorTraceText);
	browserEditorArtifact.reports.replay[0].path_or_url = browserEditorTracePath;
	browserEditorArtifact.reports.replay[0].sha256 = sha256(browserEditorTraceText);
	await writeFile(browserEditorArtifactPath, JSON.stringify(browserEditorArtifact, null, 2));

	const browserEditorAudit = await replayRegradeArtifactFile(browserEditorArtifactPath, { benchmarkMode: true });
	assert.equal(browserEditorAudit.ok, true, JSON.stringify(browserEditorAudit, null, 2));
	assert.equal(browserEditorAudit.replay.phase, 'trace_audit_plus_state_regrade');
	assert.equal(browserEditorAudit.replay.episode_replay, null);
	assert.equal(browserEditorAudit.replay.trace_reference.unsupported_actions.length, 2);
	assert(browserEditorAudit.compatibility_gaps.some((gap) => gap.code === 'browser_editor_action_audit_only'));

	const browserEditorMismatchTraceText = await readFile(path.join(fixtureRoot, 'browser-editor-mismatch-trace.json'), 'utf8');
	const browserEditorMismatchTracePath = path.join(temp, 'browser-editor-mismatch-trace.json');
	await writeFile(browserEditorMismatchTracePath, browserEditorMismatchTraceText);
	const browserEditorMismatchArtifactPath = path.join(temp, 'browser-editor-mismatch-artifact.json');
	const browserEditorMismatchArtifact = localizeFixtureReferences(JSON.parse(await readFile(path.join(fixtureRoot, 'valid-artifact.json'), 'utf8')));
	browserEditorMismatchArtifact.runtime.references.replay_trace[0].path_or_url = browserEditorMismatchTracePath;
	browserEditorMismatchArtifact.runtime.references.replay_trace[0].sha256 = sha256(browserEditorMismatchTraceText);
	browserEditorMismatchArtifact.reports.replay[0].path_or_url = browserEditorMismatchTracePath;
	browserEditorMismatchArtifact.reports.replay[0].sha256 = sha256(browserEditorMismatchTraceText);
	await writeFile(browserEditorMismatchArtifactPath, JSON.stringify(browserEditorMismatchArtifact, null, 2));

	const browserEditorMismatch = await replayRegradeArtifactFile(browserEditorMismatchArtifactPath, { benchmarkMode: true });
	assert.equal(browserEditorMismatch.ok, false);
	assert(browserEditorMismatch.compatibility_gaps.some((gap) => gap.code === 'trace_action_result_mismatch'));

	const archivePath = path.join(temp, 'downloaded-artifact.zip');
	const zip = spawnSync('zip', ['-X', '-q', archivePath, 'valid-artifact.json', 'episode-trace.json', 'wordpress-state.json', 'events.jsonl', 'result.json', 'replay.zip'], {
		cwd: fixtureRoot,
		encoding: 'utf8',
	});
	assert.equal(zip.status, 0, zip.stderr || zip.stdout);
	const replay = spawnSync(process.execPath, ['bin/wp-gym.mjs', 'replay', archivePath, '--regrade'], {
		cwd: root,
		encoding: 'utf8',
	});
	assert.equal(replay.status, 0, replay.stderr || replay.stdout);
	const replayOutput = JSON.parse(replay.stdout);
	assert.equal(replayOutput.ok, true);
	assert.equal(replayOutput.benchmark_mode, true);
	assert.equal(replayOutput.regrade, true);
	assert.equal(replayOutput.summary.failure_classes.none, 1);

	const aggregate = spawnSync(process.execPath, [
		'scripts/aggregate-run-registry.mjs',
		'--registry',
		'fixtures/run-registry/valid-canonical-eval-artifact.json',
		'--regrade',
	], {
		cwd: root,
		encoding: 'utf8',
	});
	assert.equal(aggregate.status, 0, aggregate.stderr || aggregate.stdout);
	const aggregateOutput = JSON.parse(aggregate.stdout);
	assert.equal(aggregateOutput.replay_regrade.enabled, true);
	assert.equal(aggregateOutput.replay_regrade.attempted, 1);
	assert.equal(aggregateOutput.replay_regrade.deterministic, 1);
	assert.equal(aggregateOutput.replay_regrade.success_rate, 1);
	assert.equal(aggregateOutput.replay_regrade.drift_rate, 0);
	assert.equal(aggregateOutput.replay_regrade.failure_classes.none, 1);
} finally {
	await rm(temp, { recursive: true, force: true });
}

console.log('Validated replay/regrade fixtures.');
