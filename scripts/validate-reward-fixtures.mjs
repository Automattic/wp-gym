import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const fixtureRoot = path.join(root, 'fixtures', 'reward-hacking');
const scenarioRoot = path.join(root, 'scenarios');
const benchmarkCandidateScopes = new Set(['calibration', 'benchmark']);
const knownAdversarialCases = new Set(['empty_output']);

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

async function listFixtureFiles(dir = fixtureRoot, relativeDir = 'fixtures/reward-hacking') {
	if (!existsSync(dir)) {
		return [];
	}

	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		const relativePath = path.join(relativeDir, entry.name).replace(/\\/g, '/');
		if (entry.isDirectory()) {
			files.push(...await listFixtureFiles(fullPath, relativePath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(relativePath);
		}
	}

	return files.sort();
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

function normalizeRepoRelativePath(value, label) {
	assert(typeof value === 'string' && value.trim().length > 0, `${label} must be a non-empty string`);

	const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '');
	assert(
		!normalized.startsWith('/') &&
			!path.isAbsolute(normalized) &&
			!normalized.split('/').includes('..'),
		`${label} must be a repo-relative path without traversal: ${value}`
	);

	return normalized;
}

function resolveFrom(baseFile, candidate, label) {
	assert(typeof candidate === 'string' && candidate.length > 0, `${label} must be a non-empty string`);

	const resolved = path.resolve(root, path.dirname(baseFile), candidate);
	const relative = path.relative(root, resolved).replace(/\\/g, '/');
	assert(!relative.startsWith('..') && !path.isAbsolute(relative), `${label} resolves outside the repository: ${candidate}`);

	return relative;
}

async function loadScenarios() {
	const scenarios = new Map();

	for (const file of await listJsonFiles(scenarioRoot, 'scenarios')) {
		const manifest = JSON.parse(await readFile(path.join(root, file), 'utf8'));
		assert(typeof manifest.id === 'string' && manifest.id.length > 0, `${file} missing id`);
		assert(!scenarios.has(manifest.id), `${file} duplicates scenario id ${manifest.id}`);
		scenarios.set(manifest.id, { file, manifest });
	}

	return scenarios;
}

function validateFixture(file, fixture, scenarios) {
	for (const field of ['id', 'scenario_id', 'grader_file', 'type', 'expected_result', 'content_file']) {
		assert(typeof fixture[field] === 'string' && fixture[field].length > 0, `${file} missing ${field}`);
	}

	assert(
		['adversarial_negative_fixture', 'positive_control_fixture'].includes(fixture.type),
		`${file} type must be adversarial_negative_fixture or positive_control_fixture`
	);
	assert(['fail', 'pass'].includes(fixture.expected_result), `${file} expected_result must be pass or fail`);
	if (fixture.type === 'adversarial_negative_fixture') {
		assert(fixture.expected_result === 'fail', `${file} adversarial_negative_fixture must expect fail`);
		assert(
			typeof fixture.shortcut_id === 'string' && fixture.shortcut_id.length > 0 ||
				typeof fixture.adversarial_case === 'string' && fixture.adversarial_case.length > 0,
			`${file} adversarial_negative_fixture must declare shortcut_id or adversarial_case`
		);
	}
	if (fixture.type === 'positive_control_fixture') {
		assert(fixture.expected_result === 'pass', `${file} positive_control_fixture must expect pass`);
		assert(Array.isArray(fixture.covers_shortcut_ids) && fixture.covers_shortcut_ids.length > 0, `${file} positive_control_fixture must declare covers_shortcut_ids`);
	}
	if (fixture.expected_result === 'fail') {
		assert(Array.isArray(fixture.expected_failure_reasons) && fixture.expected_failure_reasons.length > 0, `${file} must declare expected_failure_reasons`);
	}

	const scenario = scenarios.get(fixture.scenario_id);
	assert(scenario, `${file} references unknown scenario_id: ${fixture.scenario_id}`);

	const graderFile = normalizeRepoRelativePath(fixture.grader_file, `${file} grader_file`);
	const contentFile = normalizeRepoRelativePath(fixture.content_file, `${file} content_file`);
	assert(resolveFrom(scenario.file, scenario.manifest.grader_file, `${scenario.file} grader_file`) === graderFile, `${file} grader_file must match scenario grader_file`);
	if (fixture.type === 'adversarial_negative_fixture') {
		if (fixture.shortcut_id) {
			assert(
				Array.isArray(scenario.manifest.calibration?.known_shortcuts) &&
					scenario.manifest.calibration.known_shortcuts.includes(fixture.shortcut_id),
				`${file} shortcut_id must be declared in scenario calibration.known_shortcuts`
			);
		}
		if (fixture.adversarial_case) {
			assert(
				knownAdversarialCases.has(fixture.adversarial_case),
				`${file} adversarial_case must be one of: ${[...knownAdversarialCases].join(', ')}`
			);
		}
	}
	if (fixture.type === 'positive_control_fixture') {
		for (const shortcutId of fixture.covers_shortcut_ids) {
			assert(
				Array.isArray(scenario.manifest.calibration?.known_shortcuts) &&
					scenario.manifest.calibration.known_shortcuts.includes(shortcutId),
				`${file} covers_shortcut_ids entries must be declared in scenario calibration.known_shortcuts: ${shortcutId}`
			);
		}
	}
	assert(contentFile.startsWith('fixtures/reward-hacking/'), `${file} content_file must live under fixtures/reward-hacking/`);
	assert(existsSync(path.join(root, graderFile)), `${file} grader_file does not exist: ${fixture.grader_file}`);
	assert(existsSync(path.join(root, contentFile)), `${file} content_file does not exist: ${fixture.content_file}`);
}

function assertShortcutCoverage(fixtures, scenarios) {
	const coverage = new Map();

	for (const { file, fixture } of fixtures) {
		if (!coverage.has(fixture.scenario_id)) {
			coverage.set(fixture.scenario_id, { negative: new Map(), positive: new Map() });
		}

		const scenarioCoverage = coverage.get(fixture.scenario_id);
		if (fixture.type === 'adversarial_negative_fixture' && fixture.shortcut_id) {
			if (!scenarioCoverage.negative.has(fixture.shortcut_id)) {
				scenarioCoverage.negative.set(fixture.shortcut_id, []);
			}
			scenarioCoverage.negative.get(fixture.shortcut_id).push(file);
		}
		if (fixture.type === 'positive_control_fixture') {
			for (const shortcutId of fixture.covers_shortcut_ids) {
				if (!scenarioCoverage.positive.has(shortcutId)) {
					scenarioCoverage.positive.set(shortcutId, []);
				}
				scenarioCoverage.positive.get(shortcutId).push(file);
			}
		}
	}

	for (const scenario of scenarios.values()) {
		const scenarioCoverage = coverage.get(scenario.manifest.id) || { negative: new Map(), positive: new Map() };
		for (const shortcutId of scenario.manifest.calibration?.known_shortcuts || []) {
			assert(
				scenarioCoverage.negative.has(shortcutId),
				`${scenario.file} calibration.known_shortcuts ${shortcutId} needs an adversarial_negative_fixture`
			);
			assert(
				scenarioCoverage.positive.has(shortcutId),
				`${scenario.file} calibration.known_shortcuts ${shortcutId} needs nearby positive_control_fixture coverage`
			);
		}
	}
}

function assertBenchmarkCandidateCoverage(fixtures, scenarios) {
	const coverage = new Map();

	for (const { file, fixture } of fixtures) {
		if (!coverage.has(fixture.scenario_id)) {
			coverage.set(fixture.scenario_id, {
				positive: [],
				negative: [],
				emptyOutputNegative: [],
			});
		}

		const scenarioCoverage = coverage.get(fixture.scenario_id);
		if (fixture.type === 'positive_control_fixture') {
			scenarioCoverage.positive.push(file);
		}
		if (fixture.type === 'adversarial_negative_fixture') {
			scenarioCoverage.negative.push(file);
			if (fixture.adversarial_case === 'empty_output') {
				scenarioCoverage.emptyOutputNegative.push(file);
			}
		}
	}

	for (const scenario of scenarios.values()) {
		if (!benchmarkCandidateScopes.has(scenario.manifest.calibration?.benchmark_scope)) {
			continue;
		}

		const scenarioCoverage = coverage.get(scenario.manifest.id) || {
			positive: [],
			negative: [],
			emptyOutputNegative: [],
		};
		assert(
			scenarioCoverage.positive.length > 0,
			`${scenario.file} benchmark-candidate scenarios need a positive_control_fixture`
		);
		assert(
			scenarioCoverage.negative.length > 0,
			`${scenario.file} benchmark-candidate scenarios need an adversarial_negative_fixture`
		);
		assert(
			scenarioCoverage.emptyOutputNegative.length > 0,
			`${scenario.file} benchmark-candidate scenarios need an empty_output adversarial_negative_fixture`
		);
	}
}

function runFixture(file, fixture) {
	const result = spawnSync(
		'php',
		['scripts/run-block-markup-fixture.php', path.join(root, file), root],
		{ cwd: root, encoding: 'utf8' }
	);

	assert(result.status === 0, `${file} fixture execution failed:\n${result.stdout}${result.stderr}`);

	let grade;
	try {
		grade = JSON.parse(result.stdout);
	} catch (error) {
		throw new Error(`${file} fixture runner did not emit JSON: ${error.message}\n${result.stdout}${result.stderr}`);
	}

	if (fixture.expected_result === 'fail') {
		assert(grade.success === false, `${file} expected fixture to fail, got success=true`);
		assert(Number(grade.reward) < 1, `${file} expected reward below 1, got ${grade.reward}`);
		for (const reason of fixture.expected_failure_reasons) {
			assert(
				Array.isArray(grade.failure_reasons) && grade.failure_reasons.includes(reason),
				`${file} expected failure reason ${reason}, got ${JSON.stringify(grade.failure_reasons || [])}`
			);
		}
	} else {
		assert(grade.success === true, `${file} expected fixture to pass, got success=false`);
		assert(Number(grade.reward) === 1, `${file} expected reward 1, got ${grade.reward}`);
		assert(Array.isArray(grade.failure_reasons) && grade.failure_reasons.length === 0, `${file} expected no failure reasons, got ${JSON.stringify(grade.failure_reasons || [])}`);
	}
}

const files = await listFixtureFiles();
assert(files.length > 0, 'Expected at least one reward-hacking fixture.');
const scenarios = await loadScenarios();
const fixtures = [];

for (const file of files) {
	const fixture = JSON.parse(await readFile(path.join(root, file), 'utf8'));
	validateFixture(file, fixture, scenarios);
	fixtures.push({ file, fixture });
	runFixture(file, fixture);
}

assertShortcutCoverage(fixtures, scenarios);
assertBenchmarkCandidateCoverage(fixtures, scenarios);

console.log(`Validated and executed ${files.length} reward-hacking fixture(s).`);
