import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { WPGym } from '../src/index.js';
import { validateLiveArtifact, unwrapEvalArtifact } from './validate-live-artifacts.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const replayCriticalStateKeys = ['wordpress_state', 'wp_state', 'state', 'state_json'];
const replayCriticalTraceKeys = ['replay_trace', 'trace', 'episode_trace', 'actions', 'action_trace'];
const replayableActionTypes = ['wp_cli', 'filesystem'];

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

function sha256File(file) {
	return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
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

function findLocalTraceReference(artifact, baseDir) {
	const references = collectArtifactReferences(artifact);
	const candidates = references.filter(({ key, reference }) => {
		const target = reference?.path_or_url || '';
		return replayCriticalTraceKeys.includes(key)
			|| /(?:^|[-_/])(episode-)?(?:replay-)?trace(?:[-_.]|$)/i.test(target)
			|| /(?:^|[-_/])actions(?:[-_.]|$)/i.test(target)
			|| /replay_trace|episode_trace/i.test(reference?.source_field || '');
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

function validateReferenceHash(referenceInfo) {
	const declared = referenceInfo.reference?.sha256 || null;
	const computed = sha256File(referenceInfo.resolved);
	if (declared && declared !== computed) {
		return gap(
			'artifact_hash_mismatch',
			'error',
			`${referenceInfo.section}.${referenceInfo.key}`,
			`${referenceInfo.reference.path_or_url} sha256 does not match file contents.`
		);
	}
	if (!declared) {
		return gap(
			'missing_artifact_hash',
			'error',
			`${referenceInfo.section}.${referenceInfo.key}`,
			`${referenceInfo.reference.path_or_url} is local and hashable but does not declare sha256.`
		);
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

function normalizeObservation(observation) {
	if (!observation || typeof observation !== 'object') {
		return null;
	}

	if (observation.type === 'command_result') {
		return {
			type: observation.type,
			action_type: observation.action_type,
			command: observation.command,
			status: observation.status,
			stdout: observation.stdout,
			stderr: observation.stderr,
			timed_out: Boolean(observation.timed_out),
			error: observation.error ?? null,
		};
	}

	if (observation.type === 'files') {
		return {
			type: observation.type,
			files: (Array.isArray(observation.files) ? observation.files : [])
				.map((file) => ({
					path: file.path,
					sha256: file.sha256 ?? null,
					content: file.content ?? null,
				}))
				.sort((a, b) => String(a.path).localeCompare(String(b.path))),
		};
	}

	return observation;
}

function compareStepObservations(expectedTrace, actualTrace) {
	const mismatches = [];
	const actualSteps = actualTrace?.steps || [];

	for (const [index, expectedStep] of expectedTrace.steps.entries()) {
		const actualStep = actualSteps[index];
		if (!actualStep) {
			mismatches.push({ field: `steps[${index}]`, expected: 'present', actual: 'missing' });
			continue;
		}

		compareValues(`steps[${index}].action`, expectedStep.action, actualStep.action, mismatches);
		compareValues(
			`steps[${index}].observation`,
			normalizeObservation(expectedStep.result?.observation),
			normalizeObservation(actualStep.result?.observation),
			mismatches
		);
	}

	if (actualSteps.length !== expectedTrace.steps.length) {
		mismatches.push({ field: 'steps.length', expected: expectedTrace.steps.length, actual: actualSteps.length });
	}

	return { ok: mismatches.length === 0, mismatches };
}

async function replayTraceActions(trace, options = {}) {
	let env = null;

	try {
		env = await WPGym.make(trace.scenario_id, {
			root,
			gradeTimeoutMs: options.timeoutMs,
		});
		const reset = await env.reset({ seed: trace.metadata?.reset_seed ?? null });
		for (const step of trace.steps) {
			await env.step(step.action);
		}
		const grade = await env.grade();
		const replayedTrace = await env.trace();

		return {
			ok: true,
			reset,
			trace: replayedTrace,
			grade,
			step_comparison: compareStepObservations(trace, replayedTrace),
		};
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		await env?.close();
	}
}

function createTraceValidator() {
	const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
	for (const file of [
		'schemas/action.v1.schema.json',
		'schemas/observation.v1.schema.json',
		'schemas/step-result.v1.schema.json',
		'schemas/trace.v1.schema.json',
	]) {
		ajv.addSchema(readJson(path.join(root, file)));
	}
	return ajv.getSchema('https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/trace.v1.schema.json');
}

function formatAjvErrors(errors = []) {
	return errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
}

function auditReplayTrace(artifact, traceReference) {
	const trace = readJson(traceReference.resolved);
	const traceSchema = createTraceValidator();
	const gaps = [];
	const unsupportedActions = [];

	if (!traceSchema(trace)) {
		gaps.push(gap(
			'trace_schema_mismatch',
			'error',
			`${traceReference.section}.${traceReference.key}`,
			`Replay trace does not match trace.v1 schema: ${formatAjvErrors(traceSchema.errors)}`
		));
		return { ok: false, trace, gaps, unsupported_actions: unsupportedActions };
	}

	if (trace.scenario_id !== artifact.scenario?.id) {
		gaps.push(gap(
			'trace_scenario_mismatch',
			'error',
			`${traceReference.section}.${traceReference.key}.scenario_id`,
			`Replay trace scenario_id ${trace.scenario_id} does not match artifact scenario ${artifact.scenario?.id || '(missing)'}.`
		));
	}

	if (!trace.steps.length) {
		gaps.push(gap(
			'missing_replay_actions',
			'error',
			`${traceReference.section}.${traceReference.key}.steps`,
			'Replay trace must include at least one canonical action/result step.'
		));
	}

	for (const [index, step] of trace.steps.entries()) {
		if (step.step_index !== index) {
			gaps.push(gap(
				'trace_step_order_mismatch',
				'error',
				`${traceReference.section}.${traceReference.key}.steps[${index}].step_index`,
				`Replay trace step_index ${step.step_index} should equal ordered position ${index}.`
			));
		}

		if (!trace.metadata.allowed_action_types.includes(step.action.type)) {
			gaps.push(gap(
				'trace_action_not_allowed',
				'error',
				`${traceReference.section}.${traceReference.key}.steps[${index}].action.type`,
				`Action type ${step.action.type} is not listed in trace metadata.allowed_action_types.`
			));
		}

		if (!replayableActionTypes.includes(step.action.type)) {
			unsupportedActions.push({ step_index: index, action_type: step.action.type });
			gaps.push(gap(
				'non_replayable_action_type',
				'warning',
				`${traceReference.section}.${traceReference.key}.steps[${index}].action.type`,
				`Action type ${step.action.type} is preserved in the trace but is not replayed by this local regrade harness yet.`
			));
		}

		if (step.action.type === 'wp_cli') {
			const observation = step.result?.observation || {};
			if (observation.type !== 'command_result' || observation.action_type !== 'wp_cli' || observation.command !== step.action.command) {
				gaps.push(gap(
					'trace_action_result_mismatch',
					'error',
					`${traceReference.section}.${traceReference.key}.steps[${index}]`,
					'wp_cli actions must be paired with a command_result observation for the same command.'
				));
			}
		}
	}

	return {
		ok: !gaps.some((item) => item.severity === 'error'),
		trace,
		gaps,
		unsupported_actions: unsupportedActions,
	};
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

export async function replayRegradeArtifactFile(file, options = {}) {
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

	const traceReference = findLocalTraceReference(artifact, baseDir);
	let traceAudit = null;
	let episodeReplay = null;
	let replayGrade = null;
	if (!traceReference) {
		compatibilityGaps.push(gap(
			'missing_replay_trace_evidence',
			'error',
			'runtime.references.replay_trace or reports.replay',
			'Replay/regrade requires a local canonical episode trace with ordered actions and observations.'
		));
	} else {
		const hashGap = validateReferenceHash(traceReference);
		if (hashGap) {
			compatibilityGaps.push(hashGap);
		}
		traceAudit = auditReplayTrace(artifact, traceReference);
		compatibilityGaps.push(...traceAudit.gaps);

		if (traceAudit.ok && traceAudit.unsupported_actions.length === 0) {
			episodeReplay = await replayTraceActions(traceAudit.trace, options);
			if (!episodeReplay.ok) {
				compatibilityGaps.push(gap(
					'episode_replay_failed',
					'error',
					`${traceReference.section}.${traceReference.key}`,
					`Full episode replay failed: ${episodeReplay.error}`
				));
			} else {
				replayGrade = episodeReplay.grade;
				if (!episodeReplay.step_comparison.ok) {
					compatibilityGaps.push(gap(
						'episode_replay_step_mismatch',
						'error',
						`${traceReference.section}.${traceReference.key}.steps`,
						'Replayed episode actions did not reproduce the sealed step observations.'
					));
				}
			}
		}
	}

	const graderRun = runTerminalGrader(scenarioInfo, stateReference.resolved, options);
	if (!graderRun.ok) {
		compatibilityGaps.push(gap('terminal_grader_failed', 'error', 'grader', graderRun.error));
		return { file, ok: false, validation, compatibility_gaps: compatibilityGaps, replay: null };
	}

	const comparison = compareGrades(artifact.grader, replayGrade || graderRun.grade);
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
		ok: validation.ok && comparison.ok && traceAudit?.ok !== false && !compatibilityGaps.some((item) => item.severity === 'error'),
		validation,
		compatibility_gaps: compatibilityGaps,
		replay: {
			phase: replayGrade ? 'full_episode_replay_regrade' : 'trace_audit_plus_state_regrade',
			scenario_file: repoRelative(scenarioInfo.file),
			grader_file: repoRelative(path.resolve(path.dirname(scenarioInfo.file), scenarioInfo.scenario.grader_file)),
			trace_reference: traceReference ? {
				field: `${traceReference.section}.${traceReference.key}`,
				path_or_url: traceReference.reference.path_or_url,
				step_count: traceAudit?.trace?.steps?.length || 0,
				unsupported_actions: traceAudit?.unsupported_actions || [],
			} : null,
			state_reference: {
				field: `${stateReference.section}.${stateReference.key}`,
				path_or_url: stateReference.reference.path_or_url,
			},
			episode_replay: episodeReplay ? {
				ok: episodeReplay.ok,
				step_count: episodeReplay.trace?.steps?.length || 0,
				step_comparison: episodeReplay.step_comparison || null,
				error: episodeReplay.error || null,
			} : null,
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

	const results = await Promise.all(artifactFiles.map((file) => replayRegradeArtifactFile(file, { benchmarkMode: args.benchmarkMode })));
	const ok = results.every((result) => result.ok);

	console.log(JSON.stringify({ ok, benchmark_mode: args.benchmarkMode, results }, null, 2));
	if (!ok) {
		process.exit(1);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
