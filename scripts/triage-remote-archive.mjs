import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const successStatuses = new Set(['0', 'ok', 'pass', 'passed', 'success', 'succeeded', 'complete', 'completed']);

function writeFile(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, value);
}

function sha256Text(value) {
	return createHash('sha256').update(value).digest('hex');
}

function bytes(file) {
	return fs.statSync(file).size;
}

function repoRelative(file) {
	return path.relative(root, file).replace(/\\/g, '/');
}

function reportPath(file) {
	const relative = repoRelative(path.resolve(file));
	return relative.startsWith('..') ? path.basename(file) : relative;
}

function archiveRelative(base, file) {
	return path.relative(base, file).replace(/\\/g, '/');
}

function collectFiles(input) {
	const files = [];
	for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
		const entryPath = path.join(input, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectFiles(entryPath));
		} else if (entry.isFile()) {
			files.push(entryPath);
		}
	}
	return files.sort();
}

function readTrimmed(file) {
	return fs.readFileSync(file, 'utf8').trim();
}

function parseRc(value) {
	if (!/^-?\d+$/.test(value.trim())) {
		return null;
	}
	return Number(value.trim());
}

function statusOk(value) {
	return successStatuses.has(value.trim().toLowerCase());
}

function isTarArchive(input) {
	return /\.t(?:ar\.)?gz$/i.test(input) || /\.tar$/i.test(input);
}

function extractArchive(input) {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-gym-remote-archive-'));
	const args = /\.tar$/i.test(input) ? ['-xf', input, '-C', tempRoot] : ['-xzf', input, '-C', tempRoot];
	const result = spawnSync('tar', args, { encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(`tar extraction failed for ${input}: ${result.stderr || result.stdout}`);
	}
	const children = fs.readdirSync(tempRoot).filter((name) => !name.startsWith('.'));
	const archiveRoot = children.length === 1 && fs.statSync(path.join(tempRoot, children[0])).isDirectory()
		? path.join(tempRoot, children[0])
		: tempRoot;
	return { tempRoot, archiveRoot };
}

function resolveInput(input) {
	const resolved = path.resolve(input);
	if (!fs.existsSync(resolved)) {
		throw new Error(`Archive input does not exist: ${input}`);
	}
	const stat = fs.statSync(resolved);
	if (stat.isDirectory()) {
		return { archiveRoot: resolved, tempRoot: null, input_kind: 'directory' };
	}
	if (stat.isFile() && isTarArchive(resolved)) {
		return { ...extractArchive(resolved), input_kind: 'archive' };
	}
	throw new Error(`Archive input must be a directory, .tar, .tar.gz, or .tgz: ${input}`);
}

function cycleIdFrom(input, archiveRoot) {
	const basename = path.basename(input).replace(/\.tar\.gz$/i, '').replace(/\.tgz$/i, '').replace(/\.tar$/i, '');
	return basename || path.basename(archiveRoot);
}

function reviewerName(file) {
	return path.basename(file).replace(/\.(md|rc|status|log|patch)$/i, '');
}

function classifyPatch(file, content = '') {
	const haystack = `${file.replace(/\\/g, '/')}\n${content}`;
	if (/replay|artifact|episode|jsonl|registry/i.test(haystack)) {
		return 'artifact-replay';
	}
	if (/workspace|policy|hidden|path/i.test(haystack)) {
		return 'workspace-policy';
	}
	if (/calibration|baseline|benchmark/i.test(haystack)) {
		return 'calibration';
	}
	if (/fixture|reward|shortcut/i.test(haystack)) {
		return 'reward-fixtures';
	}
	return 'unclassified';
}

function addGap(gaps, code, severity, message, file = null) {
	gaps.push({ code, severity, message, ...(file ? { file } : {}) });
}

function summarizeValidations(files, archiveRoot) {
	const validationFiles = files.filter((file) => {
		const relative = archiveRelative(archiveRoot, file);
		if (/(?:^|\/)reviews\//i.test(relative)) {
			return false;
		}
		return /(?:^|\/)(validations?|checks?|gates?|state)\//i.test(relative)
			|| /(?:npm|test|validate|validation|benchmark|reward|episode|registry|replay)[^/]*\.(?:rc|status)$/i.test(relative);
	});
	const entries = [];
	for (const file of validationFiles) {
		const relative = archiveRelative(archiveRoot, file);
		const value = readTrimmed(file);
		if (file.endsWith('.rc')) {
			const rc = parseRc(value);
			entries.push({ file: relative, kind: 'rc', ok: rc === 0, value: rc });
		} else if (file.endsWith('.status')) {
			entries.push({ file: relative, kind: 'status', ok: statusOk(value), value });
		}
	}
	return entries;
}

function summarizeReviewers(files, archiveRoot) {
	const reviewers = new Map();
	function reviewer(name) {
		if (!reviewers.has(name)) {
			reviewers.set(name, { name, report: null, rc: null, status: null, log: null, patch: null });
		}
		return reviewers.get(name);
	}

	for (const file of files) {
		const relative = archiveRelative(archiveRoot, file);
		if (!/(?:^|\/)reviews\//i.test(relative)) {
			continue;
		}
		const name = reviewerName(file);
		const row = reviewer(name);
		if (/reports\/[^/]+\.md$/i.test(relative)) {
			row.report = { file: relative, bytes: bytes(file) };
		} else if (/reports\/[^/]+\.rc$/i.test(relative)) {
			const rc = parseRc(readTrimmed(file));
			row.rc = { file: relative, value: rc, ok: rc === 0 };
		} else if (/reports\/[^/]+\.status$/i.test(relative)) {
			const value = readTrimmed(file);
			row.status = { file: relative, value, ok: statusOk(value) };
		} else if (/logs\/[^/]+\.log$/i.test(relative)) {
			row.log = { file: relative, bytes: bytes(file) };
		} else if (/patches\/[^/]+\.patch$/i.test(relative)) {
			const content = fs.readFileSync(file, 'utf8');
			row.patch = { file: relative, bytes: bytes(file), sha256: sha256Text(content), area: classifyPatch(relative, content) };
		}
	}

	return [...reviewers.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function summarizePatches(reviewers) {
	const patches = reviewers.map((row) => row.patch).filter(Boolean);
	const nonempty = patches.filter((patch) => patch.bytes > 0);
	const duplicateGroups = new Map();
	const byArea = {};
	for (const patch of nonempty) {
		byArea[patch.area] = (byArea[patch.area] || 0) + 1;
		if (!duplicateGroups.has(patch.sha256)) {
			duplicateGroups.set(patch.sha256, []);
		}
		duplicateGroups.get(patch.sha256).push(patch.file);
	}
	return {
		total: patches.length,
		nonempty: nonempty.length,
		empty: patches.length - nonempty.length,
		unique_nonempty: new Set(nonempty.map((patch) => patch.sha256)).size,
		duplicates: [...duplicateGroups.entries()]
			.filter(([, files]) => files.length > 1)
			.map(([sha256, files]) => ({ sha256, files })),
		by_area: Object.fromEntries(Object.entries(byArea).sort(([left], [right]) => left.localeCompare(right))),
	};
}

function summarizeArchive(input, options) {
	const resolved = resolveInput(input);
	try {
		const archiveRoot = resolved.archiveRoot;
		const files = collectFiles(archiveRoot);
		const reviewers = summarizeReviewers(files, archiveRoot);
		const validations = summarizeValidations(files, archiveRoot);
		const patches = summarizePatches(reviewers);
		const gaps = [];
		const latestMtime = files.reduce((latest, file) => Math.max(latest, fs.statSync(file).mtimeMs), 0);
		const ageDays = latestMtime > 0 ? (options.now.getTime() - latestMtime) / 86400000 : null;

		if (reviewers.length === 0) {
			addGap(gaps, 'missing_reviewers', 'error', 'No reviewer files were found under reviews/.');
		}
		for (const row of reviewers) {
			if (!row.report || row.report.bytes === 0) {
				addGap(gaps, 'missing_reviewer_report', 'error', `${row.name} has no nonempty report.`, row.report?.file || null);
			}
			if (row.rc && !row.rc.ok) {
				addGap(gaps, 'reviewer_rc_failed', 'error', `${row.name} rc is ${row.rc.value}.`, row.rc.file);
			}
			if (row.status && !row.status.ok) {
				addGap(gaps, 'reviewer_status_failed', 'error', `${row.name} status is ${row.status.value}.`, row.status.file);
			}
			if (!row.patch) {
				addGap(gaps, 'missing_reviewer_patch', 'warning', `${row.name} has no patch file.`);
			} else if (row.patch.bytes === 0) {
				addGap(gaps, 'empty_reviewer_patch', 'warning', `${row.name} patch is empty.`, row.patch.file);
			}
		}
		for (const entry of validations) {
			if (!entry.ok) {
				addGap(gaps, 'validation_failed', 'error', `${entry.file} is ${entry.value}.`, entry.file);
			}
		}
		if (validations.length === 0) {
			addGap(gaps, 'missing_validation_status', 'warning', 'No validation .rc or .status files were found.');
		}
		if (patches.duplicates.length > 0) {
			addGap(gaps, 'duplicate_candidate_patches', 'warning', `${patches.duplicates.length} duplicate patch group(s) found.`);
		}
		if (ageDays !== null && ageDays > options.staleDays) {
			addGap(gaps, 'stale_cycle_archive', 'warning', `Latest file mtime is ${ageDays.toFixed(1)} days old.`);
		}

		return {
			schema_version: 1,
			report: {
				name: 'wp-gym-remote-archive-triage',
				created_at: new Date().toISOString(),
				issue: 'https://github.com/Automattic/wp-gym/issues/166',
			},
			archive: {
				cycle_id: cycleIdFrom(input, archiveRoot),
				input: reportPath(input),
				input_kind: resolved.input_kind,
				root: resolved.tempRoot ? path.basename(archiveRoot) : reportPath(archiveRoot),
				files: files.length,
				latest_mtime: latestMtime ? new Date(latestMtime).toISOString() : null,
				age_days: ageDays === null ? null : Number(ageDays.toFixed(2)),
			},
			validations: {
				total: validations.length,
				passed: validations.filter((entry) => entry.ok).length,
				failed: validations.filter((entry) => !entry.ok).length,
				entries: validations,
			},
			reviewers: {
				total: reviewers.length,
				reports: reviewers.filter((row) => row.report && row.report.bytes > 0).length,
				failed: reviewers.filter((row) => row.rc?.ok === false || row.status?.ok === false).length,
				entries: reviewers,
			},
			candidate_patches: patches,
			data_quality_gaps: gaps,
			ok: !gaps.some((gap) => gap.severity === 'error'),
		};
	} finally {
		if (resolved.tempRoot) {
			fs.rmSync(resolved.tempRoot, { recursive: true, force: true });
		}
	}
}

function renderTable(headers, rows) {
	return [
		`| ${headers.join(' | ')} |`,
		`| ${headers.map(() => '---').join(' | ')} |`,
		...rows.map((row) => `| ${row.join(' | ')} |`),
	].join('\n');
}

function renderMarkdown(report) {
	const lines = [
		'# WP Gym Remote Archive Triage',
		'',
		`- **Cycle:** \`${report.archive.cycle_id}\``,
		`- **Input kind:** \`${report.archive.input_kind}\``,
		`- **Files:** ${report.archive.files}`,
		`- **Status:** ${report.ok ? 'ok' : 'needs attention'}`,
		'',
		'## Loop Health',
		'',
		renderTable(['Validation files', 'Passed', 'Failed', 'Reviewer reports', 'Reviewer failures'], [[
			String(report.validations.total),
			String(report.validations.passed),
			String(report.validations.failed),
			`${report.reviewers.reports}/${report.reviewers.total}`,
			String(report.reviewers.failed),
		]]),
		'',
		'## Candidate Patches',
		'',
		renderTable(['Patch files', 'Nonempty', 'Unique nonempty', 'Empty', 'Duplicate groups'], [[
			String(report.candidate_patches.total),
			String(report.candidate_patches.nonempty),
			String(report.candidate_patches.unique_nonempty),
			String(report.candidate_patches.empty),
			String(report.candidate_patches.duplicates.length),
		]]),
		'',
		'## Patch Areas',
		'',
		renderTable(['Area', 'Patches'], Object.entries(report.candidate_patches.by_area).map(([area, count]) => [area, String(count)])),
	];

	if (report.data_quality_gaps.length > 0) {
		lines.push('', '## Data Quality Gaps', '');
		lines.push(renderTable(['Severity', 'Code', 'Message'], report.data_quality_gaps.map((gap) => [gap.severity, gap.code, gap.message.replace(/\|/g, '\\|')])));
	}

	if (report.candidate_patches.duplicates.length > 0) {
		lines.push('', '## Duplicate Patch Groups', '');
		lines.push(renderTable(['SHA-256', 'Files'], report.candidate_patches.duplicates.map((group) => [group.sha256.slice(0, 12), group.files.join('<br>')])));
	}

	return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
	const args = { input: '', json: '', markdown: '', staleDays: 7, now: new Date() };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--input') {
			args.input = argv[++index];
		} else if (arg === '--json') {
			args.json = argv[++index];
		} else if (arg === '--markdown') {
			args.markdown = argv[++index];
		} else if (arg === '--stale-days') {
			args.staleDays = Number(argv[++index]);
		} else if (arg === '--now') {
			args.now = new Date(argv[++index]);
		} else if (arg === '--help' || arg === '-h') {
			args.help = true;
		} else if (!args.input) {
			args.input = arg;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	if (!Number.isFinite(args.staleDays) || args.staleDays < 0) {
		throw new Error('--stale-days must be a non-negative number');
	}
	if (Number.isNaN(args.now.getTime())) {
		throw new Error('--now must be an ISO date-time');
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || !args.input) {
		console.error('Usage: node scripts/triage-remote-archive.mjs --input <cycle-dir-or-tar> [--json <file>] [--markdown <file>] [--stale-days <days>]');
		process.exit(args.help ? 0 : 2);
	}
	const report = summarizeArchive(args.input, args);
	const json = `${JSON.stringify(report, null, 2)}\n`;
	const markdown = renderMarkdown(report);
	if (args.json) {
		writeFile(path.resolve(args.json), json);
	}
	if (args.markdown) {
		writeFile(path.resolve(args.markdown), markdown);
	}
	if (!args.json && !args.markdown) {
		console.log(json);
	}
	process.exit(report.ok ? 0 : 1);
}

export { summarizeArchive, renderMarkdown };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
