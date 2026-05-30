import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStabilityReport, classifyStabilityFailure } from './stability-budget.mjs';
import fs from 'node:fs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = path.join(root, 'fixtures/stability-budget');

function readFixture(name) {
	return JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.json`), 'utf8'));
}

for (const name of ['infra', 'provider', 'artifact', 'runner', 'task', 'grader']) {
	assert.equal(classifyStabilityFailure(readFixture(`${name}-failure`)).failure_class, name);
}
assert.equal(classifyStabilityFailure(readFixture('passed-control')).failure_class, 'none');

const rows = ['passed-control', 'provider-failure', 'provider-recovery', 'runner-failure'].map(readFixture);
const report = buildStabilityReport(rows, { windowRuns: 10, windowDays: 30 });
assert.equal(report.inputs.accepted, 4);
assert.equal(report.overall.failures, 2);
assert.equal(report.by_workflow['datamachine-live-run'].over_budget.includes('provider'), true);
assert.equal(report.flaky_operations.length, 1);
assert.equal(report.flaky_operations[0].failure_classes.provider, 1);

const windowed = buildStabilityReport(rows, { windowRuns: 2, windowDays: 30 });
assert.equal(windowed.inputs.accepted, 2);
assert.equal(windowed.rows[0].run_id, 'fixture-provider-recovery');

console.log('Validated stability budget fixtures.');
