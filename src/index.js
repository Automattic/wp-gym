import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile, stat, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { createRuntimeEpisode } from 'wp-codebox-workspace/core';
import { createPlaygroundRuntimeBackend } from 'wp-codebox-workspace/playground';

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

function normalizeRoot(options = {}) {
	return path.resolve(options.root || moduleRoot);
}

function schemaReferences() {
	return {
		action: 'schemas/action.v1.schema.json',
		observation: 'schemas/observation.v1.schema.json',
		step_result: 'schemas/step-result.v1.schema.json',
		trace: 'schemas/trace.v1.schema.json',
	};
}

function actionCapabilitiesForScenario(manifest) {
	if (manifest.episode_contract?.allowed_action_types?.length) {
		return manifest.episode_contract.allowed_action_types;
	}

	if (manifest.environment?.action_mode === 'workspace') {
		return manifest.environment.allowed_tools?.includes('run_wp_cli')
			? ['filesystem', 'wp_cli']
			: ['filesystem'];
	}

	return ['wp_cli'];
}

function scenarioSummary(root, scenario) {
	const { manifest, file } = scenario;
	const allowedActionTypes = actionCapabilitiesForScenario(manifest);

	return {
		id: manifest.id,
		label: manifest.label,
		description: manifest.description || '',
		file: repoRelative(root, file),
		split: manifest.split?.membership || null,
		task_contract_level: manifest.calibration?.task_contract_level || null,
		benchmark_scope: manifest.calibration?.benchmark_scope || null,
		environment: {
			action_mode: manifest.environment?.action_mode || null,
			uses_workspace: Boolean(manifest.environment?.uses_workspace),
			reset_fixture: manifest.environment?.reset_fixture || null,
			observation_channels: manifest.environment?.observation_channels || [],
			allowed_action_types: allowedActionTypes,
		},
		schemas: schemaReferences(),
	};
}

function scenarioCapabilities(manifest) {
	const allowedActionTypes = actionCapabilitiesForScenario(manifest);
	const replayableActionTypes = allowedActionTypes.filter((type) => ['wp_cli', 'filesystem'].includes(type));
	const evidenceOnlyActionTypes = allowedActionTypes.filter((type) => !replayableActionTypes.includes(type));

	return {
		schema_version: 1,
		scenario_id: manifest.id,
		allowed_action_types: allowedActionTypes,
		replayable_action_types: replayableActionTypes,
		evidence_only_action_types: evidenceOnlyActionTypes,
		implemented_local_action_types: ['wp_cli', 'filesystem'],
		observation_types: ['command_result', 'files', 'html', 'logs', 'rest_response', 'screenshot', 'wp_state', 'browser_result'],
		schemas: schemaReferences(),
	};
}

function taskSetSummary(root, taskSet) {
	const { manifest, file } = taskSet;

	return {
		id: manifest.id,
		label: manifest.label,
		description: manifest.description || '',
		file: repoRelative(root, file),
		benchmark_status: manifest.benchmark_status || null,
		task_contract_level: manifest.task_contract_level || null,
		scenario_ids: (manifest.tasks || []).map((task) => task.scenario_id),
	};
}

function createEpisodeId(scenarioId, seed = null) {
	const suffixInput = seed === null
		? `${scenarioId}:${Date.now()}:${Math.random()}`
		: `${scenarioId}:seed:${seed}`;
	const suffix = createHash('sha256')
		.update(suffixInput)
		.digest('hex')
		.slice(0, 12);

	return `${scenarioId}-${suffix}`;
}

function normalizeResetOptions(options = {}) {
	const resetOptions = typeof options === 'object' && options !== null ? options : { seed: options };
	const seed = resetOptions.seed ?? null;

	return {
		...resetOptions,
		seed: seed === null ? null : String(seed),
	};
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

function jsonFromOutput(output) {
	const trimmed = output.trim();
	if (!trimmed) {
		throw new Error('Expected JSON output, got empty output.');
	}

	try {
		return JSON.parse(trimmed);
	} catch {
		const start = trimmed.indexOf('{');
		const end = trimmed.lastIndexOf('}');
		if (start === -1 || end === -1 || end <= start) {
			throw new Error(`Expected JSON output, got: ${trimmed}`);
		}

		return JSON.parse(trimmed.slice(start, end + 1));
	}
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

function uniqueSorted(values) {
	return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function countRegex(value, pattern) {
	return typeof value === 'string' ? (value.match(pattern) || []).length : 0;
}

function normalizeFontFamily(value) {
	return value
		.replace(/\\["']/g, '')
		.replace(/["']/g, '')
		.trim()
		.replace(/\s+/g, ' ');
}

function extractFontFamilies(text) {
	const families = [];
	for (const match of text.matchAll(/fonts\.googleapis\.com\/css2?[^"')\s]+/gi)) {
		try {
			const url = new URL(match[0].startsWith('http') ? match[0] : `https://${match[0]}`);
			for (const family of url.searchParams.getAll('family')) {
				families.push(normalizeFontFamily(family.split(':')[0].replaceAll('+', ' ')));
			}
		} catch {
			// Keep parsing local declarations if an import URL is malformed.
		}
	}

	for (const match of text.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
		for (const family of (match[1] || '').split(',')) {
			const normalized = normalizeFontFamily(family);
			if (!/^(sans-serif|serif|monospace|system-ui|inherit|initial|unset)$/i.test(normalized)) {
				families.push(normalized);
			}
		}
	}

	return uniqueSorted(families);
}

function extractColors(text) {
	const hexColors = [...text.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((match) => match[0].toLowerCase());
	const functionalColors = [...text.matchAll(/\b(?:rgb|rgba|hsl|hsla)\([^)]*\)/gi)].map((match) =>
		match[0].toLowerCase().replace(/\s+/g, '')
	);
	return uniqueSorted([...hexColors, ...functionalColors]);
}

function includesAny(text, patterns) {
	return patterns.some((pattern) => pattern.test(text));
}

function extractMotifs(text) {
	const motifs = [];
	const checks = {
		bento_grid: [/\bbento\b/i],
		cards_grid: [/\bcard(s)?\b/i, /grid-template-columns/i],
		code_preview: [/code-window/i, /code-preview/i, /<pre\b/i, /<code\b/i],
		dashboard_mockup: [/dashboard/i, /metric-card/i, /analytics/i],
		glow_overlay: [/\bglow\b/i, /blur\(/i, /radial-gradient\(/i],
		marquee: [/\bmarquee\b/i, /ticker/i],
		pricing: [/\bpricing\b/i, /\bplans?\b/i],
		social_proof: [/testimonial/i, /customer/i, /trusted by/i],
		split_hero: [/split-hero/i, /hero-grid/i],
		terminal_window: [/terminal/i, /traffic-light/i, /window-chrome/i, /code-window/i],
	};

	for (const [motif, patterns] of Object.entries(checks)) {
		if (includesAny(text, patterns)) {
			motifs.push(motif);
		}
	}

	return motifs.sort();
}

function extractPaletteLabels(text, colors) {
	const labels = [];
	const colorText = `${text.toLowerCase()} ${colors.join(' ')}`;
	if (/purple|violet|indigo|#6|#7|#8|#9|#a/i.test(colorText) && /lime|chartreuse|#bef|#a3e|#ccff|#d9f99d/i.test(colorText)) {
		labels.push('purple_lime');
	}
	if (/orange|amber|coral|#f59|#fb7|#ff8/i.test(colorText)) {
		labels.push('warm_orange');
	}
	if (/cyan|teal|aqua|#06b6|#14b8|#22d3/i.test(colorText)) {
		labels.push('cyan_teal');
	}
	if (/black|charcoal|slate|#0[0-9a-f]{2,6}|#111|#18181b/i.test(colorText)) {
		labels.push('dark_base');
	}
	return labels.sort();
}

function extractLayoutPatterns(text) {
	const patterns = [];
	if (/\bgrid-template-columns\b|\bwp-block-columns\b|\bis-layout-grid\b/i.test(text)) {
		patterns.push('grid');
	}
	if (/\bflex\b|\bis-layout-flex\b/i.test(text)) {
		patterns.push('flex');
	}
	if (/\bhero\b/i.test(text)) {
		patterns.push('hero');
	}
	if (/\bcard(s)?\b/i.test(text)) {
		patterns.push('cards');
	}
	if (/\balignfull\b|\bfull-bleed\b|\bfull-width\b/i.test(text)) {
		patterns.push('full_width');
	}
	return patterns.sort();
}

function designFingerprintFromDocuments(documents) {
	const text = documents.map((document) => document.content || '').join('\n');
	const colors = extractColors(text);
	const fontFamilies = extractFontFamilies(text);

	return {
		document_count: documents.length,
		font_families: fontFamilies,
		dominant_font_family: fontFamilies[0] || '',
		color_palette: colors,
		css_variables: uniqueSorted([...text.matchAll(/--([a-z0-9-]+)\s*:/gi)].map((match) => match[1].toLowerCase())),
		layout_patterns: extractLayoutPatterns(text),
		visual_motifs: extractMotifs(text),
		palette_labels: extractPaletteLabels(text, colors),
		gradient_count: countRegex(text, /(?:linear|radial|conic)-gradient\(/gi),
		animation_count: countRegex(text, /@keyframes\b|\banimation(?:-[a-z]+)?\s*:/gi),
		transition_count: countRegex(text, /\btransition(?:-[a-z]+)?\s*:/gi),
		dark_theme: /#0[0-9a-f]{2,6}|#111|#18181b|#020617|background(?:-color)?\s*:\s*(?:black|rgb\(0[,\s]+0[,\s]+0\))/i.test(text),
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
		const root = normalizeRoot(options);
		const scenario = await WPGym.findScenario(root, scenarioId);
		return new WPGymEnvironment({ root, scenario, options });
	}

	static async listScenarios(options = {}) {
		const root = normalizeRoot(options);
		const scenarios = [];
		for (const file of await listJsonFiles(path.join(root, 'scenarios'))) {
			scenarios.push({ file, manifest: await readJson(file) });
		}

		return scenarios.map((scenario) => scenarioSummary(root, scenario));
	}

	static async listTaskSets(options = {}) {
		const root = normalizeRoot(options);
		const taskSets = [];
		for (const file of await listJsonFiles(path.join(root, 'task-sets'))) {
			taskSets.push({ file, manifest: await readJson(file) });
		}

		return taskSets.map((taskSet) => taskSetSummary(root, taskSet));
	}

	static async describeScenario(scenarioId, options = {}) {
		const root = normalizeRoot(options);
		const scenario = await WPGym.findScenario(root, scenarioId);

		return {
			...scenarioSummary(root, scenario),
			prompt_file: repoRelative(root, resolveFrom(scenario.file, scenario.manifest.prompt_file)),
			grader_file: repoRelative(root, resolveFrom(scenario.file, scenario.manifest.grader_file)),
			rules: scenario.manifest.rules || {},
			expected_artifacts: scenario.manifest.expected_artifacts || [],
			capabilities: scenarioCapabilities(scenario.manifest),
		};
	}

	static async describeTaskSet(taskSetId, options = {}) {
		const root = normalizeRoot(options);
		for (const file of await listJsonFiles(path.join(root, 'task-sets'))) {
			const manifest = await readJson(file);
			if (manifest.id === taskSetId) {
				return {
					...taskSetSummary(root, { file, manifest }),
					tasks: manifest.tasks || [],
					scenario_manifests: manifest.scenario_manifests || [],
				};
			}
		}

		throw new Error(`Unknown wp-gym task set: ${taskSetId}`);
	}

	static async capabilities(scenarioId, options = {}) {
		const root = normalizeRoot(options);
		const scenario = await WPGym.findScenario(root, scenarioId);
		return scenarioCapabilities(scenario.manifest);
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

	async reset(options = {}) {
		const resetOptions = normalizeResetOptions(options);
		await this.close();
		this.closed = false;
		this.resetSeed = resetOptions.seed;
		this.episodeId = createEpisodeId(this.scenario.id, this.resetSeed);
		this.episodeRoot = await mkdtemp(path.join(os.tmpdir(), 'wp-gym-'));
		this.workspaceRoot = path.join(this.episodeRoot, 'workspace');
		this.posts = [];
		this.nextPostId = 1;
		this.steps = [];
		this.lastGrade = null;
		this.runtimeEpisode = null;

		await mkdir(this.workspaceRoot, { recursive: true });
		const workspaceTemplate = this.scenario.environment?.workspace_template;
		if (workspaceTemplate) {
			await cp(path.join(this.root, workspaceTemplate), this.workspaceRoot, { recursive: true });
		}
		if (this.scenario.environment.action_mode === 'wordpress') {
			this.runtimeEpisode = await this.createWpCodeboxEpisode();
		}

		const observation = {
			schema_version: 1,
			type: 'wp_state',
			state: {
				scenario_id: this.scenario.id,
				reset_fixture: this.scenario.environment.reset_fixture,
				episode_id: this.episodeId,
				reset_seed: this.resetSeed,
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
				runner: this.scenario.environment.action_mode === 'wordpress' ? 'wp-codebox' : 'local-wpgym',
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
		const behavioralFingerprints = await this.collectBehavioralFingerprints();

		return {
			...grade,
			telemetry: {
				runner: this.scenario.environment.action_mode === 'wordpress' ? 'wp-codebox' : 'local-wpgym',
				duration_ms: Date.now() - started,
				...(behavioralFingerprints.length > 0 ? { behavioral_fingerprints: behavioralFingerprints } : {}),
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
				reset_seed: this.resetSeed,
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
		await this.runtimeEpisode?.close();
		this.runtimeEpisode = null;
		if (this.episodeRoot && existsSync(this.episodeRoot)) {
			await rm(this.episodeRoot, { recursive: true, force: true });
		}
		this.closed = true;
	}

	async stepWpCli(action) {
		if (this.scenario.environment.action_mode === 'wordpress') {
			return await this.stepWpCliWithCodebox(action);
		}

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

	async stepWpCliWithCodebox(action) {
		const started = Date.now();
		const episode = await this.wpCodeboxEpisode();
		let execution;
		try {
			({ execution } = await episode.step({
				command: 'wordpress.wp-cli',
				args: [`command=${action.command}`],
			}));
		} catch (error) {
			return {
				schema_version: 1,
				type: 'command_result',
				action_type: 'wp_cli',
				command: action.command,
				status: 1,
				stdout: '',
				stderr: `${error instanceof Error ? error.message : String(error)}\n`,
				timeout_ms: action.timeout_ms,
				timed_out: false,
				duration_ms: Date.now() - started,
				error: { code: 'wp_codebox_wp_cli_error', message: error instanceof Error ? error.message : String(error) },
			};
		}

		return {
			schema_version: 1,
			type: 'command_result',
			action_type: 'wp_cli',
			command: action.command,
			status: execution.exitCode,
			stdout: execution.stdout,
			stderr: execution.stderr,
			timeout_ms: action.timeout_ms,
			timed_out: false,
			duration_ms: Date.parse(execution.finishedAt) - Date.parse(execution.startedAt) || Date.now() - started,
			error: execution.exitCode === 0 ? null : { code: 'wp_codebox_wp_cli_error', message: execution.stderr || recipeRun.error?.message || 'WP-CLI action failed.' },
		};
	}

	async stepFilesystem(action) {
		const target = this.resolveWorkspacePath(action.path);

		if (action.operation === 'list') {
			const entries = existsSync(target) ? await readdir(target, { withFileTypes: true }) : [];
			return {
				schema_version: 1,
				type: 'files',
				action_type: 'filesystem',
				operation: 'list',
				files: entries.map((entry) => ({
					path: path.posix.join(action.path, entry.name),
					kind: entry.isDirectory() ? 'directory' : 'file',
				})),
			};
		}

		if (action.operation === 'read') {
			const content = await readFile(target, 'utf8');
			return {
				schema_version: 1,
				type: 'files',
				action_type: 'filesystem',
				operation: 'read',
				files: [{ path: action.path, kind: 'file', content, sha256: createHash('sha256').update(content).digest('hex') }],
			};
		}

		if (action.operation === 'write') {
			await mkdir(path.dirname(target), { recursive: true });
			await writeFile(target, String(action.content || ''));
			return {
				schema_version: 1,
				type: 'files',
				action_type: 'filesystem',
				operation: 'write',
				files: [{ path: action.path, kind: 'file', sha256: createHash('sha256').update(String(action.content || '')).digest('hex') }],
			};
		}

		if (action.operation === 'delete') {
			await rm(target, { recursive: true, force: true });
			return { schema_version: 1, type: 'files', action_type: 'filesystem', operation: 'delete', files: [{ path: action.path, kind: 'unknown' }] };
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
		if (this.scenario.environment.action_mode === 'wordpress') {
			return await this.runPhpGraderWithCodebox();
		}

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

	async runPhpGraderWithCodebox() {
		const graderPath = `/inputs/repo/${repoRelative(this.root, resolveFrom(this.scenarioFile, this.scenario.grader_file))}`;
		const wrapperFile = path.join(this.episodeRoot, 'grader-wrapper.php');
		await writeFile(wrapperFile, `<?php
$grader = require ${JSON.stringify(graderPath)};
$result = is_callable($grader) ? $grader() : $grader;
echo json_encode($result, JSON_PRETTY_PRINT);
`);

		const { execution } = await (await this.wpCodeboxEpisode()).step({
			command: 'wordpress.run-php',
			args: [`code-file=${wrapperFile}`],
		});

		return jsonFromOutput(execution.stdout);
	}

	async collectBehavioralFingerprints() {
		const probes = this.scenario.probes?.behavioral_fingerprints;
		if (!Array.isArray(probes) || probes.length === 0) {
			return [];
		}

		const fingerprints = [];
		for (const probe of probes) {
			if (probe?.type !== 'rendered_site_design') {
				continue;
			}

			const documents = this.scenario.environment.action_mode === 'wordpress'
				? await this.collectWordPressDesignDocuments()
				: this.collectLocalDesignDocuments();
			fingerprints.push({
				id: probe.id,
				type: probe.type,
				reward_weight: Number(probe.reward_weight || 0),
				fingerprint: designFingerprintFromDocuments(documents),
			});
		}

		return fingerprints;
	}

	collectLocalDesignDocuments() {
		return this.posts.map((post) => ({
			source: `post:${post.ID}`,
			content: [post.post_title, post.post_content].filter(Boolean).join('\n'),
		}));
	}

	async collectWordPressDesignDocuments() {
		const wrapperFile = path.join(this.episodeRoot, 'design-fingerprint-documents.php');
		await writeFile(wrapperFile, `<?php
$documents = array();
$posts = get_posts(array(
    'post_type' => array('post', 'page', 'wp_template', 'wp_template_part', 'wp_navigation'),
    'post_status' => array('publish', 'draft', 'auto-draft'),
    'numberposts' => 200,
));
foreach ($posts as $post) {
    $documents[] = array(
        'source' => $post->post_type . ':' . $post->post_name,
        'content' => $post->post_title . "\n" . $post->post_content,
    );
}
if (function_exists('wp_get_global_stylesheet')) {
    $documents[] = array('source' => 'global-stylesheet', 'content' => wp_get_global_stylesheet());
}
if (function_exists('wp_get_global_settings')) {
    $documents[] = array('source' => 'global-settings', 'content' => wp_json_encode(wp_get_global_settings()));
}
echo wp_json_encode(array('documents' => $documents));
`);

		const { execution } = await (await this.wpCodeboxEpisode()).step({
			command: 'wordpress.run-php',
			args: [`code-file=${wrapperFile}`],
		});
		const result = jsonFromOutput(execution.stdout);
		return Array.isArray(result.documents) ? result.documents : [];
	}

	async wpCodeboxEpisode() {
		if (!this.runtimeEpisode) {
			this.runtimeEpisode = await this.createWpCodeboxEpisode();
		}

		return this.runtimeEpisode;
	}

	async createWpCodeboxEpisode() {
		return await createRuntimeEpisode({
			runtime: {
				backend: 'wordpress-playground',
				environment: {
					kind: 'wordpress',
					name: `wp-gym-${this.scenario.id}`,
					version: this.options.wpVersion || this.options.wpCodeboxWordPressVersion || '7.0',
					blueprint: this.wpCodeboxBlueprint(),
				},
				policy: {
					network: 'deny',
					filesystem: 'readwrite-mounts',
					commands: ['wordpress.wp-cli', 'wordpress.run-php'],
					secrets: 'none',
					approvals: 'never',
				},
				artifactsDirectory: path.join(this.episodeRoot, 'wp-codebox-artifacts'),
				metadata: {
					runtime: { caller: 'wp-gym' },
					task: { kind: 'wp-gym-local', scenario_id: this.scenario.id },
				},
			},
			mounts: [
				{
					type: 'directory',
					source: this.root,
					target: '/inputs/repo',
					mode: 'readonly',
				},
			],
			resetObservations: [{ type: 'runtime-info' }],
		}, createPlaygroundRuntimeBackend());
	}

	wpCodeboxBlueprint() {
		const resetFixture = this.scenario.environment.reset_fixture;
		if (resetFixture && typeof resetFixture === 'object') {
			return resetFixture;
		}

		return { steps: [] };
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
		return actionCapabilitiesForScenario(this.scenario);
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
