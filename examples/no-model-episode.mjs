import { readFile } from 'node:fs/promises';
import { WPGym } from '../src/index.js';

const scenarioId = process.argv[2] || 'block-markup-no-fallback-pricing-section';
const env = await WPGym.make(scenarioId);

try {
	const content = await readFile(
		'fixtures/reward-hacking/block-markup/no-fallback-pricing-meaningful-content.wp.html',
		'utf8'
	);
	const reset = await env.reset({ seed: 'example' });
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
	const grade = await env.grade();
	const trace = await env.trace();

	console.log(JSON.stringify({ reset, step, grade, trace }, null, 2));
} finally {
	await env.close();
}
