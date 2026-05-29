import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const root = process.cwd();
const calibrationRoot = path.join(root, 'fixtures', 'calibration');
const invalidCalibrationRoot = path.join(root, 'fixtures', 'calibration-invalid');
const scenarioRoot = path.join(root, 'scenarios');
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

async function loadScenarios(dir = scenarioRoot, relativeDir = 'scenarios') {
	if (!existsSync(dir)) {
		return [];
	}

	const entries = await readdir(dir, { withFileTypes: true });
	const scenarios = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		const relativePath = path.join(relativeDir, entry.name).replace(/\\/g, '/');
		if (entry.isDirectory()) {
			scenarios.push(...await loadScenarios(fullPath, relativePath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			scenarios.push({ file: relativePath, value: JSON.parse(await readFile(fullPath, 'utf8')) });
		}
	}

	return scenarios;
}

function calibrationPathForId(id) {
	return `fixtures/calibration/${id}.json`;
}

const schema = JSON.parse(await readFile(path.join(root, 'schemas/calibration-result.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validate = ajv.compile(schema);
const files = await listJsonFiles(calibrationRoot, 'fixtures/calibration');
const invalidFiles = await listJsonFiles(invalidCalibrationRoot, 'fixtures/calibration-invalid');
const resultSetsById = new Map();
const scenarios = await loadScenarios();
const scenarioIds = new Set(scenarios.map(({ value }) => value.id));

assert(files.length > 0, 'Expected at least one calibration result fixture.');

for (const file of files) {
	const value = JSON.parse(await readFile(path.join(root, file), 'utf8'));
	if (!validate(value)) {
		throw new Error(`${file} schema errors: ${formatErrors(validate.errors)}`);
	}

	assert(!resultSetsById.has(value.id), `${file} duplicates calibration result id ${value.id}`);
	assert(scenarioIds.has(value.scenario_id), `${file} references unknown scenario_id ${value.scenario_id}`);
	if (!file.endsWith('.sample.json')) {
		assert(calibrationPathForId(value.id) === file, `${file} must be named ${calibrationPathForId(value.id)}`);
	}
	resultSetsById.set(value.id, file);

	for (const evidenceFile of value.source?.evidence_files || []) {
		assert(existsSync(path.join(root, evidenceFile)), `${file} source.evidence_files entry does not exist: ${evidenceFile}`);
	}

	const rowTypes = new Set(value.rows.map((row) => row.row_type));
	if (value.summary.promotion_recommendation === 'benchmark_ready') {
		for (const rowType of requiredRowTypes) {
			assert(rowTypes.has(rowType), `${file} benchmark-ready calibration must include a ${rowType} row`);
		}
	}

	for (const row of value.rows) {
		assert(row.passes <= row.attempts, `${file} ${row.row_type} passes cannot exceed attempts`);
		assert(
			Math.abs(row.pass_rate - row.passes / row.attempts) < 0.001,
			`${file} ${row.row_type} pass_rate must match passes / attempts`
		);
		if (row.row_type === 'repeated_attempts') {
			assert(row.attempts >= 2, `${file} repeated_attempts row must include at least two attempts`);
			assert(row.result_set_id, `${file} repeated_attempts row must include result_set_id`);
			assert(Array.isArray(row.attempt_ids), `${file} repeated_attempts row must include attempt_ids`);
			assert(row.attempt_ids.length === row.attempts, `${file} repeated_attempts attempt_ids must match attempts`);
			assert(new Set(row.attempt_ids).size === row.attempt_ids.length, `${file} repeated_attempts attempt_ids must be unique`);
			if (row.pass_at_1 !== undefined) {
				assert(Math.abs(row.pass_at_1 - row.pass_rate) < 0.001, `${file} repeated_attempts pass_at_1 must match pass_rate`);
			}
			if (row.pass_at_n !== undefined) {
				assert(row.pass_at_n === (row.passes > 0 ? 1 : 0), `${file} repeated_attempts pass_at_n must reflect any successful attempt`);
			}
			if (Array.isArray(row.confidence_interval_95)) {
				assert(row.confidence_interval_95[0] <= row.confidence_interval_95[1], `${file} repeated_attempts confidence_interval_95 must be ordered low-to-high`);
			}
		}
	}

	const hasCompleteRepeatedAttempts = value.rows.some((row) => row.row_type === 'repeated_attempts' && row.attempts >= 2 && row.result_set_id && Array.isArray(row.attempt_ids) && row.attempt_ids.length === row.attempts);
	if (value.summary.promotion_recommendation === 'benchmark_ready') {
		assert(hasCompleteRepeatedAttempts, `${file} benchmark-ready calibration must include a complete repeated_attempts result set`);
		assert(!(value.summary.blockers || []).includes('missing_repeated_attempts'), `${file} benchmark-ready calibration cannot keep missing_repeated_attempts blocker`);
	}

	const [low, high] = value.summary.confidence_interval_95;
	assert(low <= high, `${file} summary.confidence_interval_95 must be ordered low-to-high`);
}

for (const file of invalidFiles) {
	const value = JSON.parse(await readFile(path.join(root, file), 'utf8'));
	const expected = value._expected_error || 'invalid calibration fixture';
	let failed = false;
	try {
		if (!validate(value)) {
			throw new Error(`${file} schema errors: ${formatErrors(validate.errors)}`);
		}
		for (const row of value.rows || []) {
			if (row.row_type === 'repeated_attempts') {
				assert(row.attempts >= 2, expected);
				assert(row.result_set_id, expected);
				assert(Array.isArray(row.attempt_ids), expected);
				assert(row.attempt_ids.length === row.attempts, expected);
			}
		}
	} catch {
		failed = true;
	}
	assert(failed, `${file} was expected to fail validation: ${expected}`);
}

for (const { file, value } of scenarios) {
	for (const field of ['baseline_result_sets', 'calibration_result_sets']) {
		for (const resultSetId of value.calibration?.[field] || []) {
			assert(resultSetsById.has(resultSetId), `${file} calibration.${field} references unknown calibration result set ${resultSetId}`);
		}
	}
}

console.log(`Validated ${files.length} calibration result fixture(s) and ${invalidFiles.length} invalid fixture(s).`);
