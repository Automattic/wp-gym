import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const root = process.cwd();
const schemaNames = [
	'action.schema.json',
	'observation.schema.json',
	'step-result.schema.json',
	'trace.schema.json',
];

const ajv = new Ajv2020({ allErrors: true, strict: false });

for (const schemaName of schemaNames) {
	const schema = JSON.parse(await readFile(path.join(root, 'schemas', schemaName), 'utf8'));
	ajv.addSchema(schema, schemaName);
}

const action = {
	type: 'wp_cli',
	command: 'post list --post_type=page --format=json',
	timeout_ms: 30000,
};
const observation = {
	type: 'command_result',
	command: action.command,
	status: 0,
	stdout: '[]',
	stderr: '',
	error: null,
	wp_state: { posts: [] },
};
const stepResult = {
	action,
	observation,
	reward: null,
	done: false,
	info: { scenario_id: 'schema-smoke' },
};
const trace = [
	{
		timestamp: '2026-05-15T00:00:00.000Z',
		...stepResult,
	},
];

const samples = [
	['action.schema.json', action],
	['observation.schema.json', observation],
	['step-result.schema.json', stepResult],
	['trace.schema.json', trace],
];

for (const [schemaName, sample] of samples) {
	const validate = ajv.getSchema(schemaName);

	if (!validate(sample)) {
		throw new Error(`${schemaName} sample failed: ${ajv.errorsText(validate.errors)}`);
	}
}

console.log(`Validated ${schemaNames.length} episode schema(s).`);
