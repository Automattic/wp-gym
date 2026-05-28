import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { WPGym } from '../src/index.js';

const scenarioId = 'block-markup-no-fallback-pricing-section';
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
