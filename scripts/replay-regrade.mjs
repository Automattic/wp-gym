import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateLiveArtifact, unwrapEvalArtifact } from './validate-live-artifacts.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const replayCriticalStateKeys = ['wordpress_state', 'wp_state', 'state', 'state_json'];

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function collectJsonFiles(input) {
	const resolved = path.resolve(input);
	const stats = fs.statSync(resolved);

	if (stats.isFile()) {
		return [resolved];
	}
	if (!stats.isDirectory()) {
		throw new Error(`${input} is not a file or directory.`);
	}

	const files = [];
	for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
		const entryPath = path.join(resolved, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectJsonFiles(entryPath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(entryPath);
		}
	}

	return files.sort();
}

function repoRelative(file) {
	return path.relative(root, file).replace(/\\/g, '/');
}

function isRemoteReference(target) {
	return /^https?:\/\//i.test(target || '');
}

function gap(code, severity, field, message) {
	return { code, severity, field, message };
}

function normalizeReferenceList(refs) {
	return Array.isArray(refs) ? refs : [];
}

function collectArtifactReferences(artifact) {
	const references = [];
	for (const [sectionName, section] of [
		['runtime.references', artifact.runtime?.references || {}],
		['reports', artifact.reports || {}],
	]) {
		for (const [key, value] of Object.entries(section)) {
			for (const reference of normalizeReferenceList(value)) {
				references.push({ section: sectionName, key, reference });
			}
		}
	}
	return references;
}

function findLocalStateReference(artifact, baseDir) {
	const references = collectArtifactReferences(artifact);
	const candidates = references.filter(({ key, reference }) => {
		const target = reference?.path_or_url || '';
		return replayCriticalStateKeys.includes(key)
			|| /(?:^|[-_/])(wordpress-)?state(?:[-_.]|$)/i.test(target)
			|| /wordpress_state/i.test(reference?.source_field || '');
	});

	for (const candidate of candidates) {
		const target = candidate.reference?.path_or_url || '';
		if (!target || isRemoteReference(target)) {
			continue;
		}

		const resolved = path.resolve(baseDir, target);
		if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
			return { ...candidate, resolved };
		}
	}

	return null;
}

function findScenario(scenarioId) {
	const scenarioFiles = collectJsonFiles(path.join(root, 'scenarios'));
	for (const file of scenarioFiles) {
		const scenario = readJson(file);
		if (scenario.id === scenarioId) {
			return { file, scenario };
		}
	}
	return null;
}

function normalizeCheck(check) {
	return {
		id: check?.id ?? null,
		passed: Boolean(check?.passed),
		score: check?.score === undefined || check?.score === null ? null : Number(check.score),
		max_score: check?.max_score === undefined || check?.max_score === null ? null : Number(check.max_score),
		failure_reason: check?.failure_reason ?? null,
		message: check?.message ?? null,
		evidence: check?.evidence ?? check?.evidence_refs ?? null,
	};
}

function normalizeGrade(grade) {
	const nestedGrade = grade?.grade || {};
	return {
		success: Boolean(grade?.success),
		reward: Number(grade?.reward ?? 0),
		score: nestedGrade.score === undefined || nestedGrade.score === null ? null : Number(nestedGrade.score),
		max_score: nestedGrade.max_score === undefined || nestedGrade.max_score === null ? null : Number(nestedGrade.max_score),
		failure_reasons: Array.isArray(grade?.failure_reasons) ? [...grade.failure_reasons].sort() : [],
		checks: (Array.isArray(grade?.checks) ? grade.checks : nestedGrade.checks || []).map(normalizeCheck),
	};
}

function compareValues(field, expected, actual, mismatches) {
	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		mismatches.push({ field, expected, actual });
	}
}

function compareGrades(expectedGrade, actualGrade) {
	const expected = normalizeGrade(expectedGrade);
	const actual = normalizeGrade(actualGrade);
	const mismatches = [];

	for (const field of ['success', 'reward', 'score', 'max_score', 'failure_reasons', 'checks']) {
		compareValues(field, expected[field], actual[field], mismatches);
	}

	return { ok: mismatches.length === 0, expected, actual, mismatches };
}

function runTerminalGrader(scenarioInfo, stateFile, options = {}) {
	const graderFile = path.resolve(path.dirname(scenarioInfo.file), scenarioInfo.scenario.grader_file);
	if (!fs.existsSync(graderFile)) {
		return { ok: false, error: `Scenario grader file does not exist: ${repoRelative(graderFile)}` };
	}

	const result = spawnSync('php', [
		path.join(root, 'scripts/run-local-wordpress-state-grade.php'),
		graderFile,
		stateFile,
	], {
		cwd: root,
		encoding: 'utf8',
		timeout: options.timeoutMs || 30000,
	});

	if (result.error) {
		return { ok: false, error: result.error.message };
	}
	if (result.status !== 0) {
		return { ok: false, error: result.stderr || result.stdout || `php exited with ${result.status}` };
	}

	try {
		return { ok: true, grade: JSON.parse(result.stdout) };
	} catch (error) {
		return { ok: false, error: `Terminal grader returned non-JSON output: ${error.message}` };
	}
}

export function replayRegradeArtifactFile(file, options = {}) {
	const value = readJson(file);
	const baseDir = path.dirname(file);
	const artifact = unwrapEvalArtifact(value);
	const validation = validateLiveArtifact(value, { benchmarkMode: options.benchmarkMode, baseDir });
	const compatibilityGaps = [...validation.compatibility_gaps];

	if (!artifact) {
		return { file, ok: false, validation, compatibility_gaps: compatibilityGaps, replay: null };
	}

	const scenarioInfo = findScenario(artifact.scenario?.id);
	if (!scenarioInfo) {
		compatibilityGaps.push(gap(
			'missing_scenario_manifest',
			'error',
			'scenario.id',
			`No local scenario manifest found for ${artifact.scenario?.id || '(missing scenario id)'}.`
		));
		return { file, ok: false, validation, compatibility_gaps: compatibilityGaps, replay: null };
	}

	const stateReference = findLocalStateReference(artifact, baseDir);
	if (!stateReference) {
		compatibilityGaps.push(gap(
			'missing_wordpress_state_evidence',
			'error',
			'runtime.references.wordpress_state',
			'Replay/regrade requires a local WordPress state JSON reference to rerun the terminal grader.'
		));
		return { file, ok: false, validation, compatibility_gaps: compatibilityGaps, replay: null };
	}

	const graderRun = runTerminalGrader(scenarioInfo, stateReference.resolved, options);
	if (!graderRun.ok) {
		compatibilityGaps.push(gap('terminal_grader_failed', 'error', 'grader', graderRun.error));
		return { file, ok: false, validation, compatibility_gaps: compatibilityGaps, replay: null };
	}

	const comparison = compareGrades(artifact.grader, graderRun.grade);
	if (!comparison.ok) {
		compatibilityGaps.push(gap(
			'grade_mismatch',
			'error',
			'grader',
			'Replayed terminal grader output does not match the sealed eval artifact grade.'
		));
	}

	return {
		file,
		ok: validation.ok && comparison.ok && !compatibilityGaps.some((item) => item.severity === 'error'),
		validation,
		compatibility_gaps: compatibilityGaps,
		replay: {
			scenario_file: repoRelative(scenarioInfo.file),
			grader_file: repoRelative(path.resolve(path.dirname(scenarioInfo.file), scenarioInfo.scenario.grader_file)),
			state_reference: {
				field: `${stateReference.section}.${stateReference.key}`,
				path_or_url: stateReference.reference.path_or_url,
			},
			comparison,
		},
	};
}

function parseArgs(argv) {
	const args = { input: '', benchmarkMode: /^(1|true|yes)$/i.test(process.env.BENCHMARK_MODE || '') };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--input') {
			args.input = argv[++i];
		} else if (arg === '--benchmark-mode') {
			args.benchmarkMode = true;
		} else if (arg === '--help' || arg === '-h') {
			args.help = true;
		} else if (!args.input) {
			args.input = arg;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || !args.input) {
		console.error('Usage: node scripts/replay-regrade.mjs --input <eval-artifact-json-or-dir> [--benchmark-mode]');
		process.exit(args.help ? 0 : 2);
	}

	const files = collectJsonFiles(args.input);
	const inputIsDirectory = fs.statSync(path.resolve(args.input)).isDirectory();
	const artifactFiles = inputIsDirectory
		? files.filter((file) => unwrapEvalArtifact(readJson(file)))
		: files;

	if (!artifactFiles.length) {
		console.log(JSON.stringify({
			ok: false,
			benchmark_mode: args.benchmarkMode,
			results: [],
			compatibility_gaps: [gap(
				'missing_eval_artifact',
				'error',
				'input',
				'No eval artifact projection found in the provided input.'
			)],
		}, null, 2));
		process.exit(1);
	}

	const results = artifactFiles.map((file) => replayRegradeArtifactFile(file, { benchmarkMode: args.benchmarkMode }));
	const ok = results.every((result) => result.ok);

	console.log(JSON.stringify({ ok, benchmark_mode: args.benchmarkMode, results }, null, 2));
	if (!ok) {
		process.exit(1);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
