import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { browserArtifactMetrics } from 'wp-codebox-workspace/playground';

const root = process.cwd();
const fixtureRoot = path.join(root, 'fixtures', 'codebox-browser-metrics');

const withMetrics = await browserArtifactMetrics(path.join(fixtureRoot, 'with-browser-metrics'));
assert.equal(withMetrics.schema, 'wp-codebox/browser-metrics/v1');
assert.equal(withMetrics.hasBrowserMetrics, true);
assert.equal(withMetrics.metrics.browser_resource_count, 12);
assert.equal(withMetrics.metrics.browser_transfer_size_bytes, 24576);
assert.equal(withMetrics.artifacts.summary.path, 'files/browser/summary.json');
assert.equal(withMetrics.artifacts.memory.path, 'files/browser/memory.json');
assert.equal(withMetrics.artifacts.performance.path, 'files/browser/performance.json');

const withoutMetrics = await browserArtifactMetrics(path.join(fixtureRoot, 'without-browser-metrics'));
assert.equal(withoutMetrics.schema, 'wp-codebox/browser-metrics/v1');
assert.equal(withoutMetrics.hasBrowserMetrics, false);
assert.deepEqual(withoutMetrics.metrics, {});
assert.deepEqual(withoutMetrics.artifacts, {});

const schema = JSON.parse(await fs.readFile(path.join(root, 'schemas', 'observation.v1.schema.json'), 'utf8'));
const ajv = new Ajv2020({ strict: false });
const validate = ajv.compile(schema);

for (const [label, browserMetrics] of [['with browser metrics', withMetrics], ['without browser metrics', withoutMetrics]]) {
	const observation = {
		schema_version: 1,
		type: 'browser_result',
		action_type: 'browser',
		operation: 'navigate',
		replayability: 'replayable',
		url: '/',
		artifacts: [],
		browser_metrics: {
			schema: browserMetrics.schema,
			hasBrowserMetrics: browserMetrics.hasBrowserMetrics,
			metrics: browserMetrics.metrics,
			artifacts: browserMetrics.artifacts,
		},
		error: null,
	};
	assert.equal(validate(observation), true, `${label} observation should validate: ${JSON.stringify(validate.errors)}`);
}

console.log('Codebox browser metrics fixtures validate.');
