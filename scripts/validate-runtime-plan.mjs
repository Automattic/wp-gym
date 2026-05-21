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
	await env.reset();
	await env.step({
		type: 'wp_cli',
		command: [
			'post create',
			'--post_type=page',
			'--post_status=publish',
			`--post_title=${WPGym.quoteCliValue('Simple Pricing Page')}`,
			`--post_content=${WPGym.quoteCliValue(content)}`,
		].join(' '),
	});

	const plan = env.runtimePlan();
	assert.equal(plan.schema, 'wp-gym/runtime-plan/v1');
	assert.equal(plan.scenario_id, scenarioId);
	assert.equal(plan.runtime.kind, 'wordpress');
	assert.equal(plan.mounts[0].role, 'scenario_repository');
	assert.equal(plan.actions[0].type, 'wp_cli');
	assert.equal(plan.grader.type, 'php');
	assert.equal(plan.grader.bootstrap, 'wordpress');

	assert.deepEqual(plan.actions.map((action) => action.type), ['wp_cli']);
} finally {
	await env.close();
}

console.log('Validated generic WPGym runtime plan projection.');
