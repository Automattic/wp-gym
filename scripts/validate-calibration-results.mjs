import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const root = process.cwd();
const calibrationRoot = path.join(root, 'fixtures', 'calibration');
const requiredRowTypes = new Set([
	'no_op',
	'heuristic_scripted',
	'cheap_model',
	'frontier_model',
	'repeated_attempts',
	'human_reference',
]);

async function listJsonFiles(dir, relativeDir) {
	if (!existsSync(dir)) {
		return [];
	}

	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		const relativePath = path.join(relativeDir, entry.name).replace(/\\/g, '/');
		if (entry.isDirectory()) {
			files.push(...await listJsonFiles(fullPath, relativePath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(relativePath);
		}
	}

	return files.sort();
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function formatErrors(errors = []) {
	return errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
}

const schema = JSON.parse(await readFile(path.join(root, 'schemas/calibration-result.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validate = ajv.compile(schema);
const files = await listJsonFiles(calibrationRoot, 'fixtures/calibration');

assert(files.length > 0, 'Expected at least one calibration result fixture.');

for (const file of files) {
	const value = JSON.parse(await readFile(path.join(root, file), 'utf8'));
	if (!validate(value)) {
		throw new Error(`${file} schema errors: ${formatErrors(validate.errors)}`);
	}

	const rowTypes = new Set(value.rows.map((row) => row.row_type));
	for (const rowType of requiredRowTypes) {
		assert(rowTypes.has(rowType), `${file} must include a ${rowType} calibration row`);
	}

	for (const row of value.rows) {
		assert(row.passes <= row.attempts, `${file} ${row.row_type} passes cannot exceed attempts`);
		assert(
			Math.abs(row.pass_rate - row.passes / row.attempts) < 0.001,
			`${file} ${row.row_type} pass_rate must match passes / attempts`
		);
	}

	const [low, high] = value.summary.confidence_interval_95;
	assert(low <= high, `${file} summary.confidence_interval_95 must be ordered low-to-high`);
}

console.log(`Validated ${files.length} calibration result fixture(s).`);
