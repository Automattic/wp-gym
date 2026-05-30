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
	assert(output.reviewer_classification === 'match', `${file} ${label} must not record unresolved grader/reviewer mismatch`);
	assert(output.grader_outcome === output.expected_wordpress_quality, `${file} ${label} grader outcome must match expected WordPress quality`);
	if (output.review_case === 'positive') {
		assert(output.grader_outcome === 'pass', `${file} ${label}.review_case positive must have pass grader_outcome`);
		assert(fixture.fixture.type === 'positive_control_fixture', `${file} ${label}.review_case positive must reference a positive_control_fixture`);
	} else {
		assert(output.grader_outcome === 'fail', `${file} ${label}.review_case ${output.review_case} must have fail grader_outcome`);
		assert(fixture.fixture.type === 'adversarial_negative_fixture', `${file} ${label}.review_case ${output.review_case} must reference an adversarial_negative_fixture`);
	}
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
	for (const [index, output] of review.representative_passed_outputs.entries()) {
		validateOutputReview(file, review.scenario_id, output, fixtures, `representative_passed_outputs[${index}]`);
	}
	for (const [index, output] of review.adversarial_or_failed_outputs.entries()) {
		validateOutputReview(file, review.scenario_id, output, fixtures, `adversarial_or_failed_outputs[${index}]`);
	}

	const family = scenarioTaskFamily(scenario);
	if (!familyAccumulator.has(family)) {
		familyAccumulator.set(family, {
			scenarios: new Set(),
			reviewed_cases: Object.fromEntries(requiredReviewCaseTypes.map((type) => [type, 0])),
			agreements: 0,
			disagreements: 0,
		});
	}
	const familySummary = familyAccumulator.get(family);
	familySummary.scenarios.add(review.scenario_id);
	for (const output of [...review.representative_passed_outputs, ...review.adversarial_or_failed_outputs]) {
		familySummary.reviewed_cases[output.review_case] += 1;
		if (output.reviewer_classification === 'match') {
			familySummary.agreements += 1;
		} else {
			familySummary.disagreements += 1;
		}
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

function validateTaskFamilyAgreement(file, artifact, familyAccumulator) {
	assert(typeof artifact.agreement_policy === 'object' && artifact.agreement_policy !== null && !Array.isArray(artifact.agreement_policy), `${file} agreement_policy is required`);
	assert(Number.isInteger(artifact.agreement_policy.max_unresolved_disagreements), `${file} agreement_policy.max_unresolved_disagreements must be an integer`);
	assert(Array.isArray(artifact.task_family_agreement) && artifact.task_family_agreement.length > 0, `${file} task_family_agreement must be a non-empty array`);

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
		assert(entry.agreements === summary.agreements, `${file} task_family_agreement ${family}.agreements must be ${summary.agreements}`);
		assert(entry.disagreements === summary.disagreements, `${file} task_family_agreement ${family}.disagreements must be ${summary.disagreements}`);
		assert(entry.unresolved_disagreements === summary.disagreements, `${file} task_family_agreement ${family}.unresolved_disagreements must be ${summary.disagreements}`);
		assert(entry.unresolved_disagreements <= artifact.agreement_policy.max_unresolved_disagreements, `${file} task family ${family} exceeds unresolved disagreement policy`);
		const total = summary.agreements + summary.disagreements;
		assert(entry.agreement_rate === summary.agreements / total, `${file} task_family_agreement ${family}.agreement_rate must be ${summary.agreements / total}`);
	}
	for (const family of reported.keys()) {
		assert(familyAccumulator.has(family), `${file} task_family_agreement reports unreviewed family: ${family}`);
	}
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
