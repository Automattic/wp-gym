import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function run(command, args) {
	const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
	}
	return result.stdout;
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-gym-run-registry-emitter-'));

try {
	const homeboyWrapped = readJson(path.join(root, 'fixtures/eval-artifacts/homeboy-wrapped-row.json'));
	const directEvalArtifact = readJson(path.join(root, 'fixtures/eval-artifacts/direct-wp-gym-row.json'));
	const replayDir = path.join(temp, 'replay');
	const replayFile = path.join(replayDir, 'wordpress-task-runner-flow-replay-bundle.json');
	const repeatedDir = path.join(temp, 'repeated');
	const output = path.join(temp, 'wp-gym-run-registry');
	const repeatedOutput = path.join(temp, 'wp-gym-repeated-run-registry');
	fs.mkdirSync(replayDir, { recursive: true });
	fs.mkdirSync(repeatedDir, { recursive: true });
	fs.writeFileSync(replayFile, `${JSON.stringify(homeboyWrapped, null, 2)}\n`);

	const emitted = JSON.parse(run('node', ['scripts/emit-run-registry.mjs', '--input', replayDir, '--output', output, '--require-entry']));
	assert(emitted.ok, 'Expected live replay bundle registry emission to pass.');
	assert(emitted.results.length === 1, `Expected one emitted registry row, got ${emitted.results.length}.`);
	assert(emitted.results.some((result) => result.source?.endsWith('wordpress-task-runner-flow-replay-bundle.json')), 'Expected emitted row to come from the replay bundle.');
	assert(fs.existsSync(path.join(output, 'entries')), 'Expected registry entries directory to be written.');

	const validated = JSON.parse(run('node', ['scripts/validate-run-registry.mjs', '--input', path.join(output, 'entries')]));
	assert(validated.ok, 'Expected emitted live registry entry to validate.');
	const emittedEntryPath = path.join(output, emitted.results[0].entry.replace(/^.*entries\//, 'entries/'));
	const emittedEntry = readJson(emittedEntryPath);
	assert(emittedEntry.operations?.retry?.policy === 'wp-gym-large-run-v1', 'Expected emitted rows to carry retry policy metadata.');

	for (const attemptIndex of [1, 2]) {
		const attemptId = `benchmark-readiness-pilot-block-markup-valid-semantic-blocks-openai-gpt-5-5-fixture-attempt-${attemptIndex}`;
		const repeatedArtifact = structuredClone(directEvalArtifact);
		repeatedArtifact.reports = {
			template_values: {
				attempt_id: attemptId,
				attempt_index: attemptIndex,
				attempt_count: 2,
				result_set_id: 'benchmark-readiness-pilot-block-markup-valid-semantic-blocks-openai-gpt-5-5-fixture',
				seed: `fixture:block-markup-valid-semantic-blocks:openai-gpt-5-5:${attemptIndex}`,
				temperature: 'provider_default',
			},
		};
		fs.writeFileSync(path.join(repeatedDir, `${attemptId}.json`), `${JSON.stringify(repeatedArtifact, null, 2)}\n`);
	}

	const repeated = JSON.parse(run('node', ['scripts/emit-run-registry.mjs', '--input', repeatedDir, '--output', repeatedOutput, '--require-entry']));
	assert(repeated.ok, 'Expected repeated-attempt registry emission to pass.');
	assert(repeated.results.length === 2, `Expected two repeated-attempt registry rows, got ${repeated.results.length}.`);
	const repeatedEntries = fs.readdirSync(path.join(repeatedOutput, 'entries')).filter((file) => file.endsWith('.json')).sort();
	assert(repeatedEntries.length === 2, `Expected two repeated-attempt entry files, got ${repeatedEntries.length}.`);
	assert(repeatedEntries.every((file) => file.includes('-attempt-')), 'Expected repeated-attempt entry filenames to include the stable attempt ID.');
	const repeatedValidated = JSON.parse(run('node', ['scripts/validate-run-registry.mjs', '--input', path.join(repeatedOutput, 'entries')]));
	assert(repeatedValidated.ok, 'Expected emitted repeated-attempt registry entries to validate.');
	const repeatedReport = JSON.parse(run('node', ['scripts/aggregate-run-registry.mjs', '--registry', path.join(repeatedOutput, 'entries'), '--scope', 'all']));
	assert(repeatedReport.overall.operations.estimated_cost_usd === 0.085, `Expected repeated report cost total 0.085, got ${repeatedReport.overall.operations.estimated_cost_usd}.`);
	assert(repeatedReport.overall.operations.total_tokens === 27600, `Expected repeated report token total 27600, got ${repeatedReport.overall.operations.total_tokens}.`);
	assert(repeatedReport.by_task_family_model_tier['block-markup:frontier_model'].operations.runs_per_wall_hour === 60, 'Expected task-family/model-tier throughput to be reported.');

	const providerFailureArtifact = structuredClone(directEvalArtifact);
	providerFailureArtifact.status = {
		outcome: 'errored',
		failure_class: 'provider_failure',
		failure_reason: 'rate_limited',
		message: 'Provider returned a retryable rate limit.',
	};
	providerFailureArtifact.grader.success = false;
	providerFailureArtifact.grader.reward = 0;
	providerFailureArtifact.operations.retry = {
		policy: 'wp-gym-large-run-v1',
		retry_count: 1,
		max_attempts: 3,
		disposition: 'retryable',
	};
	const providerFailureInput = path.join(temp, 'provider-failure.json');
	const providerFailureOutput = path.join(temp, 'wp-gym-provider-failure-registry');
	fs.writeFileSync(providerFailureInput, `${JSON.stringify(providerFailureArtifact, null, 2)}\n`);
	const providerFailure = JSON.parse(run('node', ['scripts/emit-run-registry.mjs', '--input', providerFailureInput, '--output', providerFailureOutput, '--require-entry']));
	assert(providerFailure.ok, 'Expected provider failure registry emission to pass.');
	const providerFailureEntries = fs.readdirSync(path.join(providerFailureOutput, 'entries')).filter((file) => file.endsWith('.json'));
	const providerFailureEntry = readJson(path.join(providerFailureOutput, 'entries', providerFailureEntries[0]));
	assert(providerFailureEntry.grade_identity.failure_class === 'provider_failure', 'Expected provider failures to stay distinct from task failures.');
	assert(providerFailureEntry.operations.retry.disposition === 'retryable', 'Expected provider failures to expose retry disposition.');

	console.log(JSON.stringify({ ok: true, emitted: emitted.results.length, repeated_emitted: repeated.results.length, provider_failure_emitted: providerFailure.results.length, output }, null, 2));
} finally {
	fs.rmSync(temp, { recursive: true, force: true });
}
