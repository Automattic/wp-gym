import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { WPGym } from '../src/index.js';

const scenarioId = 'block-markup-no-fallback-pricing-section';
const packageEntrypoint = await import('wp-gym');
assert.equal(packageEntrypoint.WPGym.apiVersion(), WPGym.apiVersion());
const actionSchema = await import('wp-gym/schemas/action.v1.schema.json', { with: { type: 'json' } });
assert.equal(actionSchema.default.title, 'WP Gym Action v1');

const scenarios = await WPGym.listScenarios();
assert.ok(scenarios.some((scenario) => scenario.id === scenarioId));

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
assert.equal(api.versioning_policy.governance_boundary, 'Training-loop APIs are versioned separately from benchmark promotion, run registry, and reporting internals.');

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

	const browserStep = await env.step({
		type: 'browser',
		operation: 'capture',
		replayability: 'replayable',
		url: '/',
		capture: ['html'],
	});
	assert.equal(browserStep.observation.type, 'browser_result');
	assert.equal(browserStep.observation.action_type, 'browser');
	assert.equal(browserStep.observation.operation, 'capture');
	assert.equal(browserStep.observation.error, null);
	assert.ok(browserStep.observation.artifacts.some((artifact) => artifact.path === 'files/browser/snapshot.html'));

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

	const grade = await env.grade();
	assert.equal(grade.success, true);
	assert.equal(grade.reward, 1);
	assert.deepEqual(grade.failure_reasons, []);

	const trace = await env.trace();
	assert.equal(trace.scenario_id, scenarioId);
	assert.equal(trace.episode_id, seededEpisodeId);
	assert.equal(trace.metadata.reset_seed, '1234');
	assert.equal(trace.steps.length, 3);
	assert.deepEqual(trace.metadata.allowed_action_types, ['wp_cli', 'rest', 'browser']);
} finally {
	await env.close();
}

console.log('Validated local WPGym reset/step/grade API.');
