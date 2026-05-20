import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function normalizeRelativePath(value, label = 'path') {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`${label} must be a non-empty string`);
	}

	const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '');
	if (
		normalized === '' ||
		normalized.startsWith('/') ||
		path.isAbsolute(normalized) ||
		normalized.split('/').includes('..')
	) {
		throw new Error(`${label} must be repo-relative without traversal: ${value}`);
	}

	return normalized;
}

function pathHasPrefix(candidate, prefix) {
	return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

function parseGitStatusZ(output) {
	const fields = output.split('\0').filter(Boolean);
	const entries = [];

	for (let index = 0; index < fields.length; index += 1) {
		const field = fields[index];

		if (field.startsWith('1 ')) {
			const parts = field.split(' ');
			const status = parts[1];
			const pathValue = parts.slice(8).join(' ');
			entries.push({
				status,
				path: normalizeRelativePath(pathValue, 'git status path'),
				headMode: parts[3],
				indexMode: parts[4],
				worktreeMode: parts[5],
				ignored: false,
				unmerged: false,
			});
			continue;
		}

		if (field.startsWith('2 ')) {
			const parts = field.split(' ');
			const status = parts[1];
			const pathValue = parts.slice(9).join(' ');
			const originalPath = fields[index + 1] || '';
			index += 1;
			for (const rawPath of [pathValue, originalPath]) {
				if (rawPath) {
					entries.push({
						status,
						path: normalizeRelativePath(rawPath, 'git status path'),
						headMode: parts[3],
						indexMode: parts[4],
						worktreeMode: parts[5],
						ignored: false,
						unmerged: false,
					});
				}
			}
			continue;
		}

		if (field.startsWith('u ')) {
			const parts = field.split(' ');
			const status = parts[1];
			const pathValue = parts.slice(10).join(' ');
			entries.push({
				status,
				path: normalizeRelativePath(pathValue, 'git status path'),
				headMode: parts[4],
				indexMode: parts[5],
				worktreeMode: parts[6],
				ignored: false,
				unmerged: true,
			});
			continue;
		}

		if (field.startsWith('? ') || field.startsWith('! ')) {
			entries.push({
				status: field.slice(0, 1),
				path: normalizeRelativePath(field.slice(2), 'git status path'),
				headMode: null,
				indexMode: null,
				worktreeMode: null,
				ignored: field.startsWith('! '),
				unmerged: false,
			});
		}
	}

	return entries;
}

function gitStatus(workspaceRoot) {
	const result = spawnSync(
		'git',
		['-C', workspaceRoot, 'status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignored=matching'],
		{ encoding: 'utf8' }
	);

	if (result.status !== 0) {
		return {
			ok: false,
			error: `${result.stderr || result.stdout || 'git status failed'}`.trim(),
			entries: [],
		};
	}

	return {
		ok: true,
		error: null,
		entries: parseGitStatusZ(result.stdout),
	};
}

function gitTrackedModes(workspaceRoot) {
	const result = spawnSync(
		'git',
		['-C', workspaceRoot, 'ls-files', '--stage', '-z'],
		{ encoding: 'utf8' }
	);

	if (result.status !== 0) {
		return {
			ok: false,
			error: `${result.stderr || result.stdout || 'git ls-files failed'}`.trim(),
			entries: [],
		};
	}

	return {
		ok: true,
		error: null,
		entries: result.stdout.split('\0').filter(Boolean).map((record) => {
			const match = record.match(/^([0-9]+) [0-9a-f]+ [0-9]+\t(.+)$/);
			return {
				mode: match?.[1] || '',
				path: normalizeRelativePath(match?.[2] || record, 'git tracked path'),
			};
		}),
	};
}

function realpathIfExists(absolutePath) {
	try {
		return fs.realpathSync(absolutePath);
	} catch {
		return null;
	}
}

function isContainedBy(candidate, root) {
	const relative = path.relative(root, candidate);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function defaultPolicyFromManifest(manifest) {
	const environment = manifest?.environment || {};
	return {
		writableRoots: environment.writable_roots || [],
		hiddenPaths: environment.hidden_paths || [],
	};
}

function policySha256(policy) {
	const normalized = {
		writableRoots: [...(policy.writableRoots || [])].sort(),
		hiddenPaths: [...(policy.hiddenPaths || [])].sort(),
	};

	return `sha256:${crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex')}`;
}

function pathContainsGitMetadata(relativePath) {
	return relativePath.split('/').includes('.git');
}

function addViolation(violations, violation) {
	if (
		violations.some((existing) =>
			existing.path === violation.path &&
			existing.reason === violation.reason &&
			existing.status === violation.status
		)
	) {
		return;
	}

	violations.push(violation);
}

function modeType(mode) {
	return typeof mode === 'string' && mode.length >= 3 ? mode.slice(0, 3) : '';
}

function scanPath({ rootRealpath, relativePath, status, writableRootRealpaths, violations }) {
	const absolutePath = path.join(rootRealpath, relativePath);

	if (pathContainsGitMetadata(relativePath)) {
		addViolation(violations, { path: relativePath, reason: 'nested_git_metadata', status });
	}

	if (!fs.existsSync(absolutePath)) {
		return;
	}

	const lstat = fs.lstatSync(absolutePath);
	if (lstat.isSymbolicLink()) {
		addViolation(violations, { path: relativePath, reason: 'symlink', status });
		return;
	}

	if (!lstat.isFile() && !lstat.isDirectory()) {
		addViolation(violations, { path: relativePath, reason: 'non_regular_file', status });
		return;
	}

	if (lstat.isFile()) {
		const realpath = fs.realpathSync(absolutePath);
		if (!isContainedBy(realpath, rootRealpath)) {
			addViolation(violations, { path: relativePath, reason: 'outside_workspace', status });
		}

		if (!writableRootRealpaths.some((rootPath) => isContainedBy(realpath, rootPath.realpath))) {
			addViolation(violations, { path: relativePath, reason: 'outside_writable_root', status });
		}
		return;
	}

	for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
		scanPath({
			rootRealpath,
			relativePath: `${relativePath}/${entry.name}`,
			status,
			writableRootRealpaths,
			violations,
		});
	}
}

export function checkWorkspacePolicy({ workspaceRoot, manifest = null, policy = null }) {
	const violations = [];
	const root = path.resolve(workspaceRoot);
	const rootRealpath = realpathIfExists(root);

	if (!rootRealpath) {
		return {
			passed: false,
			policy_sha256: null,
			violations: [{ path: '.', reason: 'missing_workspace_root' }],
		};
	}

	if (!fs.existsSync(path.join(rootRealpath, '.git'))) {
		return {
			passed: false,
			policy_sha256: null,
			violations: [{ path: '.git', reason: 'missing_git_root' }],
		};
	}

	const effectivePolicy = policy || defaultPolicyFromManifest(manifest);
	const writableRoots = (effectivePolicy.writableRoots || []).map((entry) =>
		normalizeRelativePath(entry, 'writable root')
	);
	const hiddenPaths = (effectivePolicy.hiddenPaths || []).map((entry) =>
		normalizeRelativePath(entry, 'hidden path')
	);
	const policyHash = policySha256({ writableRoots, hiddenPaths });

	if (writableRoots.length === 0) {
		violations.push({ path: '.', reason: 'no_writable_roots' });
	}

	const writableRootRealpaths = [];
	for (const writableRoot of writableRoots) {
		const absolute = path.join(rootRealpath, writableRoot);
		const realpath = realpathIfExists(absolute);
		if (!realpath) {
			violations.push({ path: writableRoot, reason: 'missing_writable_root' });
			continue;
		}
		writableRootRealpaths.push({ relative: writableRoot, realpath });
	}

	const status = gitStatus(rootRealpath);
	if (!status.ok) {
		return {
			passed: false,
			policy_sha256: policyHash,
			violations: [{ path: '.', reason: 'git_status_failed', detail: status.error }],
		};
	}

	const trackedModes = gitTrackedModes(rootRealpath);
	if (!trackedModes.ok) {
		return {
			passed: false,
			policy_sha256: policyHash,
			violations: [{ path: '.', reason: 'git_ls_files_failed', detail: trackedModes.error }],
		};
	}

	for (const tracked of trackedModes.entries) {
		if (tracked.mode === '120000') {
			addViolation(violations, { path: tracked.path, reason: 'tracked_symlink', status: 'tracked' });
		}
		if (tracked.mode === '160000') {
			addViolation(violations, { path: tracked.path, reason: 'gitlink', status: 'tracked' });
		}
	}

	for (const writableRoot of writableRoots) {
		if (!fs.existsSync(path.join(rootRealpath, writableRoot))) {
			continue;
		}
		scanPath({
			rootRealpath,
			relativePath: writableRoot,
			status: 'workspace_scan',
			writableRootRealpaths,
			violations,
		});
	}

	for (const entry of status.entries) {
		const relativePath = entry.path;

		if (hiddenPaths.some((hiddenPath) => pathHasPrefix(relativePath, hiddenPath))) {
			addViolation(violations, { path: relativePath, reason: 'hidden_path', status: entry.status });
		}

		if (!writableRoots.some((writableRoot) => pathHasPrefix(relativePath, writableRoot))) {
			addViolation(violations, { path: relativePath, reason: 'non_writable_path', status: entry.status });
		}

		if (entry.ignored) {
			addViolation(violations, { path: relativePath, reason: 'ignored_path', status: entry.status });
		}

		if (entry.unmerged) {
			addViolation(violations, { path: relativePath, reason: 'unmerged_path', status: entry.status });
		}

		for (const mode of [entry.headMode, entry.indexMode, entry.worktreeMode]) {
			if (mode === '120000') {
				addViolation(violations, { path: relativePath, reason: 'symlink_mode', status: entry.status });
			}
			if (mode === '160000') {
				addViolation(violations, { path: relativePath, reason: 'gitlink', status: entry.status });
			}
		}
		if (
			entry.headMode &&
			entry.indexMode &&
			modeType(entry.headMode) !== modeType(entry.indexMode)
		) {
			addViolation(violations, { path: relativePath, reason: 'git_mode_change', status: entry.status });
		}

		scanPath({
			rootRealpath,
			relativePath,
			status: entry.status,
			writableRootRealpaths,
			violations,
		});
	}

	return {
		passed: violations.length === 0,
		policy_sha256: policyHash,
		violations,
	};
}

function parseArgs(argv) {
	const args = {
		workspaceRoot: '',
		manifestPath: '',
		json: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--workspace') {
			args.workspaceRoot = argv[++index] || '';
		} else if (arg === '--manifest') {
			args.manifestPath = argv[++index] || '';
		} else if (arg === '--json') {
			args.json = true;
		}
	}

	if (!args.workspaceRoot || !args.manifestPath) {
		throw new Error('Usage: node scripts/check-workspace-policy.mjs --workspace <path> --manifest <scenario.json> [--json]');
	}

	return args;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const args = parseArgs(process.argv.slice(2));
	const manifest = JSON.parse(fs.readFileSync(args.manifestPath, 'utf8'));
	const result = checkWorkspacePolicy({
		workspaceRoot: args.workspaceRoot,
		manifest,
	});

	if (args.json) {
		console.log(JSON.stringify(result, null, 2));
	} else if (result.passed) {
		console.log('Workspace policy passed.');
	} else {
		console.error(`Workspace policy failed: ${result.violations.map((violation) => `${violation.path}:${violation.reason}`).join(', ')}`);
	}

	process.exit(result.passed ? 0 : 1);
}
