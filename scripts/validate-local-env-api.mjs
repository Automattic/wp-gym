import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { WPGym } from '../src/index.js';

const scenarioId = 'block-markup-no-fallback-pricing-section';
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
});

const capabilities = await WPGym.capabilities(scenarioId);
assert.deepEqual(capabilities.allowed_action_types, ['wp_cli']);

const taskSet = await WPGym.describeTaskSet('first-live-run');
assert.equal(taskSet.id, 'first-live-run');
assert.ok(taskSet.scenario_ids.includes(scenarioId));

for (const args of [
	['bin/wp-gym.mjs', 'list', 'scenarios'],
	['bin/wp-gym.mjs', 'list', 'task-sets'],
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
	assert.equal(trace.steps.length, 1);
	assert.deepEqual(trace.metadata.allowed_action_types, ['wp_cli']);
} finally {
	await env.close();
}

console.log('Validated local WPGym reset/step/grade API.');
