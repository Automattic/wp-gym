import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { WPGym } from '../src/index.js';

const scenarioId = 'block-markup-no-fallback-pricing-section';
const content = await readFile(
	'fixtures/reward-hacking/block-markup/no-fallback-pricing-meaningful-content.wp.html',
	'utf8'
);
const env = await WPGym.make(scenarioId, { backend: 'wp-codebox', wpCodeboxDryRun: true });

try {
	await env.reset();
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
	assert.equal(step.observation.type, 'logs');
	assert.equal(step.observation.metadata.backend, 'wp-codebox');

	const recipe = await env.wpCodeboxRecipe();
	assert.equal(recipe.schema, 'wp-codebox/workspace-recipe/v1');
	assert.equal(recipe.runtime.backend, 'wordpress-playground');
	assert.deepEqual(recipe.inputs.mounts, [
		{
			source: process.cwd(),
			target: '/inputs/repo',
			mode: 'readonly',
		},
	]);
	assert.equal(recipe.workflow.steps[0].command, 'wordpress.wp-cli');
	assert.equal(recipe.workflow.steps[1].command, 'wordpress.run-php');
	assert.match(recipe.workflow.steps[1].args[0], /^code-file=/);

	const dryGrade = await env.grade();
	assert.equal(dryGrade.success, false);
	assert.deepEqual(dryGrade.failure_reasons, ['wp_codebox_dry_run']);
} finally {
	await env.close();
}

console.log('Validated wp-codebox backend recipe adapter.');
