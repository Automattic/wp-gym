import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WPGym } from '../src/index.js';

const root = process.cwd();
const scenarioId = process.argv[2] || 'block-markup-no-fallback-pricing-section';

const scenarioConfigs = {
	'block-markup-no-fallback-pricing-section': {
		taskSetId: 'benchmark-readiness-pilot',
		postTitle: 'Simple Pricing Page',
		scriptedContentFile: 'fixtures/reward-hacking/block-markup/no-fallback-pricing-meaningful-content.wp.html',
		resultSetId: 'block-markup-no-fallback-pricing-section-local-episode-baseline',
	},
};

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function roundRate(value) {
	return Number(value.toFixed(6));
}

function summarizeGrade(episode, grade, trace) {
	return {
		episode,
		success: Boolean(grade.success),
		reward: grade.reward,
		failure_reasons: grade.failure_reasons || [],
		checks: (grade.grade?.checks || []).map((check) => ({
			id: check.id,
			passed: Boolean(check.passed),
			score: check.score,
			max_score: check.max_score,
			message: check.message,
		})),
		trace: {
			episode_id: trace.episode_id,
			scenario_id: trace.scenario_id,
			step_count: trace.steps.length,
			allowed_action_types: trace.metadata?.allowed_action_types || [],
			reset_seed: trace.metadata?.reset_seed || null,
		},
	};
}

async function runNoOp(config) {
	const env = await WPGym.make(scenarioId, { root });
	try {
		await env.reset({ seed: 'local-calibration-no-op' });
		const grade = await env.grade();
		const trace = await env.trace();
		return summarizeGrade('no_op', grade, trace);
	} finally {
		await env.close();
	}
}

async function runScripted(config) {
	const content = await readFile(path.join(root, config.scriptedContentFile), 'utf8');
	const env = await WPGym.make(scenarioId, { root });
	try {
		await env.reset({ seed: 'local-calibration-scripted' });
		await env.step({
			type: 'wp_cli',
			command: [
				'post create',
				'--post_type=page',
				'--post_status=publish',
				`--post_title=${WPGym.quoteCliValue(config.postTitle)}`,
				`--post_content=${WPGym.quoteCliValue(content)}`,
			].join(' '),
		});
		const grade = await env.grade();
		const trace = await env.trace();
		return summarizeGrade('heuristic_scripted', grade, trace);
	} finally {
		await env.close();
	}
}

const config = scenarioConfigs[scenarioId];
assert(config, `Unsupported local calibration scenario: ${scenarioId}`);

const noOp = await runNoOp(config);
const scripted = await runScripted(config);
const evidencePath = `fixtures/calibration-evidence/${config.resultSetId}.evidence.json`;
const resultPath = `fixtures/calibration/${config.resultSetId}.json`;
const createdAt = new Date().toISOString();

const resultSet = {
	schema_version: 1,
	id: config.resultSetId,
	scenario_id: scenarioId,
	task_set_id: config.taskSetId,
	created_at: createdAt,
	source: {
		issue: 'https://github.com/Automattic/wp-gym/issues/127',
		evidence_kind: 'local_wp_gym_episode',
		validation_command: `node scripts/run-local-calibration-baseline.mjs ${scenarioId}`,
		evidence_files: [evidencePath],
	},
	rows: [
		{
			row_type: 'no_op',
			label: 'Local WPGym no-op episode',
			attempts: 1,
			passes: noOp.success ? 1 : 0,
			pass_rate: noOp.success ? 1 : 0,
			mean_reward: noOp.reward,
			notes: 'A real local runtime episode reset the scenario and ran the terminal grader without taking any task action. This is runtime evidence, not a model attempt.',
		},
		{
			row_type: 'heuristic_scripted',
			label: 'Local WPGym scripted WP-CLI episode',
			attempts: 1,
			passes: scripted.success ? 1 : 0,
			pass_rate: scripted.success ? 1 : 0,
			mean_reward: scripted.reward,
			notes: 'A real local runtime episode inserted the curated Gutenberg reference content through the public wp_cli action path, then ran the terminal grader. This is not a model attempt.',
		},
	],
	summary: {
		pass_rate_band: 'uncalibrated',
		confidence_interval_95: [0, 1],
		held_out_private_variants_ready: false,
		promotion_recommendation: 'calibrating',
		blockers: ['missing_model_baselines', 'missing_repeated_attempts', 'held_out_private_variants_not_ready', 'diagnostic_contract_only', 'known_reward_shortcut'],
	},
};

const evidence = {
	schema_version: 1,
	created_at: createdAt,
	scenario_id: scenarioId,
	result_set_id: config.resultSetId,
	command: `node scripts/run-local-calibration-baseline.mjs ${scenarioId}`,
	runtime: 'wp-codebox local WPGym episode API',
	episodes: [noOp, scripted],
	limitations: [
		'No cheap-model or frontier-model row was executed.',
		'No repeated-attempt variance was measured.',
		'No held-out private variant was used.',
		'This evidence is suitable only for calibration scaffolding, not headline benchmark claims.',
	],
};

await mkdir(path.join(root, path.dirname(evidencePath)), { recursive: true });
await writeFile(path.join(root, evidencePath), `${JSON.stringify(evidence, null, 2)}\n`);
await writeFile(path.join(root, resultPath), `${JSON.stringify(resultSet, null, 2)}\n`);

console.log(JSON.stringify({ result_file: resultPath, evidence_file: evidencePath, rows: resultSet.rows }, null, 2));
