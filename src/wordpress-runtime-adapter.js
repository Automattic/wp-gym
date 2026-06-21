import { createServer as createNetServer } from 'node:net';
import {
	CODEBOX_REPOSITORY_MOUNT_TARGET,
	CODEBOX_WORDPRESS_BACKEND_ID,
	CODEBOX_WORKSPACE_MOUNT_TARGET,
	WP_CODEBOX_COMMANDS,
	codeboxArtifactEvidenceRefs,
	codeboxArtifactRoot,
	codeboxArtifactTraceRefs,
	codeboxBrowserArtifactMetrics,
	codeboxRepositoryMount,
	codeboxWorkspaceMount,
	codeboxWorkspaceArtifactSummary,
	collectCodeboxWorkspaceArtifacts,
	createCodeboxWordPressEpisode,
	createWpCodeboxSandbox,
	normalizeCodeboxArtifactRefs,
	readCodeboxArtifactJson,
	runCodeboxRuntimeAction,
} from './runtime/wp-codebox-adapter.js';
export const WORDPRESS_RUNTIME_COMMANDS = WP_CODEBOX_COMMANDS;

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
		codeboxRepositoryMount(repositoryRoot),
	];

	if (scenarioEnvironment?.uses_workspace) {
		mounts.push(codeboxWorkspaceMount(workspaceRoot, {
			mode: (scenarioEnvironment?.writable_roots || []).length > 0 ? 'readwrite' : 'readonly',
			metadata: {
				role: 'workspace',
				writable_roots: scenarioEnvironment?.writable_roots || [],
				baselineSource: workspaceBaselineRoot,
			},
		}));
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
	return createWpCodeboxSandbox({ episode, episodeRoot: input.episodeRoot });
}
