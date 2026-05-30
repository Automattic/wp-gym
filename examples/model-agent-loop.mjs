import { readFile } from 'node:fs/promises';
import { WPGym } from '../src/index.js';

const scenarioId = process.argv[2] || 'block-markup-no-fallback-pricing-section';
const env = await WPGym.make(scenarioId);

async function chooseAction({ capabilities, stepIndex }) {
	if (stepIndex === 0 && capabilities.replayable_action_types.includes('rest')) {
		return { type: 'rest', method: 'GET', path: '/wp-json/' };
	}

	const content = await readFile(
		'fixtures/reward-hacking/block-markup/no-fallback-pricing-meaningful-content.wp.html',
		'utf8'
	);
	return {
		type: 'wp_cli',
		command: [
			'post create',
			'--post_type=page',
			'--post_status=publish',
			`--post_title=${WPGym.quoteCliValue('Simple Pricing Page')}`,
			`--post_content=${WPGym.quoteCliValue(content)}`,
		].join(' '),
	};
}

try {
	const capabilities = await WPGym.capabilities(scenarioId);
	const reset = await env.reset({ seed: process.env.WPGYM_SEED || 'model-agent-loop' });
	const steps = [];
	let observation = reset;

	for (let stepIndex = 0; stepIndex < 2; stepIndex += 1) {
		const action = await chooseAction({ capabilities, observation, stepIndex });
		const result = await env.step(action);
		steps.push({ action, result });
		observation = result.observation;
		if (result.done) {
			break;
		}
	}

	const terminalGrade = await env.grade();
	const trace = await env.trace();
	console.log(JSON.stringify({ api: WPGym.api(), scenario_id: scenarioId, reset, steps, terminal_grade: terminalGrade, trace }, null, 2));
} finally {
	await env.close();
}
