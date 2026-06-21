import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { WPGym } from '../src/index.js';

const scenarioId = 'block-markup-no-fallback-pricing-section';
const workspaceScenarioId = 'modern-wordpress-api-abilities-site-summary';
const contentMigrationWorkspaceScenarioId = 'content-migration-media-attachment-import';
const codeboxEvalMetadataKeys = new Set(['scenario_id', 'task_set', 'task_set_id', 'task-set', 'grader', 'reward', 'failure_class', 'failure-class']);

function assertNoCodeboxEvalMetadata(value, label, trail = []) {
	if (!value || typeof value !== 'object') {
		return;
	}

	for (const [key, child] of Object.entries(value)) {
		const currentTrail = [...trail, key];
		assert(!codeboxEvalMetadataKeys.has(key), `${label} contains eval metadata key ${currentTrail.join('.')}`);
		assertNoCodeboxEvalMetadata(child, label, currentTrail);
	}
}

function assertWordPressRuntimeAdapter(adapter, label) {
	for (const method of ['wpCli', 'restRequest', 'filesystem', 'browserActions', 'browserMetrics', 'collectWorkspaceFiles', 'trace', 'close']) {
		assert.equal(typeof adapter?.[method], 'function', `${label} exposes ${method} adapter method`);
	}
}

async function assertCodeboxRuntimeArtifactMetadata(workspaceArtifacts, label) {
	const artifactDirectory = path.dirname(path.dirname(workspaceArtifacts.changed_files));
	const metadata = JSON.parse(await readFile(path.join(artifactDirectory, 'metadata.json'), 'utf8'));
	const runtimeTrace = JSON.parse(await readFile(path.join(artifactDirectory, 'files/runtime-episode-trace.json'), 'utf8'));

	assertNoCodeboxEvalMetadata(metadata, `${label} artifact metadata`);
	assertNoCodeboxEvalMetadata(runtimeTrace, `${label} runtime episode trace`);
}

const packageEntrypoint = await import('wp-gym');
assert.equal(packageEntrypoint.WPGym.apiVersion(), WPGym.apiVersion());
const actionSchema = await import('wp-gym/schemas/action.v1.schema.json', { with: { type: 'json' } });
assert.equal(actionSchema.default.title, 'WP Gym Action v1');

const scenarios = await WPGym.listScenarios();
assert.ok(scenarios.some((scenario) => scenario.id === scenarioId));
assert.ok(scenarios.some((scenario) => scenario.id === workspaceScenarioId));
assert.ok(scenarios.some((scenario) => scenario.id === contentMigrationWorkspaceScenarioId));

const taskSets = await WPGym.listTaskSets();
assert.ok(taskSets.some((taskSet) => taskSet.id === 'first-live-run'));

const description = await WPGym.describeScenario(scenarioId);
assert.equal(description.id, scenarioId);
assert.equal(description.capabilities.scenario_id, scenarioId);
assert.deepEqual(description.capabilities.schemas, {
	action: 'schemas/action.v1.schema.json',
	observation: 'schemas/observation.v1.schema.json',
	step_result: 'schemas/step-result.v1.schema.json',
	trace: 'schemas/trace.v1.schema.json',
	package_exports: {
		action: 'wp-gym/schemas/action.v1.schema.json',
		observation: 'wp-gym/schemas/observation.v1.schema.json',
		step_result: 'wp-gym/schemas/step-result.v1.schema.json',
		trace: 'wp-gym/schemas/trace.v1.schema.json',
	},
});

const api = WPGym.api();
assert.equal(WPGym.apiVersion(), 'wp-gym/js-env/v1');
assert.equal(api.api_version, WPGym.apiVersion());
assert.equal(api.versioning_policy.governance_boundary, 'Training-loop APIs use the js-env/v1 contract for environment methods and schemas. Benchmark promotion, run registry, and reporting use their own versioned records.');

const capabilities = await WPGym.capabilities(scenarioId);
assert.deepEqual(capabilities.allowed_action_types, ['wp_cli', 'rest', 'browser']);
assert.deepEqual(capabilities.replayable_action_types, ['wp_cli', 'rest', 'browser']);
assert.deepEqual(capabilities.evidence_only_action_types, []);
assert.deepEqual(capabilities.implemented_local_action_types, ['wp_cli', 'filesystem', 'rest', 'browser']);

const taskSet = await WPGym.describeTaskSet('first-live-run');
assert.equal(taskSet.id, 'first-live-run');
assert.ok(taskSet.scenario_ids.includes(scenarioId));

for (const args of [
	['bin/wp-gym.mjs', 'list', 'scenarios'],
	['bin/wp-gym.mjs', 'list', 'task-sets'],
	['bin/wp-gym.mjs', 'api'],
	['bin/wp-gym.mjs', 'show', 'scenario', scenarioId],
	['bin/wp-gym.mjs', 'show', 'task-set', 'first-live-run'],
	['bin/wp-gym.mjs', 'capabilities', scenarioId],
]) {
	const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.doesNotThrow(() => JSON.parse(result.stdout));
}

const content = await readFile(
	'fixtures/reward-hacking/block-markup/no-fallback-pricing-meaningful-content.wp.html',
	'utf8'
);
const env = await WPGym.make(scenarioId);

try {
	const reset = await env.reset({ seed: 1234 });
	assert.equal(reset.type, 'wp_state');
	assert.equal(reset.state.scenario_id, scenarioId);
	assert.equal(reset.state.reset_seed, '1234');
	assertWordPressRuntimeAdapter(env.runtimeEpisode, 'default runtime');

	const seededEpisodeId = reset.state.episode_id;
	const repeatedReset = await env.reset({ seed: 1234 });
	assert.equal(repeatedReset.state.episode_id, seededEpisodeId);
	assert.equal(repeatedReset.state.reset_seed, '1234');

	const restStep = await env.step({
		type: 'rest',
		method: 'GET',
		path: '/wp-json/',
	});
	assert.equal(restStep.observation.type, 'rest_response');
	assert.equal(restStep.observation.action_type, 'rest');
	assert.equal(restStep.observation.status, 200);
	assert.equal(restStep.observation.error, null);

	const browserFixture = await env.step({
		type: 'wp_cli',
		command: [
			'post create',
			'--post_type=page',
			'--post_status=publish',
			`--post_title=${WPGym.quoteCliValue('Browser Actions Fixture')}`,
			`--post_content=${WPGym.quoteCliValue('<main><input id="wp-gym-browser-input" value=""><button id="wp-gym-browser-button">Cook</button></main>')}`,
			'--porcelain',
		].join(' '),
	});
	assert.equal(browserFixture.observation.status, 0);
	const browserFixtureUrl = `/?page_id=${browserFixture.observation.stdout.trim()}`;

	const navigateStep = await env.step({
		type: 'browser',
		operation: 'navigate',
		replayability: 'replayable',
		url: browserFixtureUrl,
	});
	assert.equal(navigateStep.observation.type, 'browser_result');
	assert.equal(navigateStep.observation.action_type, 'browser');
	assert.equal(navigateStep.observation.operation, 'navigate');
	assert.equal(navigateStep.observation.error, null);

	const browserStep = await env.step({
		type: 'browser',
		operation: 'capture',
		replayability: 'replayable',
		url: browserFixtureUrl,
		selector: '#wp-gym-browser-input',
		capture: ['html'],
	});
	assert.equal(browserStep.observation.type, 'browser_result');
	assert.equal(browserStep.observation.action_type, 'browser');
	assert.equal(browserStep.observation.operation, 'capture');
	assert.equal(browserStep.observation.error, null);
	assert.ok(browserStep.observation.artifacts.some((artifact) => artifact.path === 'files/browser/snapshot.html'));

	for (const action of [
		{ operation: 'fill', selector: '#wp-gym-browser-input', value: 'Codebox' },
		{ operation: 'press', selector: '#wp-gym-browser-input', value: 'Tab' },
		{ operation: 'click', selector: '#wp-gym-browser-button' },
	]) {
		const interactionStep = await env.step({
			type: 'browser',
			replayability: 'replayable',
			url: browserFixtureUrl,
			capture: ['html'],
			...action,
		});
		assert.equal(interactionStep.observation.type, 'browser_result');
		assert.equal(interactionStep.observation.action_type, 'browser');
		assert.equal(interactionStep.observation.operation, action.operation);
		assert.equal(interactionStep.observation.error, null);
		assert.ok(interactionStep.observation.artifacts.some((artifact) => artifact.path === 'files/browser/steps.jsonl'));
	}

	const step = await env.step({
		type: 'wp_cli',
		command: [
			'post create',
			'--post_type=page',
			'--post_status=publish',
			`--post_title=${WPGym.quoteCliValue('Simple Pricing Page')}`,
			`--post_content=${WPGym.quoteCliValue(content)}`,
		].join(' '),
	});
	assert.equal(step.observation.status, 0);
	assert.equal(step.done, false);
	const runtimeTrace = await env.runtimeEpisode.trace();
	assertNoCodeboxEvalMetadata(runtimeTrace, 'wp_cli/browser runtime episode trace');

	const grade = await env.grade();
	assert.equal(grade.success, true);
	assert.equal(grade.reward, 1);
	assert.deepEqual(grade.failure_reasons, []);
	await assertCodeboxRuntimeArtifactMetadata(grade.telemetry.workspace_artifacts, 'wp_cli/browser');

	const trace = await env.trace();
	assert.equal(trace.scenario_id, scenarioId);
	assert.equal(trace.episode_id, seededEpisodeId);
	assert.equal(trace.metadata.reset_seed, '1234');
	assert.equal(trace.steps.length, 8);
	assert.deepEqual(trace.metadata.allowed_action_types, ['wp_cli', 'rest', 'browser']);
} finally {
	await env.close();
}

const workspaceEnv = await WPGym.make(workspaceScenarioId);
try {
	const reset = await workspaceEnv.reset({ seed: 'workspace-codebox' });
	assert.equal(reset.state.workspace_root, '/workspace');
	assertWordPressRuntimeAdapter(workspaceEnv.runtimeEpisode, 'workspace runtime');

	const runtimePlan = workspaceEnv.runtimePlan();
	assert.ok(runtimePlan.mounts.some((mount) => mount.target === '/workspace' && mount.mode === 'readwrite'));

	const writeStep = await workspaceEnv.step({
		type: 'filesystem',
		operation: 'write',
		path: 'plugins/site-summary/site-summary.php',
		content: "<?php\n/**\n * Plugin Name: Site Summary Smoke\n */\n",
	});
	assert.equal(writeStep.observation.type, 'files');
	assert.equal(writeStep.observation.action_type, 'filesystem');
	assert.equal(writeStep.observation.files[0].path, 'plugins/site-summary/site-summary.php');
	const filesystemRuntimeTrace = await workspaceEnv.runtimeEpisode.trace();
	assertNoCodeboxEvalMetadata(filesystemRuntimeTrace, 'workspace runtime episode trace');

	const readStep = await workspaceEnv.step({
		type: 'filesystem',
		operation: 'read',
		path: 'plugins/site-summary/site-summary.php',
	});
	assert.match(readStep.observation.files[0].content, /Site Summary Smoke/);

	const workspaceFiles = await workspaceEnv.workspaceFiles();
	assert.ok(workspaceFiles.includes('plugins/site-summary/site-summary.php'));

	const grade = await workspaceEnv.grade();
	assert.equal(grade.telemetry.runner, 'wordpress-runtime');
	assert.ok(grade.telemetry.workspace_artifacts.changed_files.endsWith('/files/changed-files.json'));
	await assertCodeboxRuntimeArtifactMetadata(grade.telemetry.workspace_artifacts, 'workspace');
	const changedFiles = JSON.parse(await readFile(grade.telemetry.workspace_artifacts.changed_files, 'utf8'));
	assert.ok(changedFiles.files.some((file) => file.mountTarget === '/workspace' && file.relativePath === 'plugins/site-summary/site-summary.php'));
} finally {
	await workspaceEnv.close();
}

const contentMigrationWorkspaceEnv = await WPGym.make(contentMigrationWorkspaceScenarioId);
try {
	const reset = await contentMigrationWorkspaceEnv.reset({ seed: 'content-migration-codebox' });
	assert.equal(reset.state.workspace_root, '/workspace');

	await contentMigrationWorkspaceEnv.step({
		type: 'filesystem',
		operation: 'write',
		path: 'plugins/importer/importer.php',
		content: "<?php\n/**\n * Plugin Name: Importer Smoke\n */\n",
	});

	const workspaceFiles = await contentMigrationWorkspaceEnv.workspaceFiles();
	assert.ok(workspaceFiles.includes('plugins/importer/importer.php'));

	const grade = await contentMigrationWorkspaceEnv.grade();
	assert.equal(grade.telemetry.runner, 'wordpress-runtime');
	assert.ok(grade.telemetry.workspace_artifacts.changed_files.endsWith('/files/changed-files.json'));
	await assertCodeboxRuntimeArtifactMetadata(grade.telemetry.workspace_artifacts, 'content migration workspace');
	const changedFiles = JSON.parse(await readFile(grade.telemetry.workspace_artifacts.changed_files, 'utf8'));
	assert.ok(changedFiles.files.some((file) => file.mountTarget === '/workspace' && file.relativePath === 'plugins/importer/importer.php'));
} finally {
	await contentMigrationWorkspaceEnv.close();
}

console.log('Validated local WPGym reset/step/grade API.');
