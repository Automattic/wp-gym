import crypto from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'fixtures', 'episode-results');
const validRoot = path.join(fixtureRoot, 'valid');
const invalidRoot = path.join(fixtureRoot, 'invalid');
const schemaPath = path.join(root, 'schemas', 'episode-result.schema.json');
const hashPattern = /^sha256:[0-9a-f]{64}$/;
const graderTools = new Set(['php_grader']);
const knownActors = new Set(['agent', 'grader', 'system']);

class ValidationError extends Error {
	constructor(code, message) {
		super(message);
		this.validationCode = code;
	}
}

function fail(code, message) {
	throw new ValidationError(code, message);
}

function assert(condition, code, message = null) {
	if (!condition) {
		if (message === null) {
			fail('validation_error', code);
		}
		fail(code, message);
	}
}

function normalizePath(value) {
	return value.replace(/\\/g, '/');
}

function resolveFrom(baseFile, candidate) {
	return normalizePath(path.relative(root, path.resolve(root, path.dirname(baseFile), candidate)));
}

function sha256(content) {
	return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}

async function fileSha256(relativePath) {
	return sha256(await readFile(path.join(root, relativePath)));
}

async function listJsonFiles(dir, relativeDir) {
	if (!existsSync(dir)) {
		return [];
	}

	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		const relativePath = path.join(relativeDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...await listJsonFiles(fullPath, relativePath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(normalizePath(relativePath));
		}
	}

	return files.sort();
}

async function scenarioFiles(dir = path.join(root, 'scenarios'), relativeDir = 'scenarios') {
	return listJsonFiles(dir, relativeDir);
}

async function loadScenarios() {
	const scenarios = new Map();

	for (const file of await scenarioFiles()) {
		const scenario = JSON.parse(await readFile(path.join(root, file), 'utf8'));
		scenarios.set(scenario.id, {
			file,
			manifest: scenario,
			promptFile: resolveFrom(file, scenario.prompt_file),
			graderFile: resolveFrom(file, scenario.grader_file),
		});
	}

	return scenarios;
}

function assertHash(value, label) {
	assert(typeof value === 'string' && hashPattern.test(value), `${label} must match sha256:<64 lowercase hex>`);
}

function assertArrayEqual(actual, expected, label) {
	assert(Array.isArray(actual), `${label} must be an array`);
	assert(Array.isArray(expected), `${label} expected value must be an array`);
	assert(
		JSON.stringify(actual) === JSON.stringify(expected),
		`${label} must match scenario manifest; expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
	);
}

function localArtifactPaths(artifacts) {
	const paths = [];
	if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
		return paths;
	}

	for (const value of Object.values(artifacts)) {
		if (typeof value !== 'string' || value.length === 0) {
			continue;
		}
		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
			continue;
		}
		paths.push(value);
	}

	return paths;
}

function localArtifactEntries(artifacts) {
	const entries = [];
	if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
		return entries;
	}

	for (const [key, value] of Object.entries(artifacts)) {
		if (typeof value !== 'string' || value.length === 0) {
			continue;
		}
		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
			continue;
		}
		entries.push([key, value]);
	}

	return entries;
}

function assertLocalArtifactPath(file, label, artifactPath) {
	const normalized = normalizePath(artifactPath);
	const isWindowsAbsolutePath = /^[A-Za-z]:\//.test(normalized);
	assert(
		!path.isAbsolute(normalized) &&
			!isWindowsAbsolutePath &&
			!normalized.split('/').includes('..'),
		'artifact_path_invalid',
		`${file} ${label} must be a repo-relative path without traversal: ${artifactPath}`
	);

	return normalized;
}

function requiredEpisodeArtifacts(scenario) {
	const required = ['transcript', 'replay_bundle', 'episode_jsonl'];
	const environment = scenario.manifest.environment || {};
	const expectedArtifacts = new Set(scenario.manifest.expected_artifacts || []);

	if (environment.action_mode === 'workspace' || expectedArtifacts.has('workspace_diff')) {
		required.push('workspace_diff');
	}

	return required;
}

function assertRequiredArtifact(file, artifacts, key) {
	assert(
		artifacts &&
			typeof artifacts === 'object' &&
			!Array.isArray(artifacts) &&
			typeof artifacts[key] === 'string' &&
			artifacts[key].length > 0,
		'artifact_missing',
		`${file} artifacts.${key} is required for replayable offline audit`
	);
}

function expectedFailureReasons(checks) {
	return [
		...new Set(
			checks
				.filter((check) => check && typeof check === 'object' && check.passed === false)
				.map((check) => check.failure_reason || check.id)
				.filter(Boolean)
		),
	].sort();
}

function assertClose(actual, expected, code, label) {
	assert(Math.abs(actual - expected) < 0.000001, code, `${label} expected ${expected}, got ${actual}`);
}

function gradeTotals(checks) {
	let score = 0;
	let maxScore = 0;

	for (const check of checks) {
		if (!check || typeof check !== 'object') {
			continue;
		}
		score += Number(check.score || 0);
		maxScore += Number(check.max_score || 0);
	}

	return {
		score: Number(score.toFixed(6)),
		maxScore: Number(maxScore.toFixed(6)),
	};
}

async function validateArtifactHashes(file, artifacts, artifactHashes, label) {
	const hashes = artifactHashes || {};

	for (const [key, artifactPath] of localArtifactEntries(artifacts)) {
		const safeArtifactPath = assertLocalArtifactPath(file, `${label}.${key}`, artifactPath);
		assert(
			Object.hasOwn(hashes, key),
			'artifact_hash_missing',
			`${file} ${label}.${key} must declare artifact_hashes.${key}`
		);
		assertHash(hashes[key], `${file} ${label}.artifact_hashes.${key}`);
		assert(
			hashes[key] === await fileSha256(safeArtifactPath),
			'artifact_hash_mismatch',
			`${file} ${label}.${key} hash does not match ${artifactPath}`
		);
	}

	for (const key of Object.keys(hashes)) {
		assert(
			artifacts && Object.hasOwn(artifacts, key),
			'artifact_hash_orphan',
			`${file} ${label}.artifact_hashes.${key} has no matching artifact`
		);
	}
}

async function validateEpisode(file, episode, scenarios, validateSchema) {
	const valid = validateSchema(episode);
	if (!valid) {
		fail('schema_error', `${file} schema errors: ${validateSchema.errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')}`);
	}

	const scenario = scenarios.get(episode.scenario.id);
	assert(scenario, `${file} references unknown scenario id: ${episode.scenario.id}`);

	assertHash(episode.scenario.manifest_sha256, `${file} scenario.manifest_sha256`);
	assertHash(episode.scenario.prompt_sha256, `${file} scenario.prompt_sha256`);
	assertHash(episode.scenario.grader_sha256, `${file} scenario.grader_sha256`);
	assertHash(episode.scenario.reset_hash, `${file} scenario.reset_hash`);
	assert(episode.scenario.manifest_sha256 === await fileSha256(scenario.file), `${file} scenario.manifest_sha256 does not match ${scenario.file}`);
	assert(episode.scenario.prompt_sha256 === await fileSha256(scenario.promptFile), `${file} scenario.prompt_sha256 does not match ${scenario.promptFile}`);
	assert(episode.scenario.grader_sha256 === await fileSha256(scenario.graderFile), `${file} scenario.grader_sha256 does not match ${scenario.graderFile}`);

	const environment = scenario.manifest.environment;
	assert(episode.environment.action_mode === environment.action_mode, `${file} environment.action_mode must match scenario manifest`);
	assertArrayEqual(episode.environment.observation_channels, environment.observation_channels, `${file} environment.observation_channels`);
	assertArrayEqual(episode.environment.allowed_tools, environment.allowed_tools, `${file} environment.allowed_tools`);
	assertArrayEqual(episode.environment.writable_roots, environment.writable_roots, `${file} environment.writable_roots`);
	assertArrayEqual(episode.environment.hidden_paths, environment.hidden_paths, `${file} environment.hidden_paths`);

	const [minReward, maxReward] = scenario.manifest.reward_spec.reward_range;
	assert(episode.result.reward >= minReward && episode.result.reward <= maxReward, `${file} result.reward must be within scenario reward_range`);
	assert(episode.result.grade.max_score > 0, `${file} result.grade.max_score must be positive`);
	assert(episode.result.grade.score >= 0 && episode.result.grade.score <= episode.result.grade.max_score, `${file} result.grade.score must be within grade bounds`);

	const normalizedReward = Number((episode.result.grade.score / episode.result.grade.max_score).toFixed(6));
	assert(Math.abs(episode.result.reward - normalizedReward) < 0.000001, `${file} result.reward must equal normalized grade score`);
	assert(
		episode.result.success === (episode.result.reward >= scenario.manifest.reward_spec.success_threshold),
		`${file} result.success must match reward_spec.success_threshold`
	);

	const failedReasons = expectedFailureReasons(episode.result.grade.checks);
	assertArrayEqual([...episode.result.failure_reasons].sort(), failedReasons, `${file} result.failure_reasons`);

	const totals = gradeTotals(episode.result.grade.checks);
	assertClose(episode.result.grade.score, totals.score, 'grade_score_mismatch', `${file} result.grade.score`);
	assertClose(episode.result.grade.max_score, totals.maxScore, 'grade_max_score_mismatch', `${file} result.grade.max_score`);

	for (const artifactKey of requiredEpisodeArtifacts(scenario)) {
		assertRequiredArtifact(file, episode.artifacts, artifactKey);
	}

	for (const artifactPath of localArtifactPaths(episode.artifacts)) {
		const safeArtifactPath = assertLocalArtifactPath(file, 'artifacts', artifactPath);
		assert(existsSync(path.join(root, safeArtifactPath)), `${file} artifact path does not exist: ${artifactPath}`);
	}
	await validateArtifactHashes(file, episode.artifacts, episode.artifact_hashes, 'artifacts');

	episode.steps.forEach((step, index) => {
		assert(knownActors.has(step.actor), 'unknown_actor', `${file} steps[${index}].actor is not recognized: ${step.actor}`);
		assert(step.index === index, `${file} steps[${index}].index must equal its position`);
		assert(step.observation.reset_hash === episode.scenario.reset_hash, `${file} steps[${index}].observation.reset_hash must match scenario.reset_hash`);
		assert(step.reward >= minReward && step.reward <= maxReward, `${file} steps[${index}].reward must be within scenario reward_range`);

		if (step.actor === 'agent') {
			assert(
				episode.environment.allowed_tools.includes(step.action.tool),
				'agent_tool_not_allowed',
				`${file} steps[${index}].action.tool is not allowed: ${step.action.tool}`
			);
		} else if (step.actor === 'grader') {
			assert(
				graderTools.has(step.action.tool),
				'grader_tool_not_allowed',
				`${file} steps[${index}].grader action.tool is not recognized: ${step.action.tool}`
			);
		}

		if (step.action.args_sha256 !== null && step.action.args_sha256 !== undefined) {
			assertHash(step.action.args_sha256, `${file} steps[${index}].action.args_sha256`);
		}
		if (step.result.workspace_diff_sha256 !== null && step.result.workspace_diff_sha256 !== undefined) {
			assertHash(step.result.workspace_diff_sha256, `${file} steps[${index}].result.workspace_diff_sha256`);
		}
		for (const artifactPath of localArtifactPaths(step.artifacts)) {
			const safeArtifactPath = assertLocalArtifactPath(file, `steps[${index}].artifacts`, artifactPath);
			assert(existsSync(path.join(root, safeArtifactPath)), `${file} steps[${index}] artifact path does not exist: ${artifactPath}`);
		}
		if (step.artifacts?.workspace_diff) {
			assert(
				step.result.workspace_diff_sha256 === step.artifact_hashes?.workspace_diff,
				'artifact_hash_mismatch',
				`${file} steps[${index}].result.workspace_diff_sha256 must match workspace_diff artifact hash`
			);
		}
	});

	for (let index = 0; index < episode.steps.length; index++) {
		await validateArtifactHashes(file, episode.steps[index].artifacts, episode.steps[index].artifact_hashes, `steps[${index}].artifacts`);
	}

	const finalStep = episode.steps[episode.steps.length - 1];
	const terminalGraderStep = finalStep?.actor === 'grader' ? finalStep : null;
	if (environment.termination_policy?.type === 'terminal_grader') {
		assert(
			terminalGraderStep,
			'terminal_grader_missing',
			`${file} terminal_grader scenarios must end with a grader step`
		);
	}
	if (terminalGraderStep) {
		assertClose(terminalGraderStep.reward, episode.result.reward, 'terminal_grader_mismatch', `${file} terminal grader reward`);
		assertArrayEqual(
			[...terminalGraderStep.failure_reasons].sort(),
			[...episode.result.failure_reasons].sort(),
			`${file} terminal grader failure_reasons`
		);
	}
}

async function main() {
	const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
	const ajv = new Ajv2020({ allErrors: true, strict: false });
	const validateSchema = ajv.compile(schema);
	const scenarios = await loadScenarios();
	const validFiles = await listJsonFiles(validRoot, 'fixtures/episode-results/valid');
	const invalidFiles = await listJsonFiles(invalidRoot, 'fixtures/episode-results/invalid');

	assert(validFiles.length > 0, 'Expected at least one valid episode result fixture.');
	assert(invalidFiles.length > 0, 'Expected at least one invalid episode result fixture.');

	for (const file of validFiles) {
		await validateEpisode(file, JSON.parse(await readFile(path.join(root, file), 'utf8')), scenarios, validateSchema);
	}

	for (const file of invalidFiles) {
		const episode = JSON.parse(await readFile(path.join(root, file), 'utf8'));
		assert(
			Array.isArray(episode.expected_validation_errors) && episode.expected_validation_errors.length > 0,
			`${file} must declare expected_validation_errors`
		);
		try {
			await validateEpisode(file, episode, scenarios, validateSchema);
		} catch (error) {
			const code = error.validationCode || 'validation_error';
			if (!episode.expected_validation_errors.includes(code)) {
				throw new Error(`${file} failed with ${code}, expected one of ${episode.expected_validation_errors.join(', ')}: ${error.message}`);
			}
			console.log(`Rejected invalid fixture ${file}: ${code} - ${error.message}`);
			continue;
		}
		throw new Error(`${file} was expected to be invalid but passed validation`);
	}

	console.log(`Validated ${validFiles.length} valid and ${invalidFiles.length} invalid episode result fixture(s).`);
}

await main();
