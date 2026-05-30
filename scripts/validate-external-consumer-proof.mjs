import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const keepTemp = process.env.WPGYM_KEEP_EXTERNAL_CONSUMER_TMP === '1';
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'wp-gym-external-consumer-'));
const consumerDir = path.join(tempRoot, 'consumer');

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd || root,
		env: { ...process.env, ...(options.env || {}) },
		encoding: 'utf8',
		maxBuffer: 1024 * 1024 * 20,
	});

	if (result.status !== 0) {
		throw new Error([
			`Command failed: ${command} ${args.join(' ')}`,
			`cwd: ${options.cwd || root}`,
			result.stdout.trim() ? `stdout:\n${result.stdout}` : '',
			result.stderr.trim() ? `stderr:\n${result.stderr}` : '',
		].filter(Boolean).join('\n\n'));
	}

	return result.stdout;
}

function jsonFromCli(command, args) {
	return JSON.parse(run(command, args, { cwd: consumerDir }));
}

await mkdir(consumerDir, { recursive: true });

try {
	await writeFile(path.join(consumerDir, 'package.json'), JSON.stringify({
		private: true,
		type: 'module',
		dependencies: {
			'wp-gym': `file:${root}`,
		},
	}, null, 2));

	run('npm', ['install', '--no-audit', '--no-fund', '--package-lock=false'], { cwd: consumerDir });

	await writeFile(path.join(consumerDir, 'consumer-proof.mjs'), `
import assert from 'node:assert/strict';
import { WPGym } from 'wp-gym';
import actionSchema from 'wp-gym/schemas/action.v1.schema.json' with { type: 'json' };

const scenarioId = 'block-markup-no-fallback-pricing-section';
const api = WPGym.api();
assert.equal(api.api_version, 'wp-gym/js-env/v1');
assert.equal(actionSchema.title, 'WP Gym Action v1');

const scenarios = await WPGym.listScenarios();
assert.ok(scenarios.some((scenario) => scenario.id === scenarioId));

const taskSets = await WPGym.listTaskSets();
assert.ok(taskSets.some((taskSet) => taskSet.scenario_ids.includes(scenarioId)));

const scenario = await WPGym.describeScenario(scenarioId);
assert.equal(scenario.id, scenarioId);
assert.deepEqual(scenario.capabilities.allowed_action_types, ['wp_cli', 'rest', 'browser']);

const env = await WPGym.make(scenarioId, { runtime: 'local' });
try {
	const reset = await env.reset({ seed: 'external-lab-consumer-proof' });
	assert.equal(reset.state.scenario_id, scenarioId);
	assert.equal(reset.state.reset_seed, 'external-lab-consumer-proof');

	const step = await env.step({
		type: 'wp_cli',
		command: [
			'post create',
			'--post_type=page',
			'--post_status=publish',
			'--post_title=' + WPGym.quoteCliValue('External Lab Proof'),
			'--post_content=' + WPGym.quoteCliValue('<!-- wp:paragraph --><p>External lab consumer proof.</p><!-- /wp:paragraph -->'),
		].join(' '),
	});
	assert.equal(step.observation.type, 'command_result');
	assert.equal(step.observation.status, 0);

	const grade = await env.grade();
	assert.equal(typeof grade.success, 'boolean');
	assert.equal(typeof grade.reward, 'number');
	assert.ok(Array.isArray(grade.checks));

	const trace = await env.trace();
	assert.equal(trace.scenario_id, scenarioId);
	assert.equal(trace.steps.length, 1);

	console.log(JSON.stringify({
		api_version: WPGym.apiVersion(),
		scenario_id: scenarioId,
		discovered_scenarios: scenarios.length,
		discovered_task_sets: taskSets.length,
		reset_seed: reset.state.reset_seed,
		step_observation: step.observation.type,
		step_status: step.observation.status,
		grade_success: grade.success,
		grade_reward: grade.reward,
		trace_steps: trace.steps.length,
	}, null, 2));
} finally {
	await env.close();
}
`);

	const bin = path.join(consumerDir, 'node_modules/.bin/wp-gym');
	const api = jsonFromCli(bin, ['api']);
	assert.equal(api.api_version, 'wp-gym/js-env/v1');
	assert.ok(jsonFromCli(bin, ['list', 'scenarios']).length > 0);
	assert.ok(jsonFromCli(bin, ['list', 'task-sets']).length > 0);
	assert.equal(jsonFromCli(bin, ['capabilities', 'block-markup-no-fallback-pricing-section']).scenario_id, 'block-markup-no-fallback-pricing-section');

	const consumerOutput = JSON.parse(run(process.execPath, ['consumer-proof.mjs'], { cwd: consumerDir }));
	assert.equal(consumerOutput.api_version, 'wp-gym/js-env/v1');
	assert.equal(consumerOutput.trace_steps, 1);

	run(bin, ['run-registry', 'validate', '--benchmark-mode'], { cwd: consumerDir });

	console.log(JSON.stringify({
		status: 'passed',
		proof: 'external-consumer-install-import-discovery-reset-step-grade-trace-registry',
		consumer_dir: keepTemp ? consumerDir : null,
		api_version: consumerOutput.api_version,
		discovered_scenarios: consumerOutput.discovered_scenarios,
		discovered_task_sets: consumerOutput.discovered_task_sets,
		step_observation: consumerOutput.step_observation,
		trace_steps: consumerOutput.trace_steps,
		registry_validation: 'passed',
	}, null, 2));
} finally {
	if (!keepTemp) {
		await rm(tempRoot, { recursive: true, force: true });
	} else {
		console.error(`Kept external consumer proof workspace: ${tempRoot}`);
	}
}
