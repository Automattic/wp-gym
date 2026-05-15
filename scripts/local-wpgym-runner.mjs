import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const root = process.cwd();
const localRoot = path.join(root, '.wp-gym-local');

function parseArgs(argv) {
	const args = {};

	for (let index = 0; index < argv.length; index++) {
		const entry = argv[index];

		if (!entry.startsWith('--')) {
			throw new Error(`Unexpected positional argument: ${entry}`);
		}

		const [rawKey, inlineValue] = entry.slice(2).split(/=(.*)/s, 2);
		const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

		if (inlineValue !== undefined) {
			args[key] = inlineValue;
			continue;
		}

		if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
			args[key] = argv[++index];
		} else {
			args[key] = true;
		}
	}

	return args;
}

async function readJson(file) {
	return JSON.parse(await readFile(file, 'utf8'));
}

async function listScenarioFiles(dir, relativeDir = 'scenarios') {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		const relativePath = path.join(relativeDir, entry.name);

		if (entry.isDirectory()) {
			files.push(...await listScenarioFiles(fullPath, relativePath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(relativePath);
		}
	}

	return files.sort();
}

async function loadScenario(scenarioId) {
	const files = await listScenarioFiles(path.join(root, 'scenarios'));

	for (const file of files) {
		const manifest = await readJson(path.join(root, file));

		if (manifest.id === scenarioId) {
			return { file, manifest };
		}
	}

	throw new Error(`Unknown scenario id: ${scenarioId}`);
}

async function loadEpisodeValidators() {
	const ajv = new Ajv2020({ allErrors: true, strict: false });
	const schemaNames = [
		'action.schema.json',
		'observation.schema.json',
		'step-result.schema.json',
		'trace.schema.json',
	];

	for (const schemaName of schemaNames) {
		ajv.addSchema(await readJson(path.join(root, 'schemas', schemaName)), schemaName);
	}

	return {
		action: ajv.getSchema('action.schema.json'),
		stepResult: ajv.getSchema('step-result.schema.json'),
		trace: ajv.getSchema('trace.schema.json'),
		errorsText: (errors) => ajv.errorsText(errors),
	};
}

function splitCommand(command) {
	const parts = [];
	let current = '';
	let quote = null;

	for (let index = 0; index < command.length; index++) {
		const char = command[index];

		if (quote) {
			if (char === quote) {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}

		if (/\s/.test(char)) {
			if (current.length > 0) {
				parts.push(current);
				current = '';
			}
			continue;
		}

		current += char;
	}

	if (quote) {
		throw new Error(`Unclosed quote in command: ${command}`);
	}

	if (current.length > 0) {
		parts.push(current);
	}

	return parts;
}

function parseOptions(tokens) {
	const options = {};
	const positional = [];

	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];

		if (!token.startsWith('--')) {
			positional.push(token);
			continue;
		}

		const option = token.slice(2);
		const equalsIndex = option.indexOf('=');
		if (equalsIndex !== -1) {
			options[option.slice(0, equalsIndex).replace(/-/g, '_')] = option.slice(equalsIndex + 1);
			continue;
		}

		const key = option.replace(/-/g, '_');
		if (tokens[index + 1] && !tokens[index + 1].startsWith('--')) {
			options[key] = tokens[++index];
		} else {
			options[key] = true;
		}
	}

	return { options, positional };
}

function normalizeRepoPath(candidate, label) {
	if (typeof candidate !== 'string' || candidate.length < 1) {
		throw new Error(`${label} must be a non-empty path`);
	}

	const resolved = path.resolve(root, candidate);
	const relative = path.relative(root, resolved);

	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(`${label} must stay inside the repository: ${candidate}`);
	}

	return { resolved, relative: relative.replace(/\\/g, '/') };
}

function normalizeRunId(runId) {
	if (runId === null) {
		return null;
	}

	if (typeof runId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId)) {
		throw new Error(`runId must be a safe filename slug: ${runId}`);
	}

	return runId;
}

async function readState(stateDir) {
	const file = path.join(stateDir, 'state.json');
	if (!existsSync(file)) {
		return { posts: [] };
	}

	return readJson(file);
}

async function writeState(stateDir, state) {
	await mkdir(stateDir, { recursive: true });
	await writeFile(path.join(stateDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
}

async function runWpCliAction({ action, stateDir }) {
	const tokens = splitCommand(action.command);
	const [resource, verb, ...rest] = tokens;
	const { options } = parseOptions(rest);
	const state = await readState(stateDir);

	if (resource === 'post' && verb === 'create') {
		if (options.post_content_file) {
			const { resolved, relative } = normalizeRepoPath(options.post_content_file, 'post_content_file');
			options.post_content = await readFile(resolved, 'utf8');
			options.post_content_file = relative;
		}

		if (typeof options.post_content !== 'string') {
			return commandResult(action, 1, '', 'post create requires --post_content or --post_content_file', state);
		}

		const post = {
			ID: state.posts.length + 1,
			post_type: options.post_type || 'post',
			post_title: options.post_title || 'Untitled',
			post_content: options.post_content,
		};
		state.posts.push(post);
		await writeState(stateDir, state);

		return commandResult(action, 0, `${post.ID}\n`, '', state);
	}

	if (resource === 'post' && verb === 'list') {
		const filtered = options.post_type
			? state.posts.filter((post) => post.post_type === options.post_type)
			: state.posts;
		const rows = filtered.map(({ ID, post_type, post_title }) => ({ ID, post_type, post_title }));

		return commandResult(action, 0, `${JSON.stringify(rows)}\n`, '', state);
	}

	return commandResult(action, 1, '', `Unsupported local wp_cli command: ${resource || ''} ${verb || ''}`.trim(), state);
}

function commandResult(action, status, stdout, stderr, state) {
	return {
		type: 'command_result',
		command: action.command,
		status,
		stdout,
		stderr,
		error: status === 0 ? null : stderr,
		wp_state: {
			posts: state.posts.map(({ ID, post_type, post_title }) => ({ ID, post_type, post_title })),
		},
	};
}

async function gradeEpisode({ scenario, stateDir }) {
	const state = await readState(stateDir);
	const postTitle = scenario.manifest.expected?.post_title;
	const post = state.posts.find((entry) => !postTitle || entry.post_title === postTitle);

	if (!post) {
		return { reward: 0, result: { passed: false, score: 0, message: 'No matching post found.' } };
	}

	const contentRelative = path.relative(root, path.join(stateDir, 'current-post.wp.html')).replace(/\\/g, '/');
	const fixtureRelative = path.relative(root, path.join(stateDir, 'current-fixture.json')).replace(/\\/g, '/');
	const graderFile = path.relative(root, path.resolve(root, path.dirname(scenario.file), scenario.manifest.grader_file)).replace(/\\/g, '/');
	const fixture = {
		id: `${scenario.manifest.id}-local-runner`,
		scenario_id: scenario.manifest.id,
		grader_file: graderFile,
		type: 'local_runner_state',
		content_file: contentRelative,
		post_title: post.post_title,
	};

	await writeFile(path.join(stateDir, 'current-post.wp.html'), post.post_content);
	await writeFile(path.join(stateDir, 'current-fixture.json'), `${JSON.stringify(fixture, null, 2)}\n`);

	const result = spawnSync('php', ['scripts/run-block-markup-fixture.php', fixtureRelative, root], {
		cwd: root,
		encoding: 'utf8',
	});

	if (result.status !== 0) {
		throw new Error(`Grader failed:\n${result.stdout}${result.stderr}`);
	}

	const grade = JSON.parse(result.stdout);
	return { reward: grade.reward ?? null, result: grade };
}

async function makeEnvironment({ scenarioId, runId = null, reset = false } = {}) {
	if (!scenarioId) {
		throw new Error('scenarioId is required');
	}

	const scenario = await loadScenario(scenarioId);
	const validators = await loadEpisodeValidators();
	const stateDir = path.join(localRoot, normalizeRunId(runId) || scenarioId);
	let trace = [];

	async function resetEnvironment() {
		if (reset) {
			await rm(stateDir, { recursive: true, force: true });
		}

		await mkdir(stateDir, { recursive: true });
		await writeState(stateDir, { posts: [] });
		trace = [];

		return {
			type: 'command_result',
			command: 'reset',
			status: 0,
			stdout: JSON.stringify({ reset_fixture: scenario.manifest.environment.reset_fixture }),
			stderr: '',
			error: null,
			wp_state: { posts: [] },
		};
	}

	async function step(action) {
		if (!validators.action(action)) {
			throw new Error(`Invalid action: ${validators.errorsText(validators.action.errors)}`);
		}

		const observation = await runWpCliAction({ action, stateDir });
		const stepResult = {
			action,
			observation,
			reward: null,
			done: false,
			info: { scenario_id: scenario.manifest.id },
		};

		if (!validators.stepResult(stepResult)) {
			throw new Error(`Invalid step result: ${validators.errorsText(validators.stepResult.errors)}`);
		}

		trace.push({ timestamp: new Date().toISOString(), ...stepResult });
		await writeFile(path.join(stateDir, 'trace.json'), `${JSON.stringify(trace, null, 2)}\n`);

		return stepResult;
	}

	async function grade() {
		const gradeResult = await gradeEpisode({ scenario, stateDir });
		const last = trace.at(-1);

		if (last) {
			last.reward = gradeResult.reward;
			last.done = gradeResult.reward >= scenario.manifest.reward_spec.success_threshold;
			last.info.grade = gradeResult.result;
		}

		if (!validators.trace(trace)) {
			throw new Error(`Invalid trace: ${validators.errorsText(validators.trace.errors)}`);
		}

		await writeFile(path.join(stateDir, 'trace.json'), `${JSON.stringify(trace, null, 2)}\n`);
		await writeFile(path.join(stateDir, 'grade.json'), `${JSON.stringify(gradeResult.result, null, 2)}\n`);

		return gradeResult.result;
	}

	return {
		scenario,
		stateDir,
		reset: resetEnvironment,
		step,
		grade,
		trace: () => trace,
	};
}

async function runSelfTest() {
	const env = await makeEnvironment({
		scenarioId: 'block-markup-no-fallback-pricing-section',
		runId: 'self-test',
		reset: true,
	});

	await env.reset();
	await env.step({
		type: 'wp_cli',
		command: 'post create --post_type=page --post_title="Simple Pricing Page" --post_content_file=fixtures/reward-hacking/block-markup/no-fallback-pricing-meaningful-content.wp.html',
		timeout_ms: 30000,
	});
	const grade = await env.grade();

	if (grade.success !== true || (grade.reward ?? 0) < 1) {
		throw new Error(`Expected self-test grade to pass; got ${JSON.stringify(grade)}`);
	}

	console.log(`Local WPGym self-test passed with reward ${grade.reward}.`);
}

async function runCli() {
	const args = parseArgs(process.argv.slice(2));

	if (args.selfTest) {
		await runSelfTest();
		return;
	}

	const env = await makeEnvironment({
		scenarioId: args.scenario,
		runId: args.runId,
		reset: args.reset !== false,
	});

	await env.reset();
	const action = args.action ? JSON.parse(args.action) : null;
	if (action) {
		await env.step(action);
	}

	const grade = await env.grade();
	console.log(JSON.stringify({ scenario_id: env.scenario.manifest.id, grade, trace: env.trace() }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runCli().catch((error) => {
		console.error(error.message);
		process.exit(1);
	});
}

export { makeEnvironment };
