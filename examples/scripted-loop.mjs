import { readFile } from 'node:fs/promises';
import { WPGym } from '../src/index.js';

const scenarioId = process.argv[2] || 'block-markup-no-fallback-pricing-section';
const maxSteps = Number.parseInt(process.env.WPGYM_MAX_STEPS || '3', 10);
const env = await WPGym.make(scenarioId);

try {
	const content = await readFile(
		'fixtures/reward-hacking/block-markup/no-fallback-pricing-meaningful-content.wp.html',
		'utf8'
	);
	const actions = [
		{ type: 'rest', method: 'GET', path: '/wp-json/' },
		{
			type: 'wp_cli',
			command: [
				'post create',
				'--post_type=page',
				'--post_status=publish',
				`--post_title=${WPGym.quoteCliValue('Simple Pricing Page')}`,
				`--post_content=${WPGym.quoteCliValue(content)}`,
			].join(' '),
		},
	];

	const reset = await env.reset({ seed: 'scripted-loop' });
	const steps = [];

	for (const action of actions.slice(0, maxSteps)) {
		const result = await env.step(action);
		steps.push(result);
		if (result.done) {
			break;
		}
	}

	const grade = await env.grade();
	const trace = await env.trace();
	console.log(JSON.stringify({ api_version: WPGym.apiVersion(), reset, steps, grade, trace }, null, 2));
} finally {
	await env.close();
}
