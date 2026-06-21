import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRuntimeEpisode, normalizeObservationArtifactRefs, runRuntimeAction } from 'wp-codebox-workspace/core';
import { browserArtifactMetrics, createPlaygroundRuntimeBackend } from 'wp-codebox-workspace/playground';

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

async function readJson(file) {
	return JSON.parse(await readFile(file, 'utf8'));
}

export function wordpressRuntimeArtifactRoot(episodeRoot) {
	return path.join(episodeRoot, 'wp-codebox-artifacts');
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
	return normalizeObservationArtifactRefs(refs)
		.map((ref) => ({
			path: ref.path,
			...(ref.digest?.algorithm === 'sha256' ? { sha256: ref.digest.value } : {}),
		}));
}

export function runtimeTraceRefs(refs = []) {
	return normalizeObservationArtifactRefs(refs)
		.map((ref) => ({
			kind: ref.kind || null,
			path_or_url: ref.path,
			sha256: ref.digest?.algorithm === 'sha256' ? ref.digest.value : null,
			id: ref.id || null,
		}));
}

export function normalizeRuntimeArtifactRefs(refs = []) {
	return normalizeObservationArtifactRefs(refs);
}

export async function wordpressRuntimeBrowserMetrics(episodeRoot) {
	const result = await browserArtifactMetrics(wordpressRuntimeArtifactRoot(episodeRoot));
	return {
		schema: result.schema,
		hasBrowserMetrics: result.hasBrowserMetrics,
		metrics: result.metrics,
		artifacts: result.artifacts,
	};
}

export async function runWordPressRuntimeAction(episode, action, policy) {
	return await runRuntimeAction(episode, action, policy);
}

export async function collectWordPressRuntimeWorkspaceFiles(episode) {
	const workspaceArtifacts = await episode.collectArtifacts({ includeLogs: true, includeObservations: true, includePatch: true });
	const candidates = [];

	for (const artifactPath of [workspaceArtifacts.capturedMountsPath, workspaceArtifacts.changedFilesPath]) {
		if (!artifactPath || !existsSync(artifactPath)) {
			continue;
		}

		const artifact = await readJson(artifactPath);
		const files = Array.isArray(artifact.files) ? artifact.files : [];
		for (const file of files) {
			if (file?.mountTarget === '/workspace' && typeof file.relativePath === 'string' && file.relativePath !== '') {
				candidates.push(file.relativePath.replace(/^\/+/, ''));
			}
		}
	}

	return {
		workspaceArtifacts,
		files: [...new Set(candidates)].sort(),
	};
}

export function wordpressRuntimeWorkspaceArtifactSummary(workspaceArtifacts) {
	if (!workspaceArtifacts) {
		return null;
	}

	return {
		id: workspaceArtifacts.id,
		changed_files: workspaceArtifacts.changedFilesPath,
		patch: workspaceArtifacts.patchPath,
		captured_mounts: workspaceArtifacts.capturedMountsPath,
	};
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
			target: '/inputs/repo',
			mode: 'readonly',
		},
	];

	if (scenarioEnvironment?.uses_workspace) {
		mounts.push({
			type: 'directory',
			source: workspaceRoot,
			target: '/workspace',
			mode: (scenarioEnvironment?.writable_roots || []).length > 0 ? 'readwrite' : 'readonly',
			metadata: {
				role: 'workspace',
				writable_roots: scenarioEnvironment?.writable_roots || [],
				baselineSource: workspaceBaselineRoot,
			},
		});
	}

	return await createRuntimeEpisode({
		runtime: {
			backend: 'wordpress-playground',
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
	}, createPlaygroundRuntimeBackend());
}
