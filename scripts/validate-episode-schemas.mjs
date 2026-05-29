import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const root = process.cwd();
const schemaFiles = [
	'schemas/action.v1.schema.json',
	'schemas/observation.v1.schema.json',
	'schemas/step-result.v1.schema.json',
	'schemas/trace.v1.schema.json',
];

const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const schemas = [];

for (const file of schemaFiles) {
	const schema = JSON.parse(await readFile(path.join(root, file), 'utf8'));
	schemas.push({ file, schema });
	ajv.addSchema(schema);
}

for (const { schema } of schemas) {
	ajv.compile(schema);
}

function assertValid(schemaId, value, label) {
	const validate = ajv.getSchema(schemaId);
	if (!validate) {
		throw new Error(`Missing compiled schema: ${schemaId}`);
	}

	if (!validate(value)) {
		throw new Error(`${label} should be valid: ${formatErrors(validate.errors)}`);
	}
}

function assertInvalid(schemaId, value, label) {
	const validate = ajv.getSchema(schemaId);
	if (!validate) {
		throw new Error(`Missing compiled schema: ${schemaId}`);
	}

	if (validate(value)) {
		throw new Error(`${label} should be invalid`);
	}
}

function formatErrors(errors = []) {
	return errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
}

const actionSchemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/action.v1.schema.json';
const observationSchemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/observation.v1.schema.json';
const stepResultSchemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/step-result.v1.schema.json';
const traceSchemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/trace.v1.schema.json';

const wpCliAction = {
	schema_version: 1,
	type: 'wp_cli',
	command: 'post list --post_type=page --format=json',
	timeout_ms: 30000,
};

const filesystemAction = {
	schema_version: 1,
	type: 'filesystem',
	operation: 'write',
	path: 'plugins/example/example.php',
	content: '<?php\n',
};

const restAction = {
	schema_version: 1,
	type: 'rest',
	method: 'GET',
	path: '/wp-json/wp/v2/posts',
	timeout_ms: 30000,
};

const browserAction = {
	schema_version: 1,
	type: 'browser',
	operation: 'capture',
	replayability: 'evidence_only',
	url: '/',
	capture: ['html', 'screenshot'],
};

const commandObservation = {
	schema_version: 1,
	type: 'command_result',
	action_type: 'wp_cli',
	command: 'post list --post_type=page --format=json',
	status: 0,
	stdout: '[]',
	stderr: '',
	timeout_ms: 30000,
	timed_out: false,
	duration_ms: 84,
	error: null,
};

const filesObservation = {
	schema_version: 1,
	type: 'files',
	action_type: 'filesystem',
	operation: 'write',
	files: [
		{
			path: 'plugins/example/example.php',
			kind: 'file',
			sha256: '0'.repeat(64),
		},
	],
};

const restObservation = {
	schema_version: 1,
	type: 'rest_response',
	action_type: 'rest',
	method: 'GET',
	path: '/wp-json/wp/v2/posts',
	status: 200,
	headers: { 'content-type': 'application/json' },
	body: [],
	timed_out: false,
	duration_ms: 42,
	error: null,
};

const browserObservation = {
	schema_version: 1,
	type: 'browser_result',
	action_type: 'browser',
	operation: 'capture',
	replayability: 'evidence_only',
	url: '/',
	artifacts: [
		{
			path: 'files/browser/screenshot.png',
			sha256: '1'.repeat(64),
			mime_type: 'image/png',
		},
	],
	duration_ms: 100,
	error: null,
};

const stepResult = {
	schema_version: 1,
	observation: commandObservation,
	reward: {
		value: 0,
		success: false,
		failure_reasons: ['page_missing'],
	},
	done: false,
	telemetry: {
		runner: 'local-playground',
		duration_ms: 84,
	},
};

const trace = {
	schema_version: 1,
	episode_id: 'episode-001',
	scenario_id: 'smoke-homepage',
	metadata: {
		max_steps: 12,
		allowed_action_types: ['wp_cli'],
		setup: ['wordpress-playground-clean-site'],
		success_checks: ['page_created', 'expected_block_content'],
	},
	steps: [
		{
			step_index: 0,
			timestamp: '2026-05-20T00:00:00Z',
			action: wpCliAction,
			result: stepResult,
		},
	],
};

const { stdout, ...missingStdoutObservation } = commandObservation;

assertValid(actionSchemaId, wpCliAction, 'wp_cli action');
assertValid(actionSchemaId, filesystemAction, 'filesystem action');
assertValid(actionSchemaId, restAction, 'rest action');
assertValid(actionSchemaId, browserAction, 'browser action');
assertValid(observationSchemaId, commandObservation, 'command_result observation');
assertValid(observationSchemaId, filesObservation, 'files observation');
assertValid(observationSchemaId, restObservation, 'rest_response observation');
assertValid(observationSchemaId, browserObservation, 'browser_result observation');
assertValid(stepResultSchemaId, stepResult, 'step result');
assertValid(traceSchemaId, trace, 'trace');

assertInvalid(actionSchemaId, { schema_version: 1, type: 'wp_cli' }, 'wp_cli action without command');
assertInvalid(actionSchemaId, { ...wpCliAction, command: 'wp post list' }, 'wp_cli action with leading wp');
assertInvalid(actionSchemaId, { ...wpCliAction, unknown: true }, 'wp_cli action with unknown property');
assertInvalid(actionSchemaId, { ...filesystemAction, path: '../secret.php' }, 'filesystem action escaping workspace');
assertInvalid(actionSchemaId, { ...filesystemAction, operation: 'patch' }, 'filesystem patch action before runtime support');
assertInvalid(actionSchemaId, { ...restAction, method: 'TRACE' }, 'rest action with unsupported method');
assertInvalid(actionSchemaId, { ...browserAction, operation: 'drag' }, 'browser action with unsupported operation');
assertInvalid(observationSchemaId, missingStdoutObservation, 'command_result observation without stdout');
assertInvalid(observationSchemaId, { ...filesObservation, extra: true }, 'files observation with unknown property');
assertInvalid(observationSchemaId, { ...restObservation, action_type: 'wp_cli' }, 'rest observation with wrong action type');
assertInvalid(
	stepResultSchemaId,
	{
		...stepResult,
		telemetry: { success: false },
	},
	'step result with success hidden in telemetry'
);
assertInvalid(
	traceSchemaId,
	{
		...trace,
		metadata: { ...trace.metadata, allowed_action_types: [] },
	},
	'trace without allowed action types'
);

console.log(`Validated ${schemaFiles.length} episode contract schema(s).`);
