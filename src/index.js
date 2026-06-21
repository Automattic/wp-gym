import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile, stat, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
	browserArtifactRefs,
	collectWordPressRuntimeWorkspaceFiles,
	createWordPressRuntimeEpisode as createAdaptedWordPressRuntimeEpisode,
	normalizeRuntimeArtifactRefs,
	runWordPressRuntimeAction,
	runtimeArtifactRefs,
	runtimeTraceRefs,
	WORDPRESS_RUNTIME_COMMANDS,
	wordpressRuntimeArtifactRoot,
	wordpressRuntimeBrowserMetrics,
	wordpressRuntimeWorkspaceArtifactSummary,
} from './wordpress-runtime-adapter.js';

const moduleRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const actionSchemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/action.v1.schema.json';
const observationSchemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/observation.v1.schema.json';
const stepResultSchemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/step-result.v1.schema.json';
const traceSchemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/trace.v1.schema.json';
export const WPGYM_API_VERSION = 'wp-gym/js-env/v1';
const implementedLocalActionTypes = ['wp_cli', 'filesystem', 'rest', 'browser'];
const implementedLocalEditorOperations = ['open_post', 'inspect_state'];
const WORDPRESS_RUNTIME_ERROR_CODES = {
	wpCli: 'wordpress_runtime_wp_cli_error',
	rest: 'wordpress_runtime_rest_error',
	browser: 'wordpress_runtime_browser_error',
	editor: 'wordpress_runtime_editor_error',
};

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
		package_exports: {
			action: 'wp-gym/schemas/action.v1.schema.json',
			observation: 'wp-gym/schemas/observation.v1.schema.json',
			step_result: 'wp-gym/schemas/step-result.v1.schema.json',
			trace: 'wp-gym/schemas/trace.v1.schema.json',
		},
	};
}

function publicApiMetadata() {
	return {
		schema_version: 1,
		api_version: WPGYM_API_VERSION,
		status: 'experimental-stable-v1',
		entrypoint: 'wp-gym',
		cli: {
			discovery: [
				'wp-gym api',
				'wp-gym list scenarios',
				'wp-gym list task-sets',
				'wp-gym show scenario <scenario-id>',
				'wp-gym capabilities <scenario-id>',
			],
		},
		methods: {
			discovery: [
				'WPGym.api()',
				'WPGym.apiVersion()',
				'WPGym.listScenarios()',
				'WPGym.listTaskSets()',
				'WPGym.describeScenario()',
				'WPGym.describeTaskSet()',
				'WPGym.capabilities()',
			],
			environment: ['WPGym.make()', 'env.reset()', 'env.step()', 'env.grade()', 'env.trace()', 'env.runtimePlan()', 'env.close()'],
		},
		action_families: {
			filesystem: 'Read, write, list, and delete files inside declared writable roots for workspace scenarios.',
			wp_cli: 'Run WP-CLI commands without the leading wp inside disposable WordPress episodes.',
			rest: 'Send sandbox-relative WordPress REST requests and observe status, headers, and body.',
			browser: 'Replay navigate, click, fill, press, and capture browser steps through the disposable WordPress runtime while preserving browser_result observations.',
			editor: 'Open editors and capture editor state through the disposable WordPress runtime when an editor action is limited to open/state evidence; mutation actions remain evidence-only until generic editor mutation primitives are available.',
			mixed: 'A single episode may combine supported action families when the scenario allows them.',
		},
		contracts: {
			reset: 'Returns an observation.v1 record with scenario_id, episode_id, reset_seed, and workspace_root state.',
			step: 'Accepts one action.v1 record and returns one step-result.v1 record.',
			grade: 'Returns the terminal hidden grader result with success, reward, checks, failure_reasons, and telemetry.',
			trace: 'Returns a trace.v1 replay record for the reset seed and accepted steps.',
		},
		schemas: schemaReferences(),
		versioning_policy: {
			current: WPGYM_API_VERSION,
			compatibility: 'Public v1 records remain additive-compatible within v1; consumers should ignore unknown telemetry and metadata keys.',
			breaking_changes: 'Breaking action, observation, step result, trace, or method-shape changes require a new API version string and schema filenames.',
			governance_boundary: 'Training-loop APIs are versioned separately from benchmark promotion, run registry, and reporting internals.',
		},
	};
}

function actionCapabilitiesForScenario(manifest) {
	return manifest.episode_contract.allowed_action_types;
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
		capabilities: manifest.capabilities || null,
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
	const replayableActionTypes = allowedActionTypes.filter((type) => implementedLocalActionTypes.includes(type));
	const evidenceOnlyActionTypes = allowedActionTypes.filter((type) => !replayableActionTypes.includes(type));

	return {
		schema_version: 1,
		scenario_id: manifest.id,
		wordpress_capabilities: manifest.capabilities || null,
		allowed_action_types: allowedActionTypes,
		replayable_action_types: replayableActionTypes,
		evidence_only_action_types: evidenceOnlyActionTypes,
		implemented_local_action_types: implementedLocalActionTypes,
		implemented_local_editor_operations: implementedLocalEditorOperations,
		observation_types: ['command_result', 'files', 'html', 'logs', 'rest_response', 'screenshot', 'wp_state', 'browser_result', 'editor_result'],
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
		capability_coverage: manifest.capability_coverage || null,
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

function normalizeRestBodyForRequest(body) {
	if (body === undefined || body === null) {
		return undefined;
	}
	if (typeof body === 'string') {
		return body;
	}
	return JSON.stringify(body);
}

function normalizeRestBodyForObservation(body, headers = {}) {
	if (typeof body !== 'string') {
		return body ?? null;
	}

	const contentType = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '';
	if (contentType.toLowerCase().includes('application/json')) {
		try {
			return body === '' ? null : JSON.parse(body);
		} catch {
			return body;
		}
	}

	return body;
}

function headerRecord(headers) {
	return Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => [key, String(value)]));
}

function browserProbeCaptureList(action) {
	const requested = Array.isArray(action.capture) ? action.capture : [];
	const mapped = requested.map((item) => item === 'screenshot' ? 'screenshot' : item).filter((item) => ['console', 'errors', 'html', 'memory', 'network', 'performance', 'screenshot'].includes(item));
	return mapped.length > 0 ? mapped : ['console', 'errors', 'html', 'memory', 'network', 'performance', 'screenshot'];
}

function browserActionsCaptureList(action) {
	const capture = new Set(browserProbeCaptureList(action).filter((item) => ['console', 'errors', 'html', 'network', 'screenshot'].includes(item)));
	capture.add('steps');
	return [...capture];
}

function browserProbeWaitFor(action) {
	if (action.wait_for) {
		return action.wait_for;
	}
	if (action.selector) {
		return `selector:${action.selector}`;
	}
	return 'domcontentloaded';
}

function editorOpenArgs(action) {
	const args = ['capture=steps,console,errors,html,screenshot,editor-state'];
	if (action.post_id) {
		args.push(`post-id=${action.post_id}`);
	}
	if (action.post_type) {
		args.push(`post-type=${action.post_type}`);
	}
	if (!action.post_id && action.operation === 'open_post') {
		args.push('target=post-new');
	}
	if (action.timing?.timeout_ms || action.timeout_ms) {
		args.push(`wait-timeout=${action.timing?.timeout_ms || action.timeout_ms}ms`);
	}

	return args;
}

function editorStateFromEditorOpenResult(action, result) {
	const editor = result.summary?.editor || {};
	const target = result.target || {};
	return {
		...(action.post_id || target.postId ? { post_id: action.post_id || target.postId } : {}),
		...(action.post_type || target.postType || editor.postType ? { post_type: action.post_type || target.postType || editor.postType } : {}),
		...(editor.title ? { title: editor.title } : {}),
		...(editor.postStatus ? { post_status: editor.postStatus } : {}),
		...(Number.isInteger(editor.blockCount) ? { block_count: editor.blockCount } : {}),
		...(typeof editor.dirty === 'boolean' ? { dirty: editor.dirty } : {}),
		...(typeof editor.mode === 'string' ? { mode: editor.mode } : {}),
		...(result.finalUrl ? { url: result.finalUrl } : {}),
	};
}

function runtimeExecutionDuration(execution, fallbackStarted) {
	const started = Date.parse(execution?.startedAt || '');
	const finished = Date.parse(execution?.finishedAt || '');
	return Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, finished - started) : Date.now() - fallbackStarted;
}

function wordpressStateSectionDocuments(section, data) {
	if (section === 'posts' && Array.isArray(data)) {
		return data.map((post) => ({
			source: `post:${post.type || post.post_type || 'post'}:${post.slug || post.id || post.ID || 'unknown'}`,
			content: [post.title || post.post_title || '', post.content || post.post_content || ''].filter(Boolean).join('\n'),
		}));
	}

	if (section === 'templates' && data && typeof data === 'object') {
		const documents = [];
		for (const [group, items] of Object.entries({ templates: data.templates, templateParts: data.templateParts })) {
			for (const template of Array.isArray(items) ? items : []) {
				documents.push({
					source: `template:${group}:${template.slug || template.id || 'unknown'}`,
					content: typeof template.content === 'string' ? template.content : JSON.stringify(template),
				});
			}
		}
		if (data.globalStyles) {
			documents.push({
				source: 'global-styles',
				content: typeof data.globalStyles.stylesheet === 'string' ? data.globalStyles.stylesheet : JSON.stringify(data.globalStyles),
			});
		}
		return documents;
	}

	return [];
}

export function wordpressStateDocumentsFromSections(sections = {}) {
	const documents = [];
	for (const [section, data] of Object.entries(sections || {})) {
		documents.push(...wordpressStateSectionDocuments(section, data));
	}
	return documents;
}

function durationMsArg(milliseconds) {
	return Number.isInteger(milliseconds) && milliseconds > 0 ? `${milliseconds}ms` : null;
}

function isBrowserLoadState(waitFor) {
	return ['domcontentloaded', 'load', 'networkidle'].includes(waitFor);
}

function browserWaitStep(action) {
	if (action.wait_for && !isBrowserLoadState(action.wait_for)) {
		return action.wait_for.startsWith('selector:')
			? { kind: 'waitFor', selector: action.wait_for.slice('selector:'.length) }
			: { kind: 'waitFor', waitFor: action.wait_for };
	}
	if (action.operation === 'capture' && action.selector) {
		return { kind: 'waitFor', selector: action.selector };
	}
	return null;
}

function browserInteractionStepFromAction(action) {
	const step = { kind: action.operation };
	const timeout = durationMsArg(action.timeout_ms || action.timing?.timeout_ms);
	if (timeout) {
		step.timeout = timeout;
	}

	if (action.operation === 'navigate') {
		step.url = action.url || '/';
		if (isBrowserLoadState(action.wait_for)) {
			step.waitFor = action.wait_for;
		}
		return step;
	}

	if (action.operation === 'click') {
		if (action.selector) {
			step.selector = action.selector;
		} else if (typeof action.value === 'string') {
			step.text = action.value;
		}
		return step;
	}

	if (action.operation === 'fill') {
		if (action.selector) {
			step.selector = action.selector;
		}
		step.value = String(action.value ?? '');
		return step;
	}

	if (action.operation === 'press') {
		if (action.selector) {
			step.selector = action.selector;
		}
		step.key = String(action.value ?? '');
		return step;
	}

	return step;
}

function browserActionsSteps(action, targetUrl) {
	const steps = [];
	if (targetUrl && action.operation !== 'navigate') {
		steps.push({ kind: 'navigate', url: targetUrl });
	}
	const waitStep = action.operation === 'navigate' ? null : browserWaitStep(action);
	if (waitStep) {
		steps.push(waitStep);
	}
	steps.push(browserInteractionStepFromAction(action));
	if (action.operation === 'navigate') {
		const postNavigateWaitStep = browserWaitStep(action);
		if (postNavigateWaitStep) {
			steps.push(postNavigateWaitStep);
		}
	}
	return steps;
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

function normalizeTerminalGrade(grade) {
	return {
		...grade,
		checks: Array.isArray(grade?.checks) ? grade.checks : (Array.isArray(grade?.grade?.checks) ? grade.grade.checks : []),
		failure_reasons: Array.isArray(grade?.failure_reasons) ? grade.failure_reasons : [],
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
	static apiVersion() {
		return WPGYM_API_VERSION;
	}

	static api() {
		return publicApiMetadata();
	}

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
		this.workspaceBaselineRoot = path.join(this.episodeRoot, 'workspace-baseline');
		this.posts = [];
		this.nextPostId = 1;
		this.steps = [];
		this.lastGrade = null;
		this.runtimeEpisode = null;
		this.workspaceArtifacts = null;

		await mkdir(this.workspaceRoot, { recursive: true });
		await mkdir(this.workspaceBaselineRoot, { recursive: true });
		const workspaceTemplate = this.scenario.environment?.workspace_template;
		if (workspaceTemplate) {
			await cp(path.join(this.root, workspaceTemplate), this.workspaceRoot, { recursive: true });
			await cp(path.join(this.root, workspaceTemplate), this.workspaceBaselineRoot, { recursive: true });
		}
		if (this.usesWordPressRuntimeBackend()) {
			this.runtimeEpisode = await this.createWordPressRuntimeEpisode();
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
				workspace_root: this.usesWordPressRuntimeBackend() ? '/workspace' : this.workspaceRoot,
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
		} else if (normalizedAction.type === 'rest') {
			observation = await this.stepRest(normalizedAction);
		} else if (normalizedAction.type === 'browser') {
			observation = await this.stepBrowser(normalizedAction);
		} else if (normalizedAction.type === 'editor') {
			observation = await this.stepEditor(normalizedAction);
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
				runner: this.runnerId(),
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
		const grade = normalizeTerminalGrade(await this.runPhpGrader());
		this.lastGrade = grade;
		const behavioralFingerprints = await this.collectBehavioralFingerprints();
		const workspaceArtifacts = wordpressRuntimeWorkspaceArtifactSummary(this.workspaceArtifacts);

		return {
			...grade,
			telemetry: {
				runner: this.runnerId(),
				duration_ms: Date.now() - started,
				...(workspaceArtifacts ? { workspace_artifacts: workspaceArtifacts } : {}),
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
		this.workspaceArtifacts = null;
		if (this.episodeRoot && existsSync(this.episodeRoot)) {
			await rm(this.episodeRoot, { recursive: true, force: true });
		}
		this.closed = true;
	}

	async stepWpCli(action) {
		if (this.usesWordPressRuntime()) {
			return await this.stepWithWordPressRuntimeAction(action);
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

	async stepWithWordPressRuntimeAction(action) {
		if (action.type === 'browser' && ['navigate', 'capture'].includes(action.operation)) {
			return await this.stepBrowserProbeWithWordPressRuntime(action);
		}

		const started = Date.now();
		const runtimeAction = this.toWordPressRuntimeAction(action);
		let runtimeObservation;
		try {
			runtimeObservation = await runWordPressRuntimeAction(
				await this.wordpressRuntimeEpisode(),
				runtimeAction,
				this.wordpressRuntimeActionPolicy()
			);
		} catch (error) {
			if (isWordPressRuntimePreviewPortUnavailable(error)) {
				await this.resetWordPressRuntimeEpisode();
				try {
					runtimeObservation = await runWordPressRuntimeAction(
						await this.wordpressRuntimeEpisode(),
						runtimeAction,
						this.wordpressRuntimeActionPolicy()
					);
				} catch (retryError) {
					return this.wordpressRuntimeActionErrorObservation(action, retryError, Date.now() - started);
				}
			} else {
				return this.wordpressRuntimeActionErrorObservation(action, error, Date.now() - started);
			}
		}

		return await this.fromWordPressRuntimeActionObservation(action, runtimeObservation, started);
	}

	async resetWordPressRuntimeEpisode() {
		await this.runtimeEpisode?.close();
		this.runtimeEpisode = null;
		this.workspaceArtifacts = null;
	}

	toWordPressRuntimeAction(action) {
		if (action.type === 'wp_cli') {
			return { type: 'wp_cli', command: action.command, ...(action.timeout_ms ? { timeout_ms: action.timeout_ms } : {}) };
		}

		if (action.type === 'filesystem') {
			return {
				type: 'filesystem',
				operation: action.operation,
				path: action.path,
				...(action.content !== undefined ? { content: action.content } : {}),
			};
		}

		if (action.type === 'rest') {
			const body = normalizeRestBodyForRequest(action.body);
			return {
				type: 'rest_request',
				method: action.method,
				path: action.path,
				...(action.headers ? { headers: headerRecord(action.headers) } : {}),
				...(typeof action.body === 'string' ? { body } : {}),
				...(action.body !== undefined && typeof action.body !== 'string' ? { body_json: action.body } : {}),
				...(action.timeout_ms ? { timeout_ms: action.timeout_ms } : {}),
			};
		}

		if (action.type === 'browser') {
			return {
				type: 'browser',
				operation: action.operation,
				...(action.url ? { url: action.url } : {}),
				...(action.selector ? { selector: action.selector } : {}),
				...(action.operation === 'press' && action.value !== undefined ? { key: String(action.value) } : {}),
				...(action.operation !== 'press' && action.value !== undefined ? { value: String(action.value) } : {}),
				...(action.wait_for ? { wait_for: action.wait_for } : {}),
				capture: browserActionsCaptureList(action),
				...(action.timeout_ms ? { timeout_ms: action.timeout_ms } : {}),
			};
		}

		throw new Error(`WordPress runtime action adapter does not implement ${action.type} actions.`);
	}

	async fromWordPressRuntimeActionObservation(action, runtimeObservation, started) {
		if (action.type === 'wp_cli') {
			const execution = runtimeObservation.step?.execution || {};
			const status = Number.isInteger(runtimeObservation.data.exitCode) ? runtimeObservation.data.exitCode : execution.exitCode;
			return {
				schema_version: 1,
				type: 'command_result',
				action_type: 'wp_cli',
				command: action.command,
				status,
				stdout: String(runtimeObservation.data.stdout ?? execution.stdout ?? ''),
				stderr: String(runtimeObservation.data.stderr ?? execution.stderr ?? ''),
				timeout_ms: action.timeout_ms,
				timed_out: false,
				duration_ms: runtimeExecutionDuration(execution, started),
				error: status === 0 ? null : { code: WORDPRESS_RUNTIME_ERROR_CODES.wpCli, message: String(runtimeObservation.data.stderr || execution.stderr || 'WP-CLI action failed.') },
			};
		}

		if (action.type === 'filesystem') {
			return this.fromWordPressRuntimeFilesystemObservation(action, runtimeObservation);
		}

		if (action.type === 'rest') {
			const data = runtimeObservation.data && typeof runtimeObservation.data === 'object' ? runtimeObservation.data : {};
			const diagnostics = data.diagnostics && typeof data.diagnostics === 'object' ? data.diagnostics : {};
			const timing = data.timing && typeof data.timing === 'object' ? data.timing : {};
			const status = Number.isInteger(data.status) ? data.status : null;
			const responseHeaders = headerRecord(data.headers || {});
			return {
				schema_version: 1,
				type: 'rest_response',
				action_type: 'rest',
				method: String(data.method || action.method),
				path: action.path,
				status,
				headers: responseHeaders,
				body: normalizeRestBodyForObservation(data.body, responseHeaders),
				timeout_ms: action.timeout_ms,
				timed_out: false,
				duration_ms: Number.isFinite(timing.durationMs) ? timing.durationMs : runtimeExecutionDuration(runtimeObservation.step?.execution || {}, started),
				error: diagnostics.exitCode === 0 && status !== null ? null : { code: WORDPRESS_RUNTIME_ERROR_CODES.rest, message: String(diagnostics.stderr || 'REST action failed.') },
			};
		}

		if (action.type === 'browser') {
			return await this.fromWordPressRuntimeBrowserObservation(action, runtimeObservation, started);
		}

		throw new Error(`WordPress runtime action adapter returned unsupported ${action.type} observation.`);
	}

	fromWordPressRuntimeFilesystemObservation(action, runtimeObservation) {
		if (action.operation === 'list') {
			const entries = Array.isArray(runtimeObservation.data.entries) ? runtimeObservation.data.entries : [];
			return {
				schema_version: 1,
				type: 'files',
				action_type: 'filesystem',
				operation: 'list',
				files: entries.map((entry) => ({
					path: path.posix.join(action.path, String(entry.name || '')),
					kind: entry.type === 'directory' ? 'directory' : entry.type === 'file' ? 'file' : 'unknown',
				})),
			};
		}

		if (action.operation === 'read') {
			const content = String(runtimeObservation.data.content ?? '');
			return {
				schema_version: 1,
				type: 'files',
				action_type: 'filesystem',
				operation: 'read',
				files: [{ path: action.path, kind: 'file', content, sha256: createHash('sha256').update(content).digest('hex'), size_bytes: Buffer.byteLength(content, 'utf8') }],
			};
		}

		if (action.operation === 'write') {
			const content = String(action.content || '');
			return {
				schema_version: 1,
				type: 'files',
				action_type: 'filesystem',
				operation: 'write',
				files: [{ path: action.path, kind: 'file', sha256: createHash('sha256').update(content).digest('hex'), size_bytes: Buffer.byteLength(content, 'utf8') }],
			};
		}

		return { schema_version: 1, type: 'files', action_type: 'filesystem', operation: 'delete', files: [{ path: action.path, kind: 'unknown' }] };
	}

	async fromWordPressRuntimeBrowserObservation(action, runtimeObservation, started) {
		const execution = runtimeObservation.step?.execution || {};
		const stdout = runtimeObservation.data.stdout && typeof runtimeObservation.data.stdout === 'object' ? runtimeObservation.data.stdout : {};
		const files = stdout.files && typeof stdout.files === 'object' ? browserArtifactRefs(stdout.files) : [];
		const artifacts = runtimeArtifactRefs(runtimeObservation.artifactRefs).concat(files);
		const exitCode = Number.isInteger(runtimeObservation.data.exitCode) ? runtimeObservation.data.exitCode : execution.exitCode;
		const browserMetrics = await this.wordpressRuntimeBrowserMetrics();
		return {
			schema_version: 1,
			type: 'browser_result',
			action_type: 'browser',
			operation: action.operation,
			replayability: action.replayability,
			url: stdout.finalUrl || action.url || '/',
			...(action.selector ? { selector: action.selector } : {}),
			artifacts,
			browser_metrics: browserMetrics,
			duration_ms: runtimeExecutionDuration(execution, started),
			error: exitCode === 0 ? null : { code: WORDPRESS_RUNTIME_ERROR_CODES.browser, message: String(runtimeObservation.data.stderr || execution.stderr || 'Browser action failed.') },
		};
	}

	async stepBrowserProbeWithWordPressRuntime(action) {
		const started = Date.now();
		const targetUrl = action.url || '/';
		const capture = browserProbeCaptureList(action);
		const { execution } = await (await this.wordpressRuntimeEpisode()).step({
			kind: 'browser',
			command: WORDPRESS_RUNTIME_COMMANDS.browserProbe,
			args: [
				`url=${targetUrl}`,
				`wait-for=${browserProbeWaitFor(action)}`,
				`capture=${capture.join(',')}`,
			],
			operation: action.operation,
			...(action.selector ? { selector: action.selector } : {}),
			...(action.url ? { url: action.url } : {}),
			timeoutMs: action.timeout_ms,
		}, { type: 'browser-result' });
		const result = jsonFromOutput(execution.stdout);
		const browserMetrics = await this.wordpressRuntimeBrowserMetrics();
		return {
			schema_version: 1,
			type: 'browser_result',
			action_type: 'browser',
			operation: action.operation,
			replayability: action.replayability,
			url: result.finalUrl || targetUrl,
			...(action.selector ? { selector: action.selector } : {}),
			artifacts: browserArtifactRefs(result.files),
			browser_metrics: browserMetrics,
			duration_ms: runtimeExecutionDuration(execution, started),
			error: execution.exitCode === 0 ? null : { code: WORDPRESS_RUNTIME_ERROR_CODES.browser, message: String(execution.stderr || 'Browser probe failed.') },
		};
	}

	async wordpressRuntimeBrowserMetrics() {
		return await wordpressRuntimeBrowserMetrics(this.episodeRoot);
	}

	wordpressRuntimeActionErrorObservation(action, error, durationMs) {
		const message = error instanceof Error ? error.message : String(error);
		if (action.type === 'wp_cli') {
			return {
				schema_version: 1,
				type: 'command_result',
				action_type: 'wp_cli',
				command: action.command,
				status: 1,
				stdout: '',
				stderr: `${message}\n`,
				timeout_ms: action.timeout_ms,
				timed_out: false,
				duration_ms: durationMs,
				error: { code: WORDPRESS_RUNTIME_ERROR_CODES.wpCli, message },
			};
		}

		if (action.type === 'browser') {
			return {
				schema_version: 1,
				type: 'browser_result',
				action_type: 'browser',
				operation: action.operation,
				replayability: action.replayability,
				url: action.url || '/',
				...(action.selector ? { selector: action.selector } : {}),
				artifacts: [],
				duration_ms: durationMs,
				error: { code: WORDPRESS_RUNTIME_ERROR_CODES.browser, message },
			};
		}

		if (action.type === 'rest') {
			return {
				schema_version: 1,
				type: 'rest_response',
				action_type: 'rest',
				method: action.method,
				path: action.path,
				status: null,
				headers: {},
				body: null,
				timeout_ms: action.timeout_ms,
				timed_out: false,
				duration_ms: durationMs,
				error: { code: WORDPRESS_RUNTIME_ERROR_CODES.rest, message },
			};
		}

		throw error;
	}

	async stepFilesystem(action) {
		if (this.usesWordPressRuntimeBackend()) {
			return await this.stepWithWordPressRuntimeAction(action);
		}

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

	async stepRest(action) {
		return await this.stepWithWordPressRuntimeAction(action);
	}

	async stepBrowser(action) {
		if (this.usesWordPressRuntimeBackend()) {
			return await this.stepWithWordPressRuntimeAction(action);
		}

		const started = Date.now();
		const targetUrl = action.url || '/';
		const capture = browserActionsCaptureList(action);
		const steps = browserActionsSteps(action, targetUrl);

		try {
			const { execution } = await (await this.wordpressRuntimeEpisode()).step({
				kind: 'browser',
				command: WORDPRESS_RUNTIME_COMMANDS.browserActions,
				args: [
					`steps-json=${JSON.stringify(steps)}`,
					`capture=${capture.join(',')}`,
				],
				operation: action.operation,
				...(action.selector ? { selector: action.selector } : {}),
				...(action.url ? { url: action.url } : {}),
				timeoutMs: action.timeout_ms,
			});
			const result = jsonFromOutput(execution.stdout);

			return {
				schema_version: 1,
				type: 'browser_result',
				action_type: 'browser',
				operation: action.operation,
				replayability: action.replayability,
				url: result.finalUrl || targetUrl,
				...(action.selector ? { selector: action.selector } : {}),
				artifacts: browserArtifactRefs(result.files),
				duration_ms: Date.now() - started,
				error: null,
			};
		} catch (error) {
			try {
				return await this.stepBrowserWithRuntimePhp(action, started, targetUrl);
			} catch (fallbackError) {
				return {
					schema_version: 1,
					type: 'browser_result',
					action_type: 'browser',
					operation: action.operation,
					replayability: action.replayability,
					url: targetUrl,
					...(action.selector ? { selector: action.selector } : {}),
					artifacts: [],
					duration_ms: Date.now() - started,
					error: { code: WORDPRESS_RUNTIME_ERROR_CODES.browser, message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) },
				};
			}
		}
	}

	async stepBrowserWithRuntimePhp(action, started, targetUrl) {
		const wrapperFile = path.join(this.episodeRoot, `browser-action-${Date.now()}.php`);
		await writeFile(wrapperFile, `<?php
$target = home_url( ${JSON.stringify(targetUrl)} );
$response = wp_remote_get( $target );
if ( is_wp_error( $response ) ) {
    throw new RuntimeException( $response->get_error_message() );
}
echo wp_json_encode( array(
    'finalUrl' => $target,
    'html' => wp_remote_retrieve_body( $response ),
), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
`);

		const { execution } = await (await this.wordpressRuntimeEpisode()).step({
			command: WORDPRESS_RUNTIME_COMMANDS.runPhp,
			args: [`code-file=${wrapperFile}`],
			operation: action.operation,
			...(action.selector ? { selector: action.selector } : {}),
			timeoutMs: action.timeout_ms,
		});
		const result = jsonFromOutput(execution.stdout);
		const html = String(result.html || '');
		const artifacts = [];
		if ((Array.isArray(action.capture) ? action.capture : []).includes('html') || !Array.isArray(action.capture)) {
			artifacts.push({
				path: 'files/browser/snapshot.html',
				sha256: createHash('sha256').update(html).digest('hex'),
				mime_type: 'text/html; charset=utf-8',
			});
		}

		return {
			schema_version: 1,
			type: 'browser_result',
			action_type: 'browser',
			operation: action.operation,
			replayability: action.replayability,
			url: result.finalUrl || targetUrl,
			...(action.selector ? { selector: action.selector } : {}),
			artifacts,
			duration_ms: Date.now() - started,
			error: null,
		};
	}

	async stepEditor(action) {
		if (!implementedLocalEditorOperations.includes(action.operation)) {
			throw new Error(`Local WPGym only maps editor open/state actions through the disposable WordPress runtime; ${action.operation} remains evidence-only.`);
		}

		const started = Date.now();
		try {
			const { execution, observation } = await (await this.wordpressRuntimeEpisode()).step({
				kind: 'browser',
				command: WORDPRESS_RUNTIME_COMMANDS.editorOpen,
				args: editorOpenArgs(action),
				operation: action.operation,
				...(action.post_id ? { postId: action.post_id } : {}),
				...(action.post_type ? { postType: action.post_type } : {}),
				...(action.timeout_ms ? { timeoutMs: action.timeout_ms } : {}),
			});
			const result = jsonFromOutput(execution.stdout);
			const artifacts = runtimeArtifactRefs(observation?.artifactRefs).concat(browserArtifactRefs(result.files));

			return {
				schema_version: 1,
				type: 'editor_result',
				action_type: 'editor',
				operation: action.operation,
				replayability: action.replayability,
				state: editorStateFromEditorOpenResult(action, result),
				artifacts,
				duration_ms: runtimeExecutionDuration(execution, started),
				error: execution.exitCode === 0 ? null : { code: WORDPRESS_RUNTIME_ERROR_CODES.editor, message: String(execution.stderr || 'Editor open action failed.') },
			};
		} catch (error) {
			return {
				schema_version: 1,
				type: 'editor_result',
				action_type: 'editor',
				operation: action.operation,
				replayability: action.replayability,
				state: editorStateFromEditorOpenResult(action, {}),
				artifacts: [],
				duration_ms: Date.now() - started,
				error: { code: WORDPRESS_RUNTIME_ERROR_CODES.editor, message: error instanceof Error ? error.message : String(error) },
			};
		}
	}

	runtimePlan() {
		this.assertOpen();
		const mounts = [
			{
				source: this.root,
				target: '/inputs/repo',
				mode: 'readonly',
				role: 'scenario_repository',
			},
		];
		if (this.scenario.environment?.uses_workspace) {
			mounts.push({
				source: this.workspaceRoot,
				target: '/workspace',
				mode: (this.scenario.environment?.writable_roots || []).length > 0 ? 'readwrite' : 'readonly',
				role: 'scenario_workspace',
				writable_roots: this.scenario.environment?.writable_roots || [],
			});
		}

		return {
			schema: 'wp-gym/runtime-plan/v1',
			scenario_id: this.scenario.id,
			runtime: {
				kind: 'wordpress',
				reset_fixture: this.scenario.environment.reset_fixture,
			},
			limits: {
				max_steps: this.scenario.episode_contract.max_steps,
			},
			mounts,
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
		if (this.usesWordPressRuntimeBackend()) {
			return await this.runPhpGraderWithWordPressRuntime();
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

	async runPhpGraderWithWordPressRuntime() {
		this.workspaceArtifacts = await (await this.wordpressRuntimeEpisode()).collectArtifacts({ includeLogs: true, includeObservations: true, includePatch: true });
		const graderPath = `/inputs/repo/${repoRelative(this.root, resolveFrom(this.scenarioFile, this.scenario.grader_file))}`;
		const wrapperFile = path.join(this.episodeRoot, 'grader-wrapper.php');
		await writeFile(wrapperFile, `<?php
putenv('WP_GYM_AGENT_ROOT=/workspace');
$grader = require ${JSON.stringify(graderPath)};
$result = is_callable($grader) ? $grader() : $grader;
echo json_encode($result, JSON_PRETTY_PRINT);
`);

		const { execution } = await (await this.wordpressRuntimeEpisode()).step({
			command: WORDPRESS_RUNTIME_COMMANDS.runPhp,
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

			const collection = this.usesWordPressRuntime()
				? await this.collectWordPressDesignDocuments()
				: { documents: this.collectLocalDesignDocuments(), artifact_refs: [] };
			fingerprints.push({
				id: probe.id,
				type: probe.type,
				reward_weight: Number(probe.reward_weight || 0),
				fingerprint: designFingerprintFromDocuments(collection.documents),
				...(collection.artifact_refs.length > 0 ? { source_artifacts: collection.artifact_refs } : {}),
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
		const observation = await (await this.wordpressRuntimeEpisode()).observe({
			type: 'wordpress-state',
			sections: ['posts', 'templates'],
			includeContent: true,
		});
		const sections = {};
		for (const ref of normalizeRuntimeArtifactRefs(observation.artifactRefs || [])) {
			if (ref.kind !== 'wordpress-state-section' || !ref.path) {
				continue;
			}
			const artifact = await this.readWordPressRuntimeArtifactJson(ref);
			if (typeof artifact.section === 'string') {
				sections[artifact.section] = artifact.data;
			}
		}

		return {
			documents: wordpressStateDocumentsFromSections(sections),
			artifact_refs: runtimeTraceRefs(observation.artifactRefs || []),
		};
	}

	wordpressRuntimeArtifactRoot() {
		return wordpressRuntimeArtifactRoot(this.episodeRoot);
	}

	async readWordPressRuntimeArtifactJson(ref) {
		return await readJson(path.join(this.wordpressRuntimeArtifactRoot(), ref.path));
	}

	async wordpressRuntimeEpisode() {
		if (!this.runtimeEpisode) {
			this.runtimeEpisode = await this.createWordPressRuntimeEpisode();
		}

		return this.runtimeEpisode;
	}

	usesWordPressRuntime() {
		return this.scenario.environment.action_mode === 'wordpress' && this.options.runtime !== 'local';
	}

	usesWordPressRuntimeBackend() {
		return ['wordpress', 'workspace'].includes(this.scenario.environment.action_mode) && this.options.runtime !== 'local';
	}

	wordpressRuntimeActionPolicy() {
		const writableRoots = Array.isArray(this.scenario.environment?.writable_roots)
			? this.scenario.environment.writable_roots.map((root) => `/workspace/${root}`.replace(/\/+/g, '/'))
			: [];
		const workspaceMount = this.scenario.environment?.uses_workspace
			? [{
				type: 'directory',
				source: this.workspaceRoot,
				target: '/workspace',
				mode: writableRoots.length > 0 ? 'readwrite' : 'readonly',
			}]
			: [];

		return {
			mounts: workspaceMount,
			filesystem: 'readwrite-mounts',
			writableRoots: writableRoots.length > 0 ? writableRoots : ['/workspace'],
		};
	}

	runnerId() {
		return this.usesWordPressRuntimeBackend() ? 'wordpress-runtime' : 'local-wpgym';
	}

	async createWordPressRuntimeEpisode() {
		return await createAdaptedWordPressRuntimeEpisode({
			repositoryRoot: this.root,
			workspaceRoot: this.workspaceRoot,
			workspaceBaselineRoot: this.workspaceBaselineRoot,
			scenarioEnvironment: this.scenario.environment,
			options: this.options,
			blueprint: this.wordpressRuntimeBlueprint(),
			previewPort: await availableLocalPort(),
			artifactsDirectory: this.wordpressRuntimeArtifactRoot(),
		});
	}

	wordpressRuntimeBlueprint() {
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
		return this.scenario.episode_contract.max_steps;
	}

	successChecks() {
		return this.scenario.episode_contract.success_checks;
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
		if (this.usesWordPressRuntimeBackend()) {
			const artifactFiles = await this.wordpressRuntimeWorkspaceFiles();
			if (artifactFiles.length > 0) {
				return artifactFiles;
			}
		}

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

	async wordpressRuntimeWorkspaceFiles() {
		const result = await collectWordPressRuntimeWorkspaceFiles(await this.wordpressRuntimeEpisode());
		this.workspaceArtifacts = result.workspaceArtifacts;
		return result.files;
	}
}

function isWordPressRuntimePreviewPortUnavailable(error) {
	if (!error || typeof error !== 'object') {
		return false;
	}
	if (error.code === 'wp-codebox-preview-port-in-use' || error.code === 'EADDRINUSE') {
		return true;
	}
	if (error.cause && isWordPressRuntimePreviewPortUnavailable(error.cause)) {
		return true;
	}
	return error instanceof Error && /EADDRINUSE|preview-port .* unavailable/i.test(error.message);
}

async function availableLocalPort() {
	const server = createNetServer();
	try {
		await new Promise((resolveListen, rejectListen) => {
			server.once('error', rejectListen);
			server.listen(0, '127.0.0.1', () => resolveListen());
		});
		const address = server.address();
		if (!address || typeof address === 'string') {
			throw new Error('Unable to allocate a local preview port.');
		}
		return address.port;
	} finally {
		if (server.listening) {
			await new Promise((resolveClose, rejectClose) => {
				server.close((error) => error ? rejectClose(error) : resolveClose());
			});
		}
	}
}

export { quoteCliValue };
