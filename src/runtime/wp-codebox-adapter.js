import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRuntimeEpisode, normalizeObservationArtifactRefs, runRuntimeAction } from 'wp-codebox-workspace/core';
import { browserArtifactMetrics, createPlaygroundRuntimeBackend } from 'wp-codebox-workspace/playground';

export const CODEBOX_WORDPRESS_BACKEND_ID = 'wordpress-playground';
export const CODEBOX_WORKSPACE_MOUNT_TARGET = '/workspace';
export const CODEBOX_REPOSITORY_MOUNT_TARGET = '/inputs/repo';

export const WP_CODEBOX_COMMANDS = {
	wpCli: 'wordpress.wp-cli',
	restRequest: 'wordpress.rest-request',
	runPhp: 'wordpress.run-php',
	browserProbe: 'wordpress.browser-probe',
	browserActions: 'wordpress.browser-actions',
	editorOpen: 'wordpress.editor-open',
	inspectMountedInputs: 'inspect-mounted-inputs',
};

async function readJson(file) {
	return JSON.parse(await readFile(file, 'utf8'));
}

export function codeboxArtifactRoot(episodeRoot) {
	return path.join(episodeRoot, 'wp-codebox-artifacts');
}

export function normalizeCodeboxArtifactRefs(refs = []) {
	return normalizeObservationArtifactRefs(refs);
}

export function codeboxArtifactEvidenceRefs(refs = []) {
	return normalizeCodeboxArtifactRefs(refs)
		.map((ref) => ({
			path: ref.path,
			...(ref.digest?.algorithm === 'sha256' ? { sha256: ref.digest.value } : {}),
		}));
}

export function codeboxArtifactTraceRefs(refs = []) {
	return normalizeCodeboxArtifactRefs(refs)
		.map((ref) => ({
			kind: ref.kind || null,
			path_or_url: ref.path,
			sha256: ref.digest?.algorithm === 'sha256' ? ref.digest.value : null,
			id: ref.id || null,
		}));
}

export async function readCodeboxArtifactJson(artifactRoot, ref) {
	return await readJson(path.join(artifactRoot, ref.path));
}

export async function codeboxBrowserArtifactMetrics(artifactRoot) {
	const result = await browserArtifactMetrics(artifactRoot);
	return {
		schema: result.schema,
		hasBrowserMetrics: result.hasBrowserMetrics,
		metrics: result.metrics,
		artifacts: result.artifacts,
	};
}

export async function runCodeboxRuntimeAction(episode, action, policy) {
	return await runRuntimeAction(episode, action, policy);
}

export async function collectCodeboxWorkspaceArtifacts(episode) {
	const workspaceArtifacts = await episode.collectArtifacts({ includeLogs: true, includeObservations: true, includePatch: true });
	const candidates = [];

	for (const artifactPath of [workspaceArtifacts.capturedMountsPath, workspaceArtifacts.changedFilesPath]) {
		if (!artifactPath || !existsSync(artifactPath)) {
			continue;
		}

		const artifact = await readJson(artifactPath);
		for (const file of codeboxWorkspaceFileDtos(artifact)) {
			candidates.push(file.relativePath);
		}
	}

	return {
		workspaceArtifacts,
		files: [...new Set(candidates)].sort(),
	};
}

export function codeboxWorkspaceArtifactSummary(workspaceArtifacts) {
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

export function codeboxWorkspaceFileDtos(artifact) {
	const files = Array.isArray(artifact?.files) ? artifact.files : [];
	return files
		.filter((file) => file?.mountTarget === CODEBOX_WORKSPACE_MOUNT_TARGET && typeof file.relativePath === 'string' && file.relativePath !== '')
		.map((file) => ({
			mountTarget: CODEBOX_WORKSPACE_MOUNT_TARGET,
			relativePath: file.relativePath.replace(/^\/+/, ''),
		}));
}

export async function createCodeboxWordPressEpisode(input) {
	return await createRuntimeEpisode(input, createPlaygroundRuntimeBackend());
}

export function createWpCodeboxSandbox({ episode, episodeRoot }) {
	return new WpCodeboxSandboxAdapter({ episode, episodeRoot });
}

class WpCodeboxSandboxAdapter {
	constructor({ episode, episodeRoot }) {
		this.episode = episode;
		this.episodeRoot = episodeRoot;
	}

	artifactRoot() {
		return codeboxArtifactRoot(this.episodeRoot);
	}

	async readArtifactJson(ref) {
		return await readCodeboxArtifactJson(this.artifactRoot(), ref);
	}

	async browserMetrics() {
		return await codeboxBrowserArtifactMetrics(this.artifactRoot());
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
				command: WP_CODEBOX_COMMANDS.browserActions,
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
		return await runCodeboxRuntimeAction(this.episode, action, policy);
	}

	async runPhp({ codeFile, operation, selector, timeoutMs } = {}) {
		return await this.episode.step({
			command: WP_CODEBOX_COMMANDS.runPhp,
			args: [`code-file=${codeFile}`],
			...(operation ? { operation } : {}),
			...(selector ? { selector } : {}),
			...(timeoutMs ? { timeoutMs } : {}),
		});
	}

	async browserProbe({ url, waitFor, capture, operation, selector, timeoutMs } = {}) {
		return await this.episode.step({
			kind: 'browser',
			command: WP_CODEBOX_COMMANDS.browserProbe,
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
			command: WP_CODEBOX_COMMANDS.editorOpen,
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
		return await collectCodeboxWorkspaceArtifacts(this.episode);
	}

	async trace() {
		return await this.episode.trace();
	}

	async close() {
		await this.episode.close();
	}
}
