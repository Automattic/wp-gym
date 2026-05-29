import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeArchive, renderMarkdown } from './triage-remote-archive.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = path.join(root, 'fixtures/remote-archives/cycle-ok');
const report = summarizeArchive(fixture, {
	now: new Date('2026-05-29T00:00:00Z'),
	staleDays: 30,
});

assert.equal(report.ok, true);
assert.equal(report.reviewers.total, 3);
assert.equal(report.reviewers.reports, 3);
assert.equal(report.reviewers.failed, 0);
assert.equal(report.validations.total, 3);
assert.equal(report.validations.failed, 0);
assert.equal(report.candidate_patches.total, 3);
assert.equal(report.candidate_patches.nonempty, 3);
assert.equal(report.candidate_patches.unique_nonempty, 2);
assert.equal(report.candidate_patches.duplicates.length, 1);
assert.equal(report.data_quality_gaps.some((gap) => gap.code === 'duplicate_candidate_patches'), true);

const markdown = renderMarkdown(report);
assert.match(markdown, /WP Gym Remote Archive Triage/);
assert.match(markdown, /Duplicate Patch Groups/);

console.log('remote archive triage fixture passed');
