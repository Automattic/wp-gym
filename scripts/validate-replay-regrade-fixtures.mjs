import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

const valid = replayRegradeArtifactFile(path.join(fixtureRoot, 'valid-artifact.json'), { benchmarkMode: true });
assert.equal(valid.ok, true, JSON.stringify(valid, null, 2));
assert.equal(valid.replay.comparison.ok, true);
assert.equal(valid.replay.phase, 'trace_audit_plus_state_regrade');
assert.equal(valid.replay.trace_reference.step_count, 2);

const tampered = replayRegradeArtifactFile(path.join(fixtureRoot, 'tampered-grade-mismatch.json'), { benchmarkMode: true });
assert.equal(tampered.ok, false);
assert(tampered.compatibility_gaps.some((gap) => gap.code === 'grade_mismatch'));
assert(tampered.replay.comparison.mismatches.some((mismatch) => mismatch.field === 'success'));

const temp = await mkdtemp(path.join(os.tmpdir(), 'wp-gym-replay-regrade-'));
try {
	const missingStateFile = path.join(temp, 'missing-state.json');
	const missingStateArtifact = JSON.parse(await readFile(path.join(fixtureRoot, 'valid-artifact.json'), 'utf8'));
	delete missingStateArtifact.runtime.references.observations;
	await writeFile(missingStateFile, JSON.stringify(missingStateArtifact, null, 2));

	const missingState = replayRegradeArtifactFile(missingStateFile, { benchmarkMode: true });
	assert.equal(missingState.ok, false);
	assert(missingState.compatibility_gaps.some((gap) => gap.code === 'missing_wordpress_state_evidence'));

	const missingTraceFile = path.join(temp, 'missing-trace.json');
	const missingTraceArtifact = localizeFixtureReferences(JSON.parse(await readFile(path.join(fixtureRoot, 'valid-artifact.json'), 'utf8')));
	delete missingTraceArtifact.runtime.references.replay_trace;
	delete missingTraceArtifact.reports.replay;
	await writeFile(missingTraceFile, JSON.stringify(missingTraceArtifact, null, 2));

	const missingTrace = replayRegradeArtifactFile(missingTraceFile, { benchmarkMode: true });
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

	const missingAction = replayRegradeArtifactFile(missingActionArtifactPath, { benchmarkMode: true });
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

	const tamperedAction = replayRegradeArtifactFile(tamperedActionArtifactPath, { benchmarkMode: true });
	assert.equal(tamperedAction.ok, false);
	assert(tamperedAction.compatibility_gaps.some((gap) => gap.code === 'trace_action_result_mismatch'));
} finally {
	await rm(temp, { recursive: true, force: true });
}

console.log('Validated replay/regrade fixtures.');
