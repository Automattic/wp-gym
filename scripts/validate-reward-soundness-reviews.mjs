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

function validateOutputReview(file, scenarioId, output, fixtures, label) {
	assert(typeof output === 'object' && output !== null && !Array.isArray(output), `${file} ${label} must be an object`);
	assert(typeof output.fixture_id === 'string' && output.fixture_id.length > 0, `${file} ${label}.fixture_id is required`);
	const fixture = fixtures.get(output.fixture_id);
	assert(fixture, `${file} ${label}.fixture_id references unknown fixture: ${output.fixture_id}`);
	assert(fixture.fixture.scenario_id === scenarioId, `${file} ${label}.fixture_id belongs to ${fixture.fixture.scenario_id}, expected ${scenarioId}`);
	assertRepoFile(fixture.file, `${file} ${label}.fixture_id file`);
	assert(['pass', 'fail'].includes(output.grader_outcome), `${file} ${label}.grader_outcome must be pass or fail`);
	assert(['pass', 'fail'].includes(output.expected_wordpress_quality), `${file} ${label}.expected_wordpress_quality must be pass or fail`);
	assert(['match', 'mismatch'].includes(output.reviewer_classification), `${file} ${label}.reviewer_classification must be match or mismatch`);
	assert(output.reviewer_classification === 'match', `${file} ${label} must not record unresolved grader/reviewer mismatch`);
	assert(output.grader_outcome === output.expected_wordpress_quality, `${file} ${label} grader outcome must match expected WordPress quality`);
}

function validateReview(file, review, scenarios, fixtures) {
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
	for (const review of artifact.reviews) {
		validateReview(file, review, scenarios, fixtures);
		reviewedScenarioIds.add(review.scenario_id);
	}
}

const pilot = await loadJson(`task-sets/${requiredPilotTaskSet}.json`);
for (const task of pilot.tasks) {
	assert(
		reviewedScenarioIds.has(task.scenario_id),
		`task-sets/${requiredPilotTaskSet}.json task ${task.scenario_id} needs reward-soundness review evidence`
	);
}

console.log(`Validated ${files.length} reward-soundness review artifact(s).`);
