import { createServer as createNetServer } from 'node:net';
import {
	CODEBOX_REPOSITORY_MOUNT_TARGET,
	CODEBOX_WORDPRESS_BACKEND_ID,
	CODEBOX_WORKSPACE_MOUNT_TARGET,
	codeboxArtifactEvidenceRefs,
	codeboxArtifactRoot,
	codeboxArtifactTraceRefs,
	codeboxBrowserArtifactMetrics,
	codeboxWorkspaceArtifactSummary,
	collectCodeboxWorkspaceArtifacts,
	createCodeboxWordPressEpisode,
	normalizeCodeboxArtifactRefs,
	readCodeboxArtifactJson,
	runCodeboxRuntimeAction,
} from './codebox-public-runtime.js';

export const WORDPRESS_RUNTIME_COMMANDS = {
	wpCli: 'wordpress.wp-cli',
	restRequest: 'wordpress.rest-request',
	runPhp: 'wordpress.run-php',
	browserProbe: 'wordpress.browser-probe',
	browserActions: 'wordpress.browser-actions',
	editorOpen: 'wordpress.editor-open',
	inspectMountedInputs: 'inspect-mounted-inputs',
};

export const WORDPRESS_RUNTIME_WORKSPACE_ROOT = CODEBOX_WORKSPACE_MOUNT_TARGET;
export const WORDPRESS_RUNTIME_REPOSITORY_ROOT = CODEBOX_REPOSITORY_MOUNT_TARGET;

const browserArtifactMimeTypes = {
	steps: 'application/x-ndjson',
	console: 'application/x-ndjson',
	errors: 'application/x-ndjson',
	html: 'text/html; charset=utf-8',
	memory: 'application/json',
	network: 'application/x-ndjson',
	performance: 'application/json',
	screenshot: 'image/png',
	editorState: 'application/json',
	summary: 'application/json',
};

export function wordpressRuntimeArtifactRoot(episodeRoot) {
	return codeboxArtifactRoot(episodeRoot);
}

export async function allocateWordPressRuntimePreviewPort() {
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

export function isWordPressRuntimePreviewPortUnavailable(error) {
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

export function wordpressRuntimeRepositoryPath(relativePath) {
	return `${WORDPRESS_RUNTIME_REPOSITORY_ROOT}/${String(relativePath || '').replace(/^\/+/, '')}`;
}

export function wordpressRuntimeWorkspacePath(relativePath = '') {
	const suffix = String(relativePath || '').replace(/^\/+/, '');
	return suffix ? `${WORDPRESS_RUNTIME_WORKSPACE_ROOT}/${suffix}`.replace(/\/+/g, '/') : WORDPRESS_RUNTIME_WORKSPACE_ROOT;
}

export function wordpressRuntimeWorkspaceEnv(name) {
	return `${name}=${WORDPRESS_RUNTIME_WORKSPACE_ROOT}`;
}

export function wordpressRuntimeMountPlan({ repositoryRoot, workspaceRoot, scenarioEnvironment }) {
	const mounts = [
		{
			source: repositoryRoot,
			target: WORDPRESS_RUNTIME_REPOSITORY_ROOT,
			mode: 'readonly',
			role: 'scenario_repository',
		},
	];

	if (scenarioEnvironment?.uses_workspace) {
		mounts.push({
			source: workspaceRoot,
			target: WORDPRESS_RUNTIME_WORKSPACE_ROOT,
			mode: (scenarioEnvironment?.writable_roots || []).length > 0 ? 'readwrite' : 'readonly',
			role: 'scenario_workspace',
			writable_roots: scenarioEnvironment?.writable_roots || [],
		});
	}

	return mounts;
}

export function wordpressRuntimeActionPolicy({ workspaceRoot, scenarioEnvironment }) {
	const writableRoots = Array.isArray(scenarioEnvironment?.writable_roots)
		? scenarioEnvironment.writable_roots.map((root) => wordpressRuntimeWorkspacePath(root))
		: [];
	const workspaceMount = scenarioEnvironment?.uses_workspace
		? [{
			type: 'directory',
			source: workspaceRoot,
			target: WORDPRESS_RUNTIME_WORKSPACE_ROOT,
			mode: writableRoots.length > 0 ? 'readwrite' : 'readonly',
		}]
		: [];

	return {
		mounts: workspaceMount,
		filesystem: 'readwrite-mounts',
		writableRoots: writableRoots.length > 0 ? writableRoots : [WORDPRESS_RUNTIME_WORKSPACE_ROOT],
	};
}

export function browserArtifactRefs(files = {}) {
	return Object.entries(files)
		.filter(([, filePath]) => typeof filePath === 'string' && filePath.length > 0)
		.map(([kind, filePath]) => ({
			path: filePath,
			...(browserArtifactMimeTypes[kind] ? { mime_type: browserArtifactMimeTypes[kind] } : {}),
		}));
}

export function runtimeArtifactRefs(refs = []) {
	return codeboxArtifactEvidenceRefs(refs);
}

export function runtimeTraceRefs(refs = []) {
	return codeboxArtifactTraceRefs(refs);
}

export function normalizeRuntimeArtifactRefs(refs = []) {
	return normalizeCodeboxArtifactRefs(refs);
}

export async function wordpressRuntimeBrowserMetrics(episodeRoot) {
	return await codeboxBrowserArtifactMetrics(wordpressRuntimeArtifactRoot(episodeRoot));
}

export async function readWordPressRuntimeArtifactJson(episodeRoot, ref) {
	return await readCodeboxArtifactJson(wordpressRuntimeArtifactRoot(episodeRoot), ref);
}

export async function runWordPressRuntimeAction(episode, action, policy) {
	return await runCodeboxRuntimeAction(episode, action, policy);
}

export async function collectWordPressRuntimeWorkspaceFiles(episode) {
	return await collectCodeboxWorkspaceArtifacts(episode);
}

export function wordpressRuntimeWorkspaceArtifactSummary(workspaceArtifacts) {
	if (!workspaceArtifacts) {
		return null;
	}

	return codeboxWorkspaceArtifactSummary(workspaceArtifacts);
}

export async function createWordPressRuntimeEpisode({
	repositoryRoot,
	workspaceRoot,
	workspaceBaselineRoot,
	scenarioEnvironment,
	options,
	blueprint,
	previewPort,
	artifactsDirectory,
}) {
	const mounts = [
		{
			type: 'directory',
			source: repositoryRoot,
			target: CODEBOX_REPOSITORY_MOUNT_TARGET,
			mode: 'readonly',
		},
	];

	if (scenarioEnvironment?.uses_workspace) {
		mounts.push({
			type: 'directory',
			source: workspaceRoot,
			target: CODEBOX_WORKSPACE_MOUNT_TARGET,
			mode: (scenarioEnvironment?.writable_roots || []).length > 0 ? 'readwrite' : 'readonly',
			metadata: {
				role: 'workspace',
				writable_roots: scenarioEnvironment?.writable_roots || [],
				baselineSource: workspaceBaselineRoot,
			},
		});
	}

	return await createCodeboxWordPressEpisode({
		runtime: {
			backend: CODEBOX_WORDPRESS_BACKEND_ID,
			environment: {
				kind: 'wordpress',
				name: 'wp-gym-runtime',
				version: options.wpVersion || '7.0',
				blueprint,
			},
			preview: {
				port: previewPort,
				bind: '127.0.0.1',
			},
			policy: {
				network: 'deny',
				filesystem: 'readwrite-mounts',
				commands: Object.values(WORDPRESS_RUNTIME_COMMANDS),
				secrets: 'none',
				approvals: 'never',
			},
			artifactsDirectory,
			metadata: {
				runtime: { caller: 'wp-gym' },
			},
		},
		mounts,
		resetObservations: [{ type: 'runtime-info' }],
	});
}

export async function createWordPressSandbox(input) {
	const episode = await createWordPressRuntimeEpisode(input);
	return new WordPressSandboxAdapter({ episode, episodeRoot: input.episodeRoot });
}

class WordPressSandboxAdapter {
	constructor({ episode, episodeRoot }) {
		this.episode = episode;
		this.episodeRoot = episodeRoot;
	}

	artifactRoot() {
		return wordpressRuntimeArtifactRoot(this.episodeRoot);
	}

	async readArtifactJson(ref) {
		return await readWordPressRuntimeArtifactJson(this.episodeRoot, ref);
	}

	async browserMetrics() {
		return await wordpressRuntimeBrowserMetrics(this.episodeRoot);
	}

	async wpCli(action, policy) {
		return await this.runAction(action, policy);
	}

	async restRequest(action, policy) {
		return await this.runAction(action, policy);
	}

	async filesystem(action, policy) {
		return await this.runAction(action, policy);
	}

	async browserActions(action, policy) {
		if (Array.isArray(action?.steps)) {
			return await this.episode.step({
				kind: 'browser',
				command: WORDPRESS_RUNTIME_COMMANDS.browserActions,
				args: [
					`steps-json=${JSON.stringify(action.steps)}`,
					`capture=${(action.capture || []).join(',')}`,
				],
				...(action.operation ? { operation: action.operation } : {}),
				...(action.selector ? { selector: action.selector } : {}),
				...(action.url ? { url: action.url } : {}),
				...(action.timeoutMs ? { timeoutMs: action.timeoutMs } : {}),
			});
		}

		return await this.runAction(action, policy);
	}

	async runAction(action, policy) {
		return await runWordPressRuntimeAction(this.episode, action, policy);
	}

	async runPhp({ codeFile, operation, selector, timeoutMs } = {}) {
		return await this.episode.step({
			command: WORDPRESS_RUNTIME_COMMANDS.runPhp,
			args: [`code-file=${codeFile}`],
			...(operation ? { operation } : {}),
			...(selector ? { selector } : {}),
			...(timeoutMs ? { timeoutMs } : {}),
		});
	}

	async browserProbe({ url, waitFor, capture, operation, selector, timeoutMs } = {}) {
		return await this.episode.step({
			kind: 'browser',
			command: WORDPRESS_RUNTIME_COMMANDS.browserProbe,
			args: [
				`url=${url || '/'}`,
				`wait-for=${waitFor || 'load'}`,
				`capture=${(capture || []).join(',')}`,
			],
			...(operation ? { operation } : {}),
			...(selector ? { selector } : {}),
			...(url ? { url } : {}),
			...(timeoutMs ? { timeoutMs } : {}),
		}, { type: 'browser-result' });
	}

	async editorOpen(action) {
		return await this.episode.step({
			kind: 'browser',
			command: WORDPRESS_RUNTIME_COMMANDS.editorOpen,
			args: action.args || [],
			operation: action.operation,
			...(action.postId ? { postId: action.postId } : {}),
			...(action.postType ? { postType: action.postType } : {}),
			...(action.timeoutMs ? { timeoutMs: action.timeoutMs } : {}),
		});
	}

	async observeWordPressState(options = {}) {
		return await this.episode.observe({
			type: 'wordpress-state',
			...options,
		});
	}

	async collectArtifacts(options = {}) {
		return await this.episode.collectArtifacts({
			includeLogs: true,
			includeObservations: true,
			includePatch: true,
			...options,
		});
	}

	async collectWorkspaceFiles() {
		return await collectWordPressRuntimeWorkspaceFiles(this.episode);
	}

	async trace() {
		return await this.episode.trace();
	}

	async close() {
		await this.episode.close();
	}
}
