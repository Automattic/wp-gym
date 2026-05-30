import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reviewRoot = path.join(root, 'reviews', 'reward-soundness');
const scenarioRoot = path.join(root, 'scenarios');
const reviewCaseTypes = ['positive', 'negative', 'adversarial', 'borderline'];
const disagreementClasses = [
	'grader_false_positive',
	'grader_false_negative',
	'fixture_invalid',
	'reference_ambiguous',
	'task_ambiguous',
	'diagnostic_contract_gap',
];
const disagreementSeverities = ['critical', 'high', 'medium', 'low'];

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

function repoRelative(file) {
	return path.relative(root, file).replace(/\\/g, '/');
}

function scenarioTaskFamily(scenario) {
	return scenario.file.split('/')[1] || scenario.manifest.capabilities?.primary || 'uncategorized';
}

function zeroCounts(keys) {
	return Object.fromEntries(keys.map((key) => [key, 0]));
}

function createSummary(extra) {
	return {
		...extra,
		reviewed_cases: zeroCounts(reviewCaseTypes),
		agreements: 0,
		disagreements: 0,
		unresolved_disagreements: 0,
		disagreement_classes: zeroCounts(disagreementClasses),
		disagreement_severity: zeroCounts(disagreementSeverities),
		follow_ups: [],
	};
}

function finishSummary(summary) {
	const total = summary.agreements + summary.disagreements;
	return {
		...summary,
		agreement_rate: total === 0 ? 0 : summary.agreements / total,
		follow_ups: [...new Set(summary.follow_ups)].sort(),
	};
}

function addOutput(summary, output) {
	summary.reviewed_cases[output.review_case] = (summary.reviewed_cases[output.review_case] || 0) + 1;
	if (output.reviewer_classification === 'match') {
		summary.agreements += 1;
		return;
	}
	summary.disagreements += 1;
	if (output.disagreement_status === 'unresolved') {
		summary.unresolved_disagreements += 1;
	}
	if (output.disagreement_class) {
		summary.disagreement_classes[output.disagreement_class] = (summary.disagreement_classes[output.disagreement_class] || 0) + 1;
	}
	if (output.disagreement_severity) {
		summary.disagreement_severity[output.disagreement_severity] = (summary.disagreement_severity[output.disagreement_severity] || 0) + 1;
	}
	if (output.follow_up) {
		summary.follow_ups.push(output.follow_up);
	}
}

function addSummary(target, source) {
	for (const type of reviewCaseTypes) {
		target.reviewed_cases[type] += source.reviewed_cases[type] || 0;
	}
	target.agreements += source.agreements;
	target.disagreements += source.disagreements;
	target.unresolved_disagreements += source.unresolved_disagreements;
	for (const classification of disagreementClasses) {
		target.disagreement_classes[classification] += source.disagreement_classes[classification] || 0;
	}
	for (const severity of disagreementSeverities) {
		target.disagreement_severity[severity] += source.disagreement_severity[severity] || 0;
	}
	target.follow_ups.push(...source.follow_ups);
}

function loadScenarios() {
	const scenarios = new Map();
	for (const file of listJsonFiles(scenarioRoot)) {
		const manifest = readJson(file);
		scenarios.set(manifest.id, { file: repoRelative(file), manifest });
	}
	return scenarios;
}

function thresholdFailures(summary, policy, label) {
	const failures = [];
	if (summary.unresolved_disagreements > policy.max_unresolved_disagreements) {
		failures.push(`${label}:unresolved_disagreements>${policy.max_unresolved_disagreements}`);
	}
	for (const severity of disagreementSeverities) {
		const limit = policy.max_unresolved_by_severity?.[severity] ?? policy.max_unresolved_disagreements;
		if ((summary.disagreement_severity[severity] || 0) > limit) {
			failures.push(`${label}:${severity}_disagreements>${limit}`);
		}
	}
	if (summary.agreement_rate < policy.min_agreement_rate) {
		failures.push(`${label}:agreement_rate<${policy.min_agreement_rate}`);
	}
	return failures;
}

function buildArtifactReport(file, scenarios) {
	const artifact = readJson(file);
	const policy = {
		max_unresolved_disagreements: artifact.agreement_policy?.max_unresolved_disagreements ?? 0,
		max_unresolved_by_severity: artifact.agreement_policy?.max_unresolved_by_severity || {},
		min_agreement_rate: artifact.agreement_policy?.min_agreement_rate ?? 1,
	};
	const scenarioAgreement = [];
	const familySummaries = new Map();
	for (const review of artifact.reviews || []) {
		const scenario = scenarios.get(review.scenario_id);
		const family = scenario ? scenarioTaskFamily(scenario) : 'unknown';
		const scenarioSummary = createSummary({ scenario_id: review.scenario_id, family });
		for (const output of [...(review.representative_passed_outputs || []), ...(review.adversarial_or_failed_outputs || [])]) {
			addOutput(scenarioSummary, output);
		}
		const finishedScenario = finishSummary(scenarioSummary);
		scenarioAgreement.push(finishedScenario);
		if (!familySummaries.has(family)) {
			familySummaries.set(family, createSummary({ family, scenarios: [] }));
		}
		const familySummary = familySummaries.get(family);
		familySummary.scenarios.push(review.scenario_id);
		addSummary(familySummary, finishedScenario);
	}
	const taskFamilyAgreement = [...familySummaries.values()]
		.map((summary) => finishSummary({ ...summary, scenarios: [...new Set(summary.scenarios)].sort() }))
		.sort((left, right) => left.family.localeCompare(right.family));
	const failures = [
		...scenarioAgreement.flatMap((summary) => thresholdFailures(summary, policy, `scenario:${summary.scenario_id}`)),
		...taskFamilyAgreement.flatMap((summary) => thresholdFailures(summary, policy, `family:${summary.family}`)),
	];
	return {
		artifact: repoRelative(file),
		id: artifact.id,
		issue: artifact.issue,
		task_set_id: artifact.task_set_id,
		reviewer_type: artifact.reviewer_type,
		reviewed_at: artifact.reviewed_at,
		policy,
		status: failures.length === 0 ? 'pass' : 'fail',
		failures,
		scenario_agreement: scenarioAgreement.sort((left, right) => left.scenario_id.localeCompare(right.scenario_id)),
		task_family_agreement: taskFamilyAgreement,
	};
}

function buildReport({ artifactPath = null } = {}) {
	const scenarios = loadScenarios();
	const files = artifactPath ? [path.resolve(root, artifactPath)] : listJsonFiles(reviewRoot);
	const artifacts = files.map((file) => buildArtifactReport(file, scenarios));
	return {
		schema_version: 1,
		generated_by: 'wp-gym review-corpus agreement report',
		generated_at: new Date().toISOString(),
		status: artifacts.every((artifact) => artifact.status === 'pass') ? 'pass' : 'fail',
		artifacts,
	};
}

function markdownReport(report) {
	const lines = [
		'# Review-Corpus Agreement Report',
		'',
		`- Status: ${report.status}`,
		`- Artifacts: ${report.artifacts.length}`,
	];
	for (const artifact of report.artifacts) {
		lines.push(
			'',
			`## ${artifact.id}`,
			'',
			`- Artifact: ${artifact.artifact}`,
			`- Task set: ${artifact.task_set_id}`,
			`- Status: ${artifact.status}`,
			`- Failures: ${artifact.failures.length ? artifact.failures.join(', ') : 'none'}`,
			'',
			'### Scenario Agreement',
			'',
			'| Scenario | Family | Agreement | Unresolved | Follow-ups |',
			'| --- | --- | ---: | ---: | --- |',
		);
		for (const summary of artifact.scenario_agreement) {
			lines.push(`| ${summary.scenario_id} | ${summary.family} | ${summary.agreement_rate} | ${summary.unresolved_disagreements} | ${summary.follow_ups.join('<br>') || 'none'} |`);
		}
		lines.push('', '### Task-Family Agreement', '', '| Family | Scenarios | Agreement | Unresolved | Follow-ups |', '| --- | ---: | ---: | ---: | --- |');
		for (const summary of artifact.task_family_agreement) {
			lines.push(`| ${summary.family} | ${summary.scenarios.length} | ${summary.agreement_rate} | ${summary.unresolved_disagreements} | ${summary.follow_ups.join('<br>') || 'none'} |`);
		}
	}
	return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
	const args = { format: 'json', check: false };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--artifact') {
			args.artifactPath = argv[++i];
		} else if (arg === '--format') {
			args.format = argv[++i];
		} else if (arg === '--output') {
			args.output = argv[++i];
		} else if (arg === '--check') {
			args.check = true;
		} else if (arg === '--help' || arg === '-h') {
			args.help = true;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.error('Usage: node scripts/report-review-corpus-agreement.mjs [--artifact <path>] [--format json|markdown] [--output <file>] [--check]');
		process.exit(0);
	}
	const report = buildReport(args);
	const output = args.format === 'markdown' ? markdownReport(report) : `${JSON.stringify(report, null, 2)}\n`;
	if (args.output) {
		fs.writeFileSync(args.output, output);
	} else {
		process.stdout.write(output);
	}
	if (args.check && report.status !== 'pass') {
		process.exit(1);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}

export { buildReport };
