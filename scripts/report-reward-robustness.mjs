import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const benchmarkCandidateScopes = new Set(['calibration', 'benchmark']);
const requiredCandidateCases = ['nearby_positive', 'adversarial_negative', 'borderline_negative'];

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listJsonFiles(dir) {
	if (!fs.existsSync(dir)) {
		return [];
	}

	const files = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...listJsonFiles(entryPath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(entryPath);
		}
	}
	return files.sort();
}

function repoRelative(root, file) {
	return path.relative(root, file).replace(/\\/g, '/');
}

function taskFamily(scenario) {
	return scenario.file.split('/')[1] || scenario.manifest.split?.variant_family?.split('-').slice(0, 2).join('-') || 'uncategorized';
}

function loadScenarios(root) {
	const scenarios = new Map();
	for (const file of listJsonFiles(path.join(root, 'scenarios'))) {
		const manifest = readJson(file);
		scenarios.set(manifest.id, { file: repoRelative(root, file), manifest });
	}
	return scenarios;
}

function loadFixtureCoverage(root) {
	const coverage = new Map();
	for (const file of listJsonFiles(path.join(root, 'fixtures', 'reward-hacking'))) {
		const fixture = readJson(file);
		if (!fixture.scenario_id) {
			continue;
		}
		if (!coverage.has(fixture.scenario_id)) {
			coverage.set(fixture.scenario_id, {
				fixtures: [],
				cases: Object.fromEntries(requiredCandidateCases.map((caseName) => [caseName, []])),
				shortcut_negative: new Map(),
				shortcut_positive: new Map(),
				failure_reasons: {},
			});
		}

		const scenarioCoverage = coverage.get(fixture.scenario_id);
		const relativeFile = repoRelative(root, file);
		scenarioCoverage.fixtures.push(relativeFile);
		if (scenarioCoverage.cases[fixture.robustness_case]) {
			scenarioCoverage.cases[fixture.robustness_case].push(relativeFile);
		}
		if (fixture.type === 'adversarial_negative_fixture' && fixture.shortcut_id) {
			if (!scenarioCoverage.shortcut_negative.has(fixture.shortcut_id)) {
				scenarioCoverage.shortcut_negative.set(fixture.shortcut_id, []);
			}
			scenarioCoverage.shortcut_negative.get(fixture.shortcut_id).push(relativeFile);
		}
		if (fixture.type === 'positive_control_fixture') {
			for (const shortcutId of fixture.covers_shortcut_ids || []) {
				if (!scenarioCoverage.shortcut_positive.has(shortcutId)) {
					scenarioCoverage.shortcut_positive.set(shortcutId, []);
				}
				scenarioCoverage.shortcut_positive.get(shortcutId).push(relativeFile);
			}
		}
		for (const reason of fixture.expected_failure_reasons || []) {
			scenarioCoverage.failure_reasons[reason] = (scenarioCoverage.failure_reasons[reason] || 0) + 1;
		}
	}
	return coverage;
}

function buildScenarioReport(scenario, coverage) {
	const manifest = scenario.manifest;
	const scenarioCoverage = coverage.get(manifest.id) || {
		fixtures: [],
		cases: Object.fromEntries(requiredCandidateCases.map((caseName) => [caseName, []])),
		shortcut_negative: new Map(),
		shortcut_positive: new Map(),
		failure_reasons: {},
	};
	const benchmarkCandidate = benchmarkCandidateScopes.has(manifest.calibration?.benchmark_scope);
	const gaps = [];

	if (benchmarkCandidate) {
		for (const caseName of requiredCandidateCases) {
			if ((scenarioCoverage.cases[caseName] || []).length === 0) {
				gaps.push(`missing_${caseName}`);
			}
		}
	}

	for (const shortcutId of manifest.calibration?.known_shortcuts || []) {
		if (!scenarioCoverage.shortcut_negative.has(shortcutId)) {
			gaps.push(`missing_shortcut_negative_fixture:${shortcutId}`);
		}
		if (!scenarioCoverage.shortcut_positive.has(shortcutId)) {
			gaps.push(`missing_shortcut_positive_fixture:${shortcutId}`);
		}
	}

	return {
		scenario_id: manifest.id,
		file: scenario.file,
		task_family: taskFamily(scenario),
		benchmark_scope: manifest.calibration?.benchmark_scope || 'unknown',
		benchmark_candidate: benchmarkCandidate,
		status: gaps.length === 0 ? 'pass' : 'fail',
		gaps,
		fixtures: scenarioCoverage.fixtures.length,
		robustness_cases: Object.fromEntries(Object.entries(scenarioCoverage.cases).map(([caseName, files]) => [caseName, files.length])),
		known_shortcuts: (manifest.calibration?.known_shortcuts || []).map((shortcutId) => ({
			shortcut_id: shortcutId,
			adversarial_negatives: scenarioCoverage.shortcut_negative.get(shortcutId) || [],
			nearby_positives: scenarioCoverage.shortcut_positive.get(shortcutId) || [],
		})),
		failure_reasons: scenarioCoverage.failure_reasons,
	};
}

function buildFamilyReports(scenarios) {
	const families = new Map();
	for (const scenario of scenarios) {
		if (!families.has(scenario.task_family)) {
			families.set(scenario.task_family, {
				family: scenario.task_family,
				scenarios: 0,
				benchmark_candidates: 0,
				passing: 0,
				gaps: {},
				robustness_cases: Object.fromEntries(requiredCandidateCases.map((caseName) => [caseName, 0])),
				failure_reasons: {},
			});
		}
		const family = families.get(scenario.task_family);
		family.scenarios += 1;
		family.benchmark_candidates += scenario.benchmark_candidate ? 1 : 0;
		family.passing += scenario.status === 'pass' ? 1 : 0;
		for (const gap of scenario.gaps) {
			family.gaps[gap] = (family.gaps[gap] || 0) + 1;
		}
		for (const [caseName, count] of Object.entries(scenario.robustness_cases)) {
			family.robustness_cases[caseName] += count;
		}
		for (const [reason, count] of Object.entries(scenario.failure_reasons)) {
			family.failure_reasons[reason] = (family.failure_reasons[reason] || 0) + count;
		}
	}
	return [...families.values()].sort((left, right) => left.family.localeCompare(right.family));
}

function buildRewardRobustnessReport({ root = moduleRoot } = {}) {
	const scenarios = loadScenarios(root);
	const coverage = loadFixtureCoverage(root);
	const scenarioReports = [...scenarios.values()]
		.map((scenario) => buildScenarioReport(scenario, coverage))
		.sort((left, right) => left.scenario_id.localeCompare(right.scenario_id));
	const candidateReports = scenarioReports.filter((scenario) => scenario.benchmark_candidate);
	const blockers = candidateReports.flatMap((scenario) => scenario.gaps.map((gap) => `${scenario.scenario_id}:${gap}`));
	return {
		schema_version: 1,
		generated_by: 'wp-gym reward-robustness report',
		status: blockers.length === 0 ? 'pass' : 'fail',
		blockers,
		summary: {
			scenarios: scenarioReports.length,
			benchmark_candidates: candidateReports.length,
			benchmark_candidates_passing: candidateReports.filter((scenario) => scenario.status === 'pass').length,
		},
		task_families: buildFamilyReports(scenarioReports),
		scenarios: scenarioReports,
	};
}

function parseArgs(argv) {
	return { check: argv.includes('--check') };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = parseArgs(process.argv.slice(2));
	const report = buildRewardRobustnessReport();
	console.log(JSON.stringify(report, null, 2));
	if (args.check && report.status !== 'pass') {
		process.exit(1);
	}
}

export { buildRewardRobustnessReport };
