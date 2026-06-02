import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { WPGym } from '../src/index.js';
import { validateLiveArtifact, unwrapEvalArtifact } from './validate-live-artifacts.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const replayCriticalStateKeys = ['wordpress_state', 'wp_state', 'state', 'state_json'];
const replayCriticalTraceKeys = ['replay_trace', 'trace', 'episode_trace', 'actions', 'action_trace'];
const replayableActionTypes = ['wp_cli', 'filesystem'];
const browserEditorActionTypes = ['browser', 'editor'];

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

function isZipFile(file) {
	return fs.existsSync(file) && fs.statSync(file).isFile() && path.extname(file).toLowerCase() === '.zip';
}

function extractZipArchive(file) {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-gym-replay-'));
	const result = spawnSync('unzip', ['-q', file, '-d', tempDir], {
		cwd: root,
		encoding: 'utf8',
	});

	if (result.error || result.status !== 0) {
		fs.rmSync(tempDir, { recursive: true, force: true });
		throw new Error(result.error?.message || result.stderr || result.stdout || `unzip exited with ${result.status}`);
	}

	return tempDir;
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

function normalizeArtifactReference(reference) {
	if (!reference || typeof reference !== 'object') {
		return reference;
	}
	return {
		...reference,
		path_or_url: reference.path_or_url || reference.path || null,
		sha256: reference.sha256 || (reference.digest?.algorithm === 'sha256' ? reference.digest.value : null),
	};
}

function collectArtifactReferences(artifact) {
	const references = [];
	for (const [sectionName, section] of [
		['runtime.references', artifact.runtime?.references || {}],
		['reports', artifact.reports || {}],
	]) {
		for (const [key, value] of Object.entries(section)) {
			for (const reference of normalizeReferenceList(value)) {
				references.push({ section: sectionName, key, reference: normalizeArtifactReference(reference) });
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
			|| (key === 'observations' && /wordpress-state/i.test(reference?.kind || ''))
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

function classifyRegrade(artifact, compatibilityGaps, comparison = null, graderRun = null, episodeReplay = null) {
	const errorCodes = compatibilityGaps
		.filter((item) => item.severity === 'error')
		.map((item) => item.code);
	const drift = Boolean(comparison && !comparison.ok);
	let failureClass = artifact?.status?.failure_class || (artifact?.grader?.success ? 'none' : 'task_failure');
	let outcome = artifact?.status?.outcome || (artifact?.grader?.success ? 'passed' : 'failed');
	let failureReason = artifact?.status?.failure_reason || null;

	if (errorCodes.includes('terminal_grader_failed') || graderRun?.ok === false) {
		failureClass = 'grader_failure';
		outcome = 'errored';
		failureReason = graderRun?.error || failureReason;
	} else if (errorCodes.includes('episode_replay_failed') || episodeReplay?.ok === false) {
		failureClass = 'runtime_failure';
		outcome = 'errored';
		failureReason = episodeReplay?.error || failureReason;
	} else if (drift || errorCodes.length) {
		failureClass = 'replay_incompatibility';
		outcome = 'errored';
		failureReason = drift ? 'Regraded output drifted from the sealed eval artifact.' : errorCodes[0];
	} else if (comparison?.actual) {
		failureClass = comparison.actual.success ? 'none' : 'task_failure';
		outcome = comparison.actual.success ? 'passed' : 'failed';
		failureReason = comparison.actual.failure_reasons?.[0] || null;
	}

	return {
		outcome,
		failure_class: failureClass,
		failure_reason: failureReason,
		grade_drift: drift,
		compatibility_error_codes: errorCodes,
	};
}

function summarizeResults(results) {
	const summary = {
		total: results.length,
		ok: results.filter((result) => result.ok).length,
		failed: results.filter((result) => !result.ok).length,
		failure_classes: {},
	};

	for (const result of results) {
		const failureClass = result.regrade_status?.failure_class || 'unknown';
		summary.failure_classes[failureClass] = (summary.failure_classes[failureClass] || 0) + 1;
	}

	return summary;
}

async function withMutedProcessOutput(callback) {
	const stdoutWrite = process.stdout.write;
	const stderrWrite = process.stderr.write;
	process.stdout.write = () => true;
	process.stderr.write = () => true;
	try {
		return await callback();
	} finally {
		process.stdout.write = stdoutWrite;
		process.stderr.write = stderrWrite;
	}
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

function actionReplayability(action) {
	if (replayableActionTypes.includes(action.type)) {
		return 'replayable';
	}

	if (action.type === 'browser') {
		if (action.replayability === 'replayable' && ['navigate', 'click', 'fill', 'press', 'capture'].includes(action.operation)) {
			return 'replayable';
		}
		return 'audit_only';
	}

	if (action.type === 'editor') {
		if (action.replayability === 'replayable' && ['open_post', 'inspect_state'].includes(action.operation)) {
			return 'replayable';
		}
		return 'audit_only';
	}

	return 'runtime_unsupported';
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
		const replay = await withMutedProcessOutput(async () => {
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
			return { reset, grade, replayedTrace };
		});

		return {
			ok: true,
			reset: replay.reset,
			trace: replay.replayedTrace,
			grade: replay.grade,
			step_comparison: compareStepObservations(trace, replay.replayedTrace),
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

		const replayability = actionReplayability(step.action);
		if (replayability !== 'replayable') {
			unsupportedActions.push({
				step_index: index,
				action_type: step.action.type,
				operation: step.action.operation || null,
				replayability,
				declared_replayability: step.action.replayability || null,
			});
			gaps.push(gap(
				browserEditorActionTypes.includes(step.action.type) ? 'browser_editor_action_audit_only' : 'non_replayable_action_type',
				'warning',
				`${traceReference.section}.${traceReference.key}.steps[${index}].action.type`,
				`Action ${step.action.type}${step.action.operation ? `.${step.action.operation}` : ''} is preserved in the trace and classified as ${replayability}; local regrade will audit the evidence and rerun the terminal grader instead of replaying this action.`
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

		if (step.action.type === 'browser') {
			const observation = step.result?.observation || {};
			if (observation.type !== 'browser_result' || observation.action_type !== 'browser' || observation.operation !== step.action.operation) {
				gaps.push(gap(
					'trace_action_result_mismatch',
					'error',
					`${traceReference.section}.${traceReference.key}.steps[${index}]`,
					'browser actions must be paired with a browser_result observation for the same operation.'
				));
			}
		}

		if (step.action.type === 'editor') {
			const observation = step.result?.observation || {};
			if (observation.type !== 'editor_result' || observation.action_type !== 'editor' || observation.operation !== step.action.operation) {
				gaps.push(gap(
					'trace_action_result_mismatch',
					'error',
					`${traceReference.section}.${traceReference.key}.steps[${index}]`,
					'editor actions must be paired with an editor_result observation for the same operation.'
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

function localPostFromCodeboxPost(post) {
	return {
		ID: post.ID ?? post.id ?? 0,
		post_type: post.post_type ?? post.type ?? 'post',
		post_status: post.post_status ?? post.status ?? 'publish',
		post_title: post.post_title ?? post.title ?? '',
		post_content: post.post_content ?? post.content ?? '',
	};
}

function projectTerminalGraderState(stateReference) {
	const state = readJson(stateReference.resolved);
	if (Array.isArray(state.posts) && state.posts.some((post) => post?.post_content !== undefined || post?.post_title !== undefined)) {
		return { file: stateReference.resolved, cleanup: null };
	}

	let posts = null;
	if (state.schema === 'wp-codebox/wordpress-state-section/v1' && state.section === 'posts' && Array.isArray(state.data)) {
		posts = state.data;
	} else if (state.schema === 'wp-codebox/wordpress-state-export/v1' && Array.isArray(state.sections?.posts)) {
		posts = state.sections.posts;
	} else if (Array.isArray(state.posts)) {
		posts = state.posts;
	}

	if (!posts) {
		return { file: stateReference.resolved, cleanup: null };
	}

	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-gym-codebox-state-'));
	const projected = path.join(tempDir, 'terminal-grader-state.json');
	fs.writeFileSync(projected, `${JSON.stringify({ posts: posts.map(localPostFromCodeboxPost) }, null, 2)}\n`);
	return { file: projected, cleanup: tempDir };
}

export async function replayRegradeArtifactFile(file, options = {}) {
	const value = readJson(file);
	const baseDir = path.dirname(file);
	const artifact = unwrapEvalArtifact(value);
	const validation = validateLiveArtifact(value, { benchmarkMode: options.benchmarkMode, baseDir });
	const compatibilityGaps = [...validation.compatibility_gaps];

	if (!artifact) {
		return { file, ok: false, validation, compatibility_gaps: compatibilityGaps, regrade_status: classifyRegrade(null, compatibilityGaps), replay: null };
	}

	const scenarioInfo = findScenario(artifact.scenario?.id);
	if (!scenarioInfo) {
		compatibilityGaps.push(gap(
			'missing_scenario_manifest',
			'error',
			'scenario.id',
			`No local scenario manifest found for ${artifact.scenario?.id || '(missing scenario id)'}.`
		));
		return { file, ok: false, validation, compatibility_gaps: compatibilityGaps, regrade_status: classifyRegrade(artifact, compatibilityGaps), replay: null };
	}

	const stateReference = findLocalStateReference(artifact, baseDir);
	if (!stateReference) {
		compatibilityGaps.push(gap(
			'missing_wordpress_state_evidence',
			'error',
			'runtime.references.wordpress_state',
			'Replay/regrade requires a local WordPress state JSON reference to rerun the terminal grader.'
		));
		return { file, ok: false, validation, compatibility_gaps: compatibilityGaps, regrade_status: classifyRegrade(artifact, compatibilityGaps), replay: null };
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

	const terminalState = projectTerminalGraderState(stateReference);
	const graderRun = runTerminalGrader(scenarioInfo, terminalState.file, options);
	if (terminalState.cleanup) {
		fs.rmSync(terminalState.cleanup, { recursive: true, force: true });
	}
	if (!graderRun.ok) {
		compatibilityGaps.push(gap('terminal_grader_failed', 'error', 'grader', graderRun.error));
		return { file, ok: false, validation, compatibility_gaps: compatibilityGaps, regrade_status: classifyRegrade(artifact, compatibilityGaps, null, graderRun, episodeReplay), replay: null };
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

	const ok = validation.ok && comparison.ok && traceAudit?.ok !== false && !compatibilityGaps.some((item) => item.severity === 'error');

	return {
		file,
		ok,
		validation,
		compatibility_gaps: compatibilityGaps,
		regrade_status: classifyRegrade(artifact, compatibilityGaps, comparison, graderRun, episodeReplay),
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

export async function replayRegradeInput(input, options = {}) {
	const inputPath = path.resolve(input);
	let searchRoot = inputPath;
	let extractedFrom = null;
	try {
		if (isZipFile(inputPath)) {
			searchRoot = extractZipArchive(inputPath);
			extractedFrom = inputPath;
		}

		const files = collectJsonFiles(searchRoot);
		const inputIsDirectory = fs.statSync(searchRoot).isDirectory();
		const artifactFiles = inputIsDirectory
			? files.filter((file) => unwrapEvalArtifact(readJson(file)))
			: files;

		if (!artifactFiles.length) {
			return {
				ok: false,
				benchmark_mode: Boolean(options.benchmarkMode),
				regrade: Boolean(options.regrade),
				input,
				extracted_from: extractedFrom,
				summary: summarizeResults([]),
				results: [],
				compatibility_gaps: [gap(
					'missing_eval_artifact',
					'error',
					'input',
					'No eval artifact projection found in the provided input.'
				)],
			};
		}

		const results = await Promise.all(artifactFiles.map((file) => replayRegradeArtifactFile(file, { benchmarkMode: options.benchmarkMode })));
		return {
			ok: results.every((result) => result.ok),
			benchmark_mode: Boolean(options.benchmarkMode),
			regrade: Boolean(options.regrade),
			input,
			extracted_from: extractedFrom,
			summary: summarizeResults(results),
			results,
		};
	} finally {
		if (extractedFrom) {
			fs.rmSync(searchRoot, { recursive: true, force: true });
		}
	}
}

function parseArgs(argv) {
	const args = { input: '', benchmarkMode: /^(1|true|yes)$/i.test(process.env.BENCHMARK_MODE || ''), regrade: false };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--input') {
			args.input = argv[++i];
		} else if (arg === '--regrade') {
			args.regrade = true;
			args.benchmarkMode = true;
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
		console.error('Usage: node scripts/replay-regrade.mjs --input <eval-artifact-json-dir-or-zip> [--regrade] [--benchmark-mode]');
		process.exit(args.help ? 0 : 2);
	}

	const inputPath = path.resolve(args.input);
	let exitCode = 0;
	const result = await replayRegradeInput(inputPath, { benchmarkMode: args.benchmarkMode, regrade: args.regrade });
	console.log(JSON.stringify(result, null, 2));
	if (!result.ok) {
		exitCode = 1;
	}
	process.exit(exitCode);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
