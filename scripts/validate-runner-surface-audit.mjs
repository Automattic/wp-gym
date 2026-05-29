import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schemaPath = path.join(root, 'schemas/visible-agent-surface.v1.schema.json');
const fixturePath = path.join(root, 'fixtures/runner-surface/visible-agent-surface.fixture.json');

const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validate = ajv.compile(schema);

if (!validate(fixture)) {
	throw new Error(`Runner surface fixture failed schema validation: ${(validate.errors || []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')}`);
}

const counts = fixture.audit.classification_counts;
const classifiedItems = [...fixture.instructions, ...fixture.tools].length;
const countedItems = counts.acceptable_scaffolding + counts.task_sandbox_interference + counts.unknown;
if (classifiedItems !== countedItems) {
	throw new Error(`Runner surface classification count mismatch: items=${classifiedItems} counts=${countedItems}`);
}

if (fixture.recommendation.producer_status === 'fixture_contract_only') {
	const issue = fixture.artifact.producer_issue;
	if (issue !== 'https://github.com/Extra-Chill/homeboy-extensions/issues/842') {
		throw new Error('Fixture-only runner surface contracts must link Homeboy Extensions #842.');
	}
}

console.log(JSON.stringify({
	ok: true,
	fixture: path.relative(root, fixturePath),
	producer_issue: fixture.artifact.producer_issue,
	classification_counts: counts,
	minimal_live_run_config: fixture.recommendation.minimal_live_run_config,
}, null, 2));
