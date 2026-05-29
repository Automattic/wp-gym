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
	const replayDir = path.join(temp, 'replay');
	const replayFile = path.join(replayDir, 'wordpress-task-runner-flow-replay-bundle.json');
	const output = path.join(temp, 'wp-gym-run-registry');
	fs.mkdirSync(replayDir, { recursive: true });
	fs.writeFileSync(replayFile, `${JSON.stringify(homeboyWrapped, null, 2)}\n`);

	const emitted = JSON.parse(run('node', ['scripts/emit-run-registry.mjs', '--input', replayDir, '--output', output, '--require-entry']));
	assert(emitted.ok, 'Expected live replay bundle registry emission to pass.');
	assert(emitted.results.length === 1, `Expected one emitted registry row, got ${emitted.results.length}.`);
	assert(emitted.results.some((result) => result.source?.endsWith('wordpress-task-runner-flow-replay-bundle.json')), 'Expected emitted row to come from the replay bundle.');
	assert(fs.existsSync(path.join(output, 'entries')), 'Expected registry entries directory to be written.');

	const validated = JSON.parse(run('node', ['scripts/validate-run-registry.mjs', '--input', path.join(output, 'entries')]));
	assert(validated.ok, 'Expected emitted live registry entry to validate.');

	console.log(JSON.stringify({ ok: true, emitted: emitted.results.length, output }, null, 2));
} finally {
	fs.rmSync(temp, { recursive: true, force: true });
}
