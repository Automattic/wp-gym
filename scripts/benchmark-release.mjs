import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const versionPattern = /^\d+\.\d+\.\d+(?:-[a-z0-9][a-z0-9.-]*)?$/;
const hashPattern = /^[a-f0-9]{64}$/;
const releaseStatuses = new Set(['pilot', 'calibrating', 'benchmark_ready', 'deprecated', 'retired']);
const releaseTypes = new Set(['pilot', 'calibration', 'headline']);
const requiredIdentityFields = [
	'manifest_sha256',
	'prompt_sha256',
	'grader_sha256',
	'setup_sha256',
	'expected_artifacts_sha256',
	'replay_contract_sha256',
];

function parseArgs(argv) {
	const args = {
		command: argv[2],
		taskSet: 'benchmark-readiness-pilot',
		input: '',
		output: '',
		check: false,
	};

	for (let index = 3; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === '--task-set') {
			args.taskSet = argv[++index];
		} else if (arg === '--input') {
			args.input = argv[++index];
		} else if (arg === '--output') {
			args.output = argv[++index];
		} else if (arg === '--check') {
			args.check = true;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return args;
}

async function readJson(relativePath) {
	return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

async function sha256File(relativePath) {
	return createHash('sha256')
		.update(await readFile(path.join(root, relativePath)))
		.digest('hex');
}

function sha256Object(value) {
	return createHash('sha256')
		.update(JSON.stringify(value))
		.digest('hex');
}

function resolveRepoRelative(fromFile, candidate) {
	return path.relative(root, path.resolve(root, path.dirname(fromFile), candidate)).replace(/\\/g, '/');
}

function taskSetPath(taskSetId) {
	return `task-sets/${taskSetId}.json`;
}

function releaseTypeForTaskSet(taskSet) {
	if (taskSet.benchmark_status === 'benchmark_ready' && taskSet.benchmark === true) {
		return 'headline';
	}
	if (taskSet.benchmark_status === 'calibrating') {
		return 'calibration';
	}
	return 'pilot';
}

async function scenarioReleaseEntry(taskSetFile, scenarioManifestRef, taskSet) {
	const scenarioFile = resolveRepoRelative(taskSetFile, scenarioManifestRef);
	const scenario = await readJson(scenarioFile);
	const promptFile = resolveRepoRelative(scenarioFile, scenario.prompt_file);
	const graderFile = resolveRepoRelative(scenarioFile, scenario.grader_file);
	const identity = {
		manifest_sha256: await sha256File(scenarioFile),
		prompt_sha256: await sha256File(promptFile),
		grader_sha256: await sha256File(graderFile),
		setup_sha256: sha256Object({
			environment: scenario.environment,
			split: scenario.split,
		}),
		expected_artifacts_sha256: sha256Object({
			expected_artifacts: scenario.expected_artifacts || [],
			expected: scenario.expected || {},
		}),
		replay_contract_sha256: sha256Object({
			episode_contract: scenario.episode_contract,
			reward_spec: scenario.reward_spec,
		}),
	};

	return {
		scenario_id: scenario.id,
		manifest: scenarioFile,
		manifest_sha256: identity.manifest_sha256,
		prompt: promptFile,
		grader: graderFile,
		benchmark_status: scenario.calibration?.status || 'pilot',
		benchmark_scope: scenario.calibration?.benchmark_scope || 'pilot',
		benchmark_version: scenario.calibration?.benchmark_metadata?.benchmark_version || taskSet.benchmark_metadata?.benchmark_version || null,
		compatibility_group: scenario.calibration?.benchmark_metadata?.compatibility_group || scenario.id,
		compatible_with: scenario.calibration?.benchmark_metadata?.compatible_with || [],
		split: scenario.split?.membership || null,
		private_pack_reference: scenario.split?.held_out_private_variant?.reference || null,
		private_pack_status: scenario.split?.held_out_private_variant?.status || null,
		task_contract_level: scenario.calibration?.task_contract_level || null,
		expected_artifacts: scenario.expected_artifacts || [],
		version_identity: identity,
	};
}

async function buildRelease({ taskSetId }) {
	const taskSetFile = taskSetPath(taskSetId);
	const taskSet = await readJson(taskSetFile);
	const taskSetHash = await sha256File(taskSetFile);
	const releaseType = releaseTypeForTaskSet(taskSet);
	const scenarios = [];

	for (const scenarioManifest of taskSet.scenario_manifests || []) {
		scenarios.push(await scenarioReleaseEntry(taskSetFile, scenarioManifest, taskSet));
	}

	return {
		schema_version: 1,
		report_schema_version: 'wp-gym/benchmark-release-report/v1',
		release: {
			id: `${taskSet.id}@${taskSet.benchmark_metadata?.benchmark_version || 'unversioned'}`,
			type: releaseType,
			status: taskSet.benchmark_status || 'pilot',
			benchmark_version: taskSet.benchmark_metadata?.benchmark_version || null,
			compatibility_group: taskSet.benchmark_metadata?.compatibility_group || null,
			compatible_with: taskSet.benchmark_metadata?.compatible_with || [],
			task_set_id: taskSet.id,
			task_set_manifest: taskSetFile,
			task_set_manifest_sha256: taskSetHash,
			headline_score_eligible: taskSet.headline_score_eligible === true,
			aggregate_score: taskSet.aggregate_score === true,
			score_scope: taskSet.score_scope,
			task_contract_level: taskSet.task_contract_level,
		},
		policies: {
			task_set_policy: 'Task membership, weighting, aggregate eligibility, score scope, or task contract changes require a new benchmark release version.',
			scoring_policy: 'Terminal grader behavior, success thresholds, reward ranges, aggregate policy, and headline eligibility are release-versioned inputs.',
			runtime_policy: 'Runtime setup, allowed actions, writable roots, hidden paths, replay schema, and provenance requirements are part of version identity.',
			private_pack_policy: 'Private or held-out packs are referenced by sealed version labels and hashes; rotating contents or graders requires a new private pack version and benchmark release.',
			compatibility_policy: 'Only releases that share a compatibility group and explicitly list compatible versions may be compared in headline reports.',
		},
		scenarios,
		validation: {
			commands: [
				'npm run benchmark-release:validate',
				'npm run validate',
				'npm run run-registry:validate',
				'npm run benchmark-promotion:test',
			],
			checklist: [
				'release manifest validates from current repo metadata',
				'task-set status is classified as pilot, calibration, or headline',
				'every scenario has task, scoring, runtime, replay, and private-pack version identity',
				'benchmark-mode reports include release.id and release.benchmark_version before citation',
			],
		},
	};
}

function assertObject(value, label) {
	if (!value || Array.isArray(value) || typeof value !== 'object') {
		throw new Error(`${label} must be an object`);
	}
}

function assertHash(value, label) {
	if (typeof value !== 'string' || !hashPattern.test(value)) {
		throw new Error(`${label} must be a sha256 hex digest`);
	}
}

function validateReleaseManifest(manifest) {
	assertObject(manifest, 'release manifest');
	if (manifest.schema_version !== 1) {
		throw new Error('release manifest schema_version must be 1');
	}
	if (manifest.report_schema_version !== 'wp-gym/benchmark-release-report/v1') {
		throw new Error('release manifest report_schema_version must be wp-gym/benchmark-release-report/v1');
	}
	assertObject(manifest.release, 'release manifest release');
	if (!releaseTypes.has(manifest.release.type)) {
		throw new Error(`release.type has unknown value: ${manifest.release.type}`);
	}
	if (!releaseStatuses.has(manifest.release.status)) {
		throw new Error(`release.status has unknown value: ${manifest.release.status}`);
	}
	if (typeof manifest.release.benchmark_version !== 'string' || !versionPattern.test(manifest.release.benchmark_version)) {
		throw new Error('release.benchmark_version must be semver-like');
	}
	for (const field of ['id', 'compatibility_group', 'task_set_id', 'task_set_manifest', 'score_scope', 'task_contract_level']) {
		if (typeof manifest.release[field] !== 'string' || manifest.release[field].length < 1) {
			throw new Error(`release.${field} must be a non-empty string`);
		}
	}
	assertHash(manifest.release.task_set_manifest_sha256, 'release.task_set_manifest_sha256');
	for (const field of ['headline_score_eligible', 'aggregate_score']) {
		if (typeof manifest.release[field] !== 'boolean') {
			throw new Error(`release.${field} must be a boolean`);
		}
	}
	assertObject(manifest.policies, 'release manifest policies');
	for (const field of ['task_set_policy', 'scoring_policy', 'runtime_policy', 'private_pack_policy', 'compatibility_policy']) {
		if (typeof manifest.policies[field] !== 'string' || manifest.policies[field].length < 1) {
			throw new Error(`policies.${field} must be a non-empty string`);
		}
	}
	if (!Array.isArray(manifest.scenarios) || manifest.scenarios.length < 1) {
		throw new Error('release manifest must include scenarios');
	}
	for (const scenario of manifest.scenarios) {
		for (const field of ['scenario_id', 'manifest', 'prompt', 'grader', 'benchmark_status', 'benchmark_scope', 'benchmark_version', 'compatibility_group', 'split', 'task_contract_level']) {
			if (typeof scenario[field] !== 'string' || scenario[field].length < 1) {
				throw new Error(`scenario ${scenario.scenario_id || '<unknown>'}.${field} must be a non-empty string`);
			}
		}
		assertHash(scenario.manifest_sha256, `scenario ${scenario.scenario_id}.manifest_sha256`);
		assertObject(scenario.version_identity, `scenario ${scenario.scenario_id}.version_identity`);
		for (const field of requiredIdentityFields) {
			assertHash(scenario.version_identity[field], `scenario ${scenario.scenario_id}.version_identity.${field}`);
		}
	}
	assertObject(manifest.validation, 'release manifest validation');
	for (const field of ['commands', 'checklist']) {
		if (!Array.isArray(manifest.validation[field]) || manifest.validation[field].length < 1) {
			throw new Error(`validation.${field} must be a non-empty array`);
		}
	}

	return true;
}

async function listReleaseFixtures(dir = path.join(root, 'benchmark-releases')) {
	if (!existsSync(dir)) {
		return [];
	}
	const entries = await readdir(dir, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
		.map((entry) => path.join('benchmark-releases', entry.name))
		.sort();
}

async function validateFixture(relativePath, { checkFresh = true } = {}) {
	const manifest = await readJson(relativePath);
	validateReleaseManifest(manifest);

	if (checkFresh) {
		const fresh = await buildRelease({ taskSetId: manifest.release.task_set_id });
		if (JSON.stringify(manifest) !== JSON.stringify(fresh)) {
			throw new Error(`${relativePath} is stale; regenerate with npm run benchmark-release:generate -- --task-set ${manifest.release.task_set_id} --output ${relativePath}`);
		}
	}

	return manifest;
}

async function main() {
	const args = parseArgs(process.argv);

	if (args.command === 'generate') {
		const manifest = await buildRelease({ taskSetId: args.taskSet });
		validateReleaseManifest(manifest);
		const json = `${JSON.stringify(manifest, null, 2)}\n`;
		if (args.output) {
			await mkdir(path.dirname(path.join(root, args.output)), { recursive: true });
			await writeFile(path.join(root, args.output), json);
		} else {
			process.stdout.write(json);
		}
		return;
	}

	if (args.command === 'validate') {
		const fixtures = args.input ? [args.input] : await listReleaseFixtures();
		if (fixtures.length < 1) {
			throw new Error('No benchmark release fixtures found.');
		}
		for (const fixture of fixtures) {
			await validateFixture(fixture, { checkFresh: true });
		}
		console.log(`Validated ${fixtures.length} benchmark release manifest(s).`);
		return;
	}

	console.error([
		'Usage:',
		'  benchmark-release generate --task-set <task-set-id> [--output <path>]',
		'  benchmark-release validate [--input <path>]',
	].join('\n'));
	process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error.message);
		process.exit(1);
	});
}

export { buildRelease, validateFixture, validateReleaseManifest };
