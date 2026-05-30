import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const reviewRoot = path.join(root, 'reviews', 'reward-soundness');
const scenarioRoot = path.join(root, 'scenarios');
const taskSetRoot = path.join(root, 'task-sets');
const requiredPilotTaskSet = 'benchmark-readiness-pilot';
const reviewStatuses = new Set(['reviewed', 'needs_review']);
const reviewerTypes = new Set(['human', 'reference_oracle']);
const shortcutStatuses = new Set(['resolved', 'unresolved', 'not_applicable']);
const diagnosticReviewStatuses = new Set(['reviewed', 'not_applicable']);
const reviewCaseTypes = new Set(['positive', 'negative', 'adversarial', 'borderline']);
const requiredReviewCaseTypes = [...reviewCaseTypes];
const disagreementClasses = new Set([
	'grader_false_positive',
	'grader_false_negative',
	'fixture_invalid',
	'reference_ambiguous',
	'task_ambiguous',
	'diagnostic_contract_gap',
]);
const disagreementSeverities = new Set(['critical', 'high', 'medium', 'low']);
const disagreementStatuses = new Set(['resolved', 'unresolved']);

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

async function listJsonFiles(dir, relativeDir) {
	if (!existsSync(dir)) {
		return [];
	}

	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		const relativePath = path.join(relativeDir, entry.name).replace(/\\/g, '/');
		if (entry.isDirectory()) {
			files.push(...await listJsonFiles(fullPath, relativePath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(relativePath);
		}
	}
	return files.sort();
}

async function loadJson(relativePath) {
	return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

function assertIsoDate(value, label) {
	assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), `${label} must be YYYY-MM-DD`);
}

function assertRepoFile(value, label) {
	assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
	assert(!path.isAbsolute(value) && !value.split('/').includes('..'), `${label} must be repo-relative without traversal: ${value}`);
	assert(existsSync(path.join(root, value)), `${label} does not exist: ${value}`);
}

async function loadScenarios() {
	const scenarios = new Map();
	for (const file of await listJsonFiles(scenarioRoot, 'scenarios')) {
		const manifest = await loadJson(file);
		scenarios.set(manifest.id, { file, manifest });
	}
	return scenarios;
}

async function loadRewardFixtures() {
	const fixtures = new Map();
	for (const file of await listJsonFiles(path.join(root, 'fixtures', 'reward-hacking'), 'fixtures/reward-hacking')) {
		const fixture = await loadJson(file);
		fixtures.set(fixture.id, { file, fixture });
	}
	return fixtures;
}

function scenarioTaskFamily(scenario) {
	return scenario.file.split('/')[1] || scenario.manifest.capabilities?.primary || 'uncategorized';
}

function emptyCaseCounts() {
	return Object.fromEntries(requiredReviewCaseTypes.map((type) => [type, 0]));
}

function emptySeverityCounts() {
	return Object.fromEntries([...disagreementSeverities].map((severity) => [severity, 0]));
}

function emptyClassCounts() {
	return Object.fromEntries([...disagreementClasses].map((classification) => [classification, 0]));
}

function validateDisagreementDetails(file, output, label) {
	if (output.reviewer_classification === 'match') {
		assert(output.grader_outcome === output.expected_wordpress_quality, `${file} ${label} match must have grader outcome equal expected WordPress quality`);
		return null;
	}

	assert(output.grader_outcome !== output.expected_wordpress_quality, `${file} ${label} mismatch must have grader outcome different from expected WordPress quality`);
	assert(disagreementClasses.has(output.disagreement_class), `${file} ${label}.disagreement_class must be one of: ${[...disagreementClasses].join(', ')}`);
	assert(disagreementSeverities.has(output.disagreement_severity), `${file} ${label}.disagreement_severity must be one of: ${[...disagreementSeverities].join(', ')}`);
	assert(disagreementStatuses.has(output.disagreement_status), `${file} ${label}.disagreement_status must be resolved or unresolved`);
	assert(typeof output.required_grader_change === 'string' && output.required_grader_change.length > 0, `${file} ${label}.required_grader_change is required for mismatches`);
	assert(typeof output.follow_up === 'string' && output.follow_up.length > 0, `${file} ${label}.follow_up is required for mismatches`);
	assert(/^https:\/\/github\.com\/Automattic\/wp-gym\/(issues|pull)\/\d+/.test(output.follow_up), `${file} ${label}.follow_up must link a public wp-gym issue or PR`);
	return output;
}

function validateOutputReview(file, scenarioId, output, fixtures, label) {
	assert(typeof output === 'object' && output !== null && !Array.isArray(output), `${file} ${label} must be an object`);
	assert(typeof output.fixture_id === 'string' && output.fixture_id.length > 0, `${file} ${label}.fixture_id is required`);
	assert(reviewCaseTypes.has(output.review_case), `${file} ${label}.review_case must be one of: ${requiredReviewCaseTypes.join(', ')}`);
	const fixture = fixtures.get(output.fixture_id);
	assert(fixture, `${file} ${label}.fixture_id references unknown fixture: ${output.fixture_id}`);
	assert(fixture.fixture.scenario_id === scenarioId, `${file} ${label}.fixture_id belongs to ${fixture.fixture.scenario_id}, expected ${scenarioId}`);
	assertRepoFile(fixture.file, `${file} ${label}.fixture_id file`);
	assert(['pass', 'fail'].includes(output.grader_outcome), `${file} ${label}.grader_outcome must be pass or fail`);
	assert(['pass', 'fail'].includes(output.expected_wordpress_quality), `${file} ${label}.expected_wordpress_quality must be pass or fail`);
	assert(['match', 'mismatch'].includes(output.reviewer_classification), `${file} ${label}.reviewer_classification must be match or mismatch`);
	const disagreement = validateDisagreementDetails(file, output, label);
	if (output.review_case === 'positive') {
		assert(output.expected_wordpress_quality === 'pass', `${file} ${label}.review_case positive must have pass expected_wordpress_quality`);
		assert(fixture.fixture.type === 'positive_control_fixture', `${file} ${label}.review_case positive must reference a positive_control_fixture`);
	} else {
		assert(output.expected_wordpress_quality === 'fail', `${file} ${label}.review_case ${output.review_case} must have fail expected_wordpress_quality`);
		assert(fixture.fixture.type === 'adversarial_negative_fixture', `${file} ${label}.review_case ${output.review_case} must reference an adversarial_negative_fixture`);
	}
	return disagreement;
}

function validateReview(file, review, scenarios, fixtures, familyAccumulator) {
	assert(typeof review.scenario_id === 'string' && review.scenario_id.length > 0, `${file} review.scenario_id is required`);
	const scenario = scenarios.get(review.scenario_id);
	assert(scenario, `${file} references unknown scenario_id: ${review.scenario_id}`);
	assert(reviewStatuses.has(review.status), `${file} ${review.scenario_id} status must be reviewed or needs_review`);
	assert(reviewerTypes.has(review.reviewer_type), `${file} ${review.scenario_id} reviewer_type must be human or reference_oracle`);
	assertIsoDate(review.reviewed_at, `${file} ${review.scenario_id} reviewed_at`);
	assert(typeof review.classification === 'string' && review.classification.length > 0, `${file} ${review.scenario_id} classification is required`);
	assert(shortcutStatuses.has(review.shortcut_resolution_status), `${file} ${review.scenario_id} shortcut_resolution_status is invalid`);
	assert(diagnosticReviewStatuses.has(review.diagnostic_contract_review?.status), `${file} ${review.scenario_id} diagnostic_contract_review.status is invalid`);
	assert(Array.isArray(review.representative_passed_outputs) && review.representative_passed_outputs.length > 0, `${file} ${review.scenario_id} needs representative_passed_outputs`);
	assert(Array.isArray(review.adversarial_or_failed_outputs) && review.adversarial_or_failed_outputs.length > 0, `${file} ${review.scenario_id} needs adversarial_or_failed_outputs`);
	const scenarioSummary = {
		scenario_id: review.scenario_id,
		reviewed_cases: emptyCaseCounts(),
		agreements: 0,
		disagreements: 0,
		unresolved_disagreements: 0,
		disagreement_classes: emptyClassCounts(),
		disagreement_severity: emptySeverityCounts(),
	};
	for (const [index, output] of review.representative_passed_outputs.entries()) {
		const disagreement = validateOutputReview(file, review.scenario_id, output, fixtures, `representative_passed_outputs[${index}]`);
		accumulateOutput(scenarioSummary, output, disagreement);
	}
	for (const [index, output] of review.adversarial_or_failed_outputs.entries()) {
		const disagreement = validateOutputReview(file, review.scenario_id, output, fixtures, `adversarial_or_failed_outputs[${index}]`);
		accumulateOutput(scenarioSummary, output, disagreement);
	}

	const family = scenarioTaskFamily(scenario);
	if (!familyAccumulator.has(family)) {
		familyAccumulator.set(family, {
			scenarios: new Set(),
			scenario_summaries: new Map(),
			reviewed_cases: emptyCaseCounts(),
			agreements: 0,
			disagreements: 0,
			unresolved_disagreements: 0,
			disagreement_classes: emptyClassCounts(),
			disagreement_severity: emptySeverityCounts(),
		});
	}
	const familySummary = familyAccumulator.get(family);
	familySummary.scenarios.add(review.scenario_id);
	familySummary.scenario_summaries.set(review.scenario_id, scenarioSummary);
	for (const type of requiredReviewCaseTypes) {
		familySummary.reviewed_cases[type] += scenarioSummary.reviewed_cases[type];
	}
	familySummary.agreements += scenarioSummary.agreements;
	familySummary.disagreements += scenarioSummary.disagreements;
	familySummary.unresolved_disagreements += scenarioSummary.unresolved_disagreements;
	for (const classification of disagreementClasses) {
		familySummary.disagreement_classes[classification] += scenarioSummary.disagreement_classes[classification];
	}
	for (const severity of disagreementSeverities) {
		familySummary.disagreement_severity[severity] += scenarioSummary.disagreement_severity[severity];
	}

	const metadata = scenario.manifest.calibration?.reward_soundness_review;
	assert(metadata, `${scenario.file} calibration.reward_soundness_review must link to ${file}`);
	assert(metadata.artifact === file, `${scenario.file} calibration.reward_soundness_review.artifact must be ${file}`);
	assert(metadata.status === review.status, `${scenario.file} calibration.reward_soundness_review.status must match review artifact`);
	assert(metadata.shortcut_resolution_status === review.shortcut_resolution_status, `${scenario.file} calibration.reward_soundness_review.shortcut_resolution_status must match review artifact`);
	assert(metadata.diagnostic_contract_review?.status === review.diagnostic_contract_review.status, `${scenario.file} calibration.reward_soundness_review.diagnostic_contract_review.status must match review artifact`);
	if (scenario.manifest.calibration?.known_shortcuts?.length > 0) {
		assert(review.shortcut_resolution_status !== 'resolved', `${file} ${review.scenario_id} cannot mark shortcuts resolved while calibration.known_shortcuts is non-empty`);
	}
}

function accumulateOutput(summary, output, disagreement) {
	summary.reviewed_cases[output.review_case] += 1;
	if (!disagreement) {
		summary.agreements += 1;
		return;
	}
	summary.disagreements += 1;
	if (disagreement.disagreement_status === 'unresolved') {
		summary.unresolved_disagreements += 1;
	}
	summary.disagreement_classes[disagreement.disagreement_class] += 1;
	summary.disagreement_severity[disagreement.disagreement_severity] += 1;
}

function validateTaskFamilyAgreement(file, artifact, familyAccumulator) {
	assert(typeof artifact.agreement_policy === 'object' && artifact.agreement_policy !== null && !Array.isArray(artifact.agreement_policy), `${file} agreement_policy is required`);
	assert(Number.isInteger(artifact.agreement_policy.max_unresolved_disagreements), `${file} agreement_policy.max_unresolved_disagreements must be an integer`);
	assert(typeof artifact.agreement_policy.min_agreement_rate === 'number', `${file} agreement_policy.min_agreement_rate must be a number`);
	assert(typeof artifact.agreement_policy.max_unresolved_by_severity === 'object' && artifact.agreement_policy.max_unresolved_by_severity !== null && !Array.isArray(artifact.agreement_policy.max_unresolved_by_severity), `${file} agreement_policy.max_unresolved_by_severity is required`);
	for (const severity of disagreementSeverities) {
		assert(Number.isInteger(artifact.agreement_policy.max_unresolved_by_severity[severity]), `${file} agreement_policy.max_unresolved_by_severity.${severity} must be an integer`);
	}
	assert(Array.isArray(artifact.disagreement_classes) && artifact.disagreement_classes.length === disagreementClasses.size, `${file} disagreement_classes must list supported disagreement classes`);
	for (const classification of disagreementClasses) {
		assert(artifact.disagreement_classes.includes(classification), `${file} disagreement_classes missing ${classification}`);
	}
	assert(Array.isArray(artifact.scenario_agreement) && artifact.scenario_agreement.length > 0, `${file} scenario_agreement must be a non-empty array`);
	assert(Array.isArray(artifact.task_family_agreement) && artifact.task_family_agreement.length > 0, `${file} task_family_agreement must be a non-empty array`);

	const scenarioReported = new Map(artifact.scenario_agreement.map((entry) => [entry.scenario_id, entry]));
	for (const summary of familyAccumulator.values()) {
		for (const scenarioSummary of summary.scenario_summaries.values()) {
			validateAgreementEntry(file, artifact, scenarioSummary, scenarioReported.get(scenarioSummary.scenario_id), `scenario_agreement ${scenarioSummary.scenario_id}`);
		}
	}
	for (const scenarioId of scenarioReported.keys()) {
		assert([...familyAccumulator.values()].some((summary) => summary.scenario_summaries.has(scenarioId)), `${file} scenario_agreement reports unreviewed scenario: ${scenarioId}`);
	}

	const reported = new Map(artifact.task_family_agreement.map((entry) => [entry.family, entry]));
	for (const [family, summary] of familyAccumulator.entries()) {
		const entry = reported.get(family);
		assert(entry, `${file} task_family_agreement missing family: ${family}`);
		assert(Array.isArray(entry.scenarios), `${file} task_family_agreement ${family}.scenarios must be an array`);
		assert(entry.scenarios.join('\n') === [...summary.scenarios].sort().join('\n'), `${file} task_family_agreement ${family}.scenarios must match reviewed scenarios`);
		for (const type of requiredReviewCaseTypes) {
			assert(entry.reviewed_cases?.[type] === summary.reviewed_cases[type], `${file} task_family_agreement ${family}.reviewed_cases.${type} must be ${summary.reviewed_cases[type]}`);
			assert(summary.reviewed_cases[type] > 0, `${file} task family ${family} needs at least one ${type} review case`);
		}
		validateAgreementEntry(file, artifact, summary, entry, `task_family_agreement ${family}`);
	}
	for (const family of reported.keys()) {
		assert(familyAccumulator.has(family), `${file} task_family_agreement reports unreviewed family: ${family}`);
	}
}

function validateAgreementEntry(file, artifact, summary, entry, label) {
	assert(entry, `${file} ${label} is missing`);
	assert(entry.agreements === summary.agreements, `${file} ${label}.agreements must be ${summary.agreements}`);
	assert(entry.disagreements === summary.disagreements, `${file} ${label}.disagreements must be ${summary.disagreements}`);
	assert(entry.unresolved_disagreements === summary.unresolved_disagreements, `${file} ${label}.unresolved_disagreements must be ${summary.unresolved_disagreements}`);
	assert(entry.unresolved_disagreements <= artifact.agreement_policy.max_unresolved_disagreements, `${file} ${label} exceeds unresolved disagreement policy`);
	for (const classification of disagreementClasses) {
		assert(entry.disagreement_classes?.[classification] === summary.disagreement_classes[classification], `${file} ${label}.disagreement_classes.${classification} must be ${summary.disagreement_classes[classification]}`);
	}
	for (const severity of disagreementSeverities) {
		assert(entry.disagreement_severity?.[severity] === summary.disagreement_severity[severity], `${file} ${label}.disagreement_severity.${severity} must be ${summary.disagreement_severity[severity]}`);
		assert(entry.disagreement_severity[severity] <= artifact.agreement_policy.max_unresolved_by_severity[severity], `${file} ${label} exceeds ${severity} disagreement policy`);
	}
	const total = summary.agreements + summary.disagreements;
	const agreementRate = total === 0 ? 0 : summary.agreements / total;
	assert(entry.agreement_rate === agreementRate, `${file} ${label}.agreement_rate must be ${agreementRate}`);
	assert(entry.agreement_rate >= artifact.agreement_policy.min_agreement_rate, `${file} ${label}.agreement_rate is below policy threshold`);
}

const files = await listJsonFiles(reviewRoot, 'reviews/reward-soundness');
assert(files.length > 0, 'Expected at least one reward-soundness review artifact.');
const scenarios = await loadScenarios();
const fixtures = await loadRewardFixtures();
const reviewedScenarioIds = new Set();

for (const file of files) {
	const artifact = await loadJson(file);
	assert(artifact.schema_version === 1, `${file} schema_version must be 1`);
	assert(typeof artifact.id === 'string' && artifact.id.length > 0, `${file} id is required`);
	assert(Array.isArray(artifact.reviews) && artifact.reviews.length > 0, `${file} reviews must be a non-empty array`);
	const familyAccumulator = new Map();
	for (const review of artifact.reviews) {
		validateReview(file, review, scenarios, fixtures, familyAccumulator);
		reviewedScenarioIds.add(review.scenario_id);
	}
	validateTaskFamilyAgreement(file, artifact, familyAccumulator);
}

const pilot = await loadJson(`task-sets/${requiredPilotTaskSet}.json`);
for (const task of pilot.tasks) {
	assert(
		reviewedScenarioIds.has(task.scenario_id),
		`task-sets/${requiredPilotTaskSet}.json task ${task.scenario_id} needs reward-soundness review evidence`
	);
}

console.log(`Validated ${files.length} reward-soundness review artifact(s).`);
