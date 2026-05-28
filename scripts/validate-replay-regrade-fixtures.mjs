import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { replayRegradeArtifactFile } from './replay-regrade.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = path.join(root, 'fixtures/replay-regrade');

const valid = replayRegradeArtifactFile(path.join(fixtureRoot, 'valid-artifact.json'), { benchmarkMode: true });
assert.equal(valid.ok, true, JSON.stringify(valid, null, 2));
assert.equal(valid.replay.comparison.ok, true);

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
} finally {
	await rm(temp, { recursive: true, force: true });
}

console.log('Validated replay/regrade fixtures.');
