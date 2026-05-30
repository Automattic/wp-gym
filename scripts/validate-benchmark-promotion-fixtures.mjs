import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	evaluatePromotionTarget,
	promotionReportFragment,
	validateEmbeddedPromotionReport,
} from './benchmark-promotion.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const pilotReport = evaluatePromotionTarget({ root, taskSetId: 'benchmark-readiness-pilot' });
assert.equal(pilotReport.target_type, 'task_set');
assert.equal(pilotReport.target_id, 'benchmark-readiness-pilot');
assert.equal(pilotReport.status, 'fail');
assert.ok(pilotReport.blockers.includes('task_set_not_benchmark_ready'));
assert.ok(!pilotReport.blockers.some((blocker) => blocker.includes('missing_calibration_results')));
assert.ok(!pilotReport.blockers.some((blocker) => blocker.includes('workspace_diff_diagnostic_only')));
assert.ok(pilotReport.scenarios.length >= 1);

const scenarioReport = evaluatePromotionTarget({ root, scenarioId: 'block-markup-no-fallback-pricing-section' });
assert.equal(scenarioReport.target_type, 'scenario');
assert.equal(scenarioReport.status, 'fail');
assert.ok(scenarioReport.gates.some((gate) => gate.code === 'known_shortcuts_fixture_covered' && gate.status === 'pass'));
assert.ok(scenarioReport.gates.some((gate) => gate.code === 'reward_soundness_reviewed' && gate.status === 'pass'));
assert.ok(scenarioReport.gates.some((gate) => gate.code === 'reward_shortcuts_review_resolved' && gate.status === 'fail'));
assert.ok(scenarioReport.gates.some((gate) => gate.code === 'hidden_evidence_boundaries_clean' && gate.status === 'pass'));
assert.ok(scenarioReport.blockers.includes('known_shortcuts_unresolved'));
assert.ok(scenarioReport.blockers.includes('known_reward_shortcut'));

const embeddedTarget = {
	type: 'task_set',
	file: pilotReport.target_file,
	manifest: {
		id: pilotReport.target_id,
		tasks: [],
		promotion_report: promotionReportFragment({ ...pilotReport, status: 'pass' }),
	},
};
embeddedTarget.manifest.promotion_report.source_sha256 = validateEmbeddedPromotionReport(embeddedTarget).expected_source_sha256;
assert.equal(validateEmbeddedPromotionReport(embeddedTarget).ok, true);

embeddedTarget.manifest.description = 'changed after report generation';
const stale = validateEmbeddedPromotionReport(embeddedTarget);
assert.equal(stale.ok, false);
assert.ok(stale.gaps.some((gap) => gap.blockers.includes('stale_promotion_report')));

console.log('Validated benchmark promotion report fixtures.');
