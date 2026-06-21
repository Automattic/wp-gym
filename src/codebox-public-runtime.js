import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRuntimeEpisode, normalizeObservationArtifactRefs, runRuntimeAction } from 'wp-codebox-workspace/core';
import { browserArtifactMetrics, createPlaygroundRuntimeBackend } from 'wp-codebox-workspace/playground';

export const CODEBOX_WORDPRESS_BACKEND_ID = 'wordpress-playground';
export const CODEBOX_WORKSPACE_MOUNT_TARGET = '/workspace';
export const CODEBOX_REPOSITORY_MOUNT_TARGET = '/inputs/repo';

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
