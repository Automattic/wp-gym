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
