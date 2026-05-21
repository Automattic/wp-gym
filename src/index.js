import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile, stat, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const moduleRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const actionSchemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/action.v1.schema.json';
const observationSchemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/observation.v1.schema.json';
const stepResultSchemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/step-result.v1.schema.json';
const traceSchemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/trace.v1.schema.json';

async function readJson(file) {
	return JSON.parse(await readFile(file, 'utf8'));
}

async function listJsonFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...await listJsonFiles(fullPath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(fullPath);
		}
	}

	return files.sort();
}

function resolveFrom(file, candidate) {
	return path.resolve(path.dirname(file), candidate);
}

function repoRelative(root, file) {
	return path.relative(root, file).replace(/\\/g, '/');
}

function createEpisodeId(scenarioId) {
	const suffix = createHash('sha256')
		.update(`${scenarioId}:${Date.now()}:${Math.random()}`)
		.digest('hex')
		.slice(0, 12);

	return `${scenarioId}-${suffix}`;
}

function shellSplit(command) {
	const args = [];
	let current = '';
	let quote = null;
	let escaped = false;

	for (const char of command) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}

		if (char === '\\') {
			escaped = true;
			continue;
		}

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
			if (current !== '') {
				args.push(current);
				current = '';
			}
			continue;
		}

		current += char;
	}

	if (escaped) {
		current += '\\';
	}
	if (quote) {
		throw new Error(`Unclosed quote in command: ${command}`);
	}
	if (current !== '') {
		args.push(current);
	}

	return args;
}

function parseWpCliOptions(args) {
	const positional = [];
	const options = {};

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (!arg.startsWith('--')) {
			positional.push(arg);
			continue;
		}

		const withoutPrefix = arg.slice(2);
		const equalsIndex = withoutPrefix.indexOf('=');
		if (equalsIndex !== -1) {
			options[withoutPrefix.slice(0, equalsIndex)] = withoutPrefix.slice(equalsIndex + 1);
			continue;
		}

		const next = args[index + 1];
		if (next && !next.startsWith('--')) {
			options[withoutPrefix] = next;
			index++;
		} else {
			options[withoutPrefix] = true;
		}
	}

	return { positional, options };
}

function quoteCliValue(value) {
	return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function loadSchemas(root) {
	const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
	for (const file of [
		'schemas/action.v1.schema.json',
		'schemas/observation.v1.schema.json',
		'schemas/step-result.v1.schema.json',
		'schemas/trace.v1.schema.json',
	]) {
		ajv.addSchema(await readJson(path.join(root, file)));
	}

	return ajv;
}

function assertValid(ajv, schemaId, value, label) {
	const validate = ajv.getSchema(schemaId);
	if (!validate) {
		throw new Error(`Missing compiled schema: ${schemaId}`);
	}

	if (!validate(value)) {
		const errors = validate.errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
		throw new Error(`${label} violates schema: ${errors}`);
	}
}

function normalizeGradeReward(grade) {
	return {
		value: Number(grade?.reward || 0),
		success: Boolean(grade?.success),
		failure_reasons: Array.isArray(grade?.failure_reasons) ? grade.failure_reasons : [],
		checks: Array.isArray(grade?.grade?.checks)
			? grade.grade.checks.map((check) => ({
				id: check.id,
				success: Boolean(check.passed),
				score: Number(check.score || 0),
				max_score: Number(check.max_score || 0),
				...(check.failure_reason ? { failure_reason: check.failure_reason } : {}),
				...(check.message ? { message: check.message } : {}),
			}))
			: [],
	};
}

async function runCommand(command, args, options = {}) {
	const started = Date.now();

	return await new Promise((resolve) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: { ...process.env, ...(options.env || {}) },
		});
		let stdout = '';
		let stderr = '';
		let timedOut = false;
		const timeout = options.timeoutMs
			? setTimeout(() => {
				timedOut = true;
				child.kill('SIGTERM');
			}, options.timeoutMs)
			: null;

		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('close', (status) => {
			if (timeout) {
				clearTimeout(timeout);
			}
			resolve({
				status,
				stdout,
				stderr,
				timedOut,
				durationMs: Date.now() - started,
			});
		});
		child.on('error', (error) => {
			if (timeout) {
				clearTimeout(timeout);
			}
			resolve({
				status: null,
				stdout,
				stderr,
				timedOut,
				durationMs: Date.now() - started,
				error,
			});
		});
	});
}

export class WPGym {
	static async make(scenarioId, options = {}) {
		const root = path.resolve(options.root || moduleRoot);
		const scenario = await WPGym.findScenario(root, scenarioId);
		return new WPGymEnvironment({ root, scenario, options });
	}

	static async findScenario(root, scenarioId) {
		for (const file of await listJsonFiles(path.join(root, 'scenarios'))) {
			const manifest = await readJson(file);
			if (manifest.id === scenarioId) {
				return { file, manifest };
			}
		}

		throw new Error(`Unknown wp-gym scenario: ${scenarioId}`);
	}

	static quoteCliValue(value) {
		return quoteCliValue(value);
	}
}

export class WPGymEnvironment {
	constructor({ root, scenario, options }) {
		this.root = root;
		this.scenarioFile = scenario.file;
		this.scenario = scenario.manifest;
		this.options = options;
		this.posts = [];
		this.nextPostId = 1;
		this.steps = [];
		this.lastGrade = null;
		this.closed = false;
	}

	async reset() {
		await this.close();
		this.closed = false;
		this.episodeId = createEpisodeId(this.scenario.id);
		this.episodeRoot = await mkdtemp(path.join(os.tmpdir(), 'wp-gym-'));
		this.workspaceRoot = path.join(this.episodeRoot, 'workspace');
		this.posts = [];
		this.nextPostId = 1;
		this.steps = [];
		this.lastGrade = null;

		await mkdir(this.workspaceRoot, { recursive: true });
		const workspaceTemplate = this.scenario.environment?.workspace_template;
		if (workspaceTemplate) {
			await cp(path.join(this.root, workspaceTemplate), this.workspaceRoot, { recursive: true });
		}

		const observation = {
			schema_version: 1,
			type: 'wp_state',
			state: {
				scenario_id: this.scenario.id,
				reset_fixture: this.scenario.environment.reset_fixture,
				episode_id: this.episodeId,
				post_count: 0,
				workspace_root: this.workspaceRoot,
			},
		};
		await this.assertObservation(observation, 'reset observation');

		return observation;
	}

	async step(action) {
		this.assertOpen();
		const normalizedAction = { schema_version: 1, ...action };
		await this.assertAction(normalizedAction);
		this.assertAllowedAction(normalizedAction.type);

		const started = Date.now();
		let observation;

		if (normalizedAction.type === 'wp_cli') {
			observation = await this.stepWpCli(normalizedAction);
		} else if (normalizedAction.type === 'filesystem') {
			observation = await this.stepFilesystem(normalizedAction);
		} else {
			throw new Error(`Local WPGym does not implement ${normalizedAction.type} actions yet.`);
		}

		await this.assertObservation(observation, `${normalizedAction.type} observation`);

		const result = {
			schema_version: 1,
			observation,
			reward: this.lastGrade ? normalizeGradeReward(this.lastGrade) : { value: 0, success: false, failure_reasons: [] },
			done: false,
			telemetry: {
				runner: 'local-wpgym',
				duration_ms: Date.now() - started,
				action_type: normalizedAction.type,
			},
		};
		await this.assertStepResult(result);

		this.steps.push({
			step_index: this.steps.length,
			timestamp: new Date().toISOString(),
			action: normalizedAction,
			result,
		});

		return result;
	}

	async grade() {
		this.assertOpen();
		const started = Date.now();
		const grade = await this.runPhpGrader();
		this.lastGrade = grade;

		return {
			...grade,
			telemetry: {
				runner: 'local-wpgym',
				duration_ms: Date.now() - started,
			},
		};
	}

	async trace() {
		this.assertOpen();
		const trace = {
			schema_version: 1,
			episode_id: this.episodeId,
			scenario_id: this.scenario.id,
			metadata: {
				max_steps: this.maxSteps(),
				allowed_action_types: this.allowedActionTypes(),
				setup: [this.scenario.environment.reset_fixture],
				success_checks: this.successChecks(),
			},
			steps: this.steps,
		};
		const ajv = await this.ajv();
		assertValid(ajv, traceSchemaId, trace, 'trace');

		return trace;
	}

	async close() {
		if (this.episodeRoot && existsSync(this.episodeRoot)) {
			await rm(this.episodeRoot, { recursive: true, force: true });
		}
		this.closed = true;
	}

	async stepWpCli(action) {
		const args = shellSplit(action.command);
		const [entity, operation, ...rest] = args;
		const { positional, options } = parseWpCliOptions(rest);
		const started = Date.now();

		try {
			if (entity !== 'post') {
				throw new Error(`Unsupported local WP-CLI entity: ${entity}`);
			}

			let stdout = '';
			if (operation === 'create') {
				const post = {
					ID: this.nextPostId++,
					post_type: String(options.post_type || 'post'),
					post_status: String(options.post_status || 'publish'),
					post_title: String(options.post_title || ''),
					post_content: String(options.post_content || ''),
				};
				this.posts.push(post);
				stdout = options.porcelain ? `${post.ID}\n` : `Success: Created post ${post.ID}.\n`;
			} else if (operation === 'list') {
				const postType = options.post_type ? String(options.post_type) : null;
				const posts = this.posts.filter((post) => !postType || post.post_type === postType);
				stdout = options.format === 'json' ? `${JSON.stringify(posts)}\n` : posts.map((post) => `${post.ID}\t${post.post_title}`).join('\n');
			} else if (operation === 'get') {
				const post = this.findPost(positional[0]);
				if (!post) {
					throw new Error(`Post not found: ${positional[0]}`);
				}
				stdout = options.field ? `${post[options.field] ?? ''}\n` : `${JSON.stringify(post)}\n`;
			} else if (operation === 'update') {
				const post = this.findPost(positional[0]);
				if (!post) {
					throw new Error(`Post not found: ${positional[0]}`);
				}
				for (const field of ['post_type', 'post_status', 'post_title', 'post_content']) {
					if (options[field] !== undefined) {
						post[field] = String(options[field]);
					}
				}
				stdout = `Success: Updated post ${post.ID}.\n`;
			} else {
				throw new Error(`Unsupported local WP-CLI post operation: ${operation}`);
			}

			return {
				schema_version: 1,
				type: 'command_result',
				action_type: 'wp_cli',
				command: action.command,
				status: 0,
				stdout,
				stderr: '',
				timeout_ms: action.timeout_ms,
				timed_out: false,
				duration_ms: Date.now() - started,
				error: null,
			};
		} catch (error) {
			return {
				schema_version: 1,
				type: 'command_result',
				action_type: 'wp_cli',
				command: action.command,
				status: 1,
				stdout: '',
				stderr: `${error.message}\n`,
				timeout_ms: action.timeout_ms,
				timed_out: false,
				duration_ms: Date.now() - started,
				error: { code: 'local_wp_cli_error', message: error.message },
			};
		}
	}

	async stepFilesystem(action) {
		const target = this.resolveWorkspacePath(action.path);

		if (action.operation === 'list') {
			const entries = existsSync(target) ? await readdir(target, { withFileTypes: true }) : [];
			return {
				schema_version: 1,
				type: 'files',
				files: entries.map((entry) => ({ path: path.posix.join(action.path, entry.name) })),
			};
		}

		if (action.operation === 'read') {
			const content = await readFile(target, 'utf8');
			return {
				schema_version: 1,
				type: 'files',
				files: [{ path: action.path, content, sha256: createHash('sha256').update(content).digest('hex') }],
			};
		}

		if (action.operation === 'write') {
			await mkdir(path.dirname(target), { recursive: true });
			await writeFile(target, String(action.content || ''));
			return {
				schema_version: 1,
				type: 'files',
				files: [{ path: action.path, sha256: createHash('sha256').update(String(action.content || '')).digest('hex') }],
			};
		}

		if (action.operation === 'delete') {
			await rm(target, { recursive: true, force: true });
			return { schema_version: 1, type: 'files', files: [{ path: action.path }] };
		}

		throw new Error(`Local WPGym does not implement filesystem ${action.operation} yet.`);
	}

	runtimePlan() {
		this.assertOpen();

		return {
			schema: 'wp-gym/runtime-plan/v1',
			scenario_id: this.scenario.id,
			runtime: {
				kind: 'wordpress',
				reset_fixture: this.scenario.environment.reset_fixture,
			},
			limits: this.scenario.environment.truncation_policy,
			mounts: [
				{
					source: this.root,
					target: '/inputs/repo',
					mode: 'readonly',
					role: 'scenario_repository',
				},
			],
			actions: this.steps.map((step) => step.action),
			grader: {
				type: 'php',
				source: repoRelative(this.root, resolveFrom(this.scenarioFile, this.scenario.grader_file)),
				bootstrap: 'wordpress',
			},
			expected_artifacts: this.scenario.expected_artifacts || [],
		};
	}

	async runPhpGrader() {
		const graderFile = resolveFrom(this.scenarioFile, this.scenario.grader_file);
		const stateFile = path.join(this.episodeRoot, 'state.json');
		await writeFile(stateFile, JSON.stringify({ posts: this.posts }, null, 2));

		const result = await runCommand('php', [
			'scripts/run-local-wordpress-state-grade.php',
			graderFile,
			stateFile,
		], { cwd: this.root, timeoutMs: this.options.gradeTimeoutMs || 30000 });

		if (result.status !== 0) {
			throw new Error(`Local grader failed: ${result.stderr || result.stdout}`);
		}

		return JSON.parse(result.stdout);
	}

	findPost(identifier) {
		if (!identifier) {
			return null;
		}

		const id = Number(identifier);
		return this.posts.find((post) => post.ID === id || post.post_title === identifier) || null;
	}

	resolveWorkspacePath(candidate) {
		const relative = String(candidate || '').replace(/\\/g, '/').replace(/^\/+/, '');
		const target = path.resolve(this.workspaceRoot, relative);
		if (!target.startsWith(`${this.workspaceRoot}${path.sep}`) && target !== this.workspaceRoot) {
			throw new Error(`Path escapes local workspace: ${candidate}`);
		}

		const writableRoots = this.scenario.environment?.writable_roots || [];
		if (writableRoots.length > 0) {
			const allowed = writableRoots.some((root) => {
				const normalized = root.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
				return relative === normalized || relative.startsWith(`${normalized}/`);
			});
			if (!allowed) {
				throw new Error(`Path is outside scenario writable roots: ${candidate}`);
			}
		}

		return target;
	}

	allowedActionTypes() {
		if (this.scenario.episode_contract?.allowed_action_types?.length) {
			return this.scenario.episode_contract.allowed_action_types;
		}

		if (this.scenario.environment.action_mode === 'workspace') {
			return this.scenario.environment.allowed_tools?.includes('run_wp_cli')
				? ['filesystem', 'wp_cli']
				: ['filesystem'];
		}

		return ['wp_cli'];
	}

	maxSteps() {
		return this.scenario.episode_contract?.max_steps || this.scenario.environment.truncation_policy.step_budget;
	}

	successChecks() {
		if (this.scenario.episode_contract?.success_checks?.length) {
			return this.scenario.episode_contract.success_checks;
		}

		return [
			...(this.scenario.rules?.general || []),
			...(this.scenario.rules?.task_specific || []),
		];
	}

	assertAllowedAction(type) {
		if (!this.allowedActionTypes().includes(type)) {
			throw new Error(`Action type ${type} is not allowed for scenario ${this.scenario.id}`);
		}
	}

	assertOpen() {
		if (this.closed || !this.episodeRoot) {
			throw new Error('Call reset() before using this WPGym environment.');
		}
	}

	async assertAction(action) {
		const ajv = await this.ajv();
		assertValid(ajv, actionSchemaId, action, 'action');
	}

	async assertObservation(observation, label) {
		const ajv = await this.ajv();
		assertValid(ajv, observationSchemaId, observation, label);
	}

	async assertStepResult(result) {
		const ajv = await this.ajv();
		assertValid(ajv, stepResultSchemaId, result, 'step result');
	}

	async ajv() {
		if (!this.schemaValidator) {
			this.schemaValidator = await loadSchemas(this.root);
		}

		return this.schemaValidator;
	}

	async workspaceFiles() {
		const files = [];
		async function walk(dir) {
			for (const entry of await readdir(dir, { withFileTypes: true })) {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					await walk(fullPath);
				} else if (entry.isFile()) {
					files.push(fullPath);
				}
			}
		}

		if (existsSync(this.workspaceRoot) && (await stat(this.workspaceRoot)).isDirectory()) {
			await walk(this.workspaceRoot);
		}

		return files.map((file) => repoRelative(this.workspaceRoot, file));
	}
}

export { quoteCliValue };
