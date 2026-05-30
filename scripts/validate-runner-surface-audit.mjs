import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { hiddenEvidenceSummary, validateHiddenEvidenceBoundary } from './hidden-evidence-boundaries.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schemaPath = path.join(root, 'schemas/visible-agent-surface.v1.schema.json');
const fixtureDir = path.join(root, 'fixtures/runner-surface');

const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validate = ajv.compile(schema);
const fixtureFiles = (await readdir(fixtureDir)).filter((file) => file.endsWith('.json')).sort();
const summaries = [];

for (const fixtureFile of fixtureFiles) {
	const fixturePath = path.join(fixtureDir, fixtureFile);
	const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
	if (!validate(fixture)) {
		throw new Error(`Runner surface fixture ${fixtureFile} failed schema validation: ${(validate.errors || []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')}`);
	}

	const counts = fixture.audit.classification_counts;
	const classifiedItems = [...fixture.instructions, ...fixture.tools].length;
	const countedItems = counts.acceptable_scaffolding + counts.task_sandbox_interference + counts.unknown;
	if (classifiedItems !== countedItems) {
		throw new Error(`Runner surface classification count mismatch in ${fixtureFile}: items=${classifiedItems} counts=${countedItems}`);
	}

	if (fixture.recommendation.producer_status === 'fixture_contract_only') {
		const issue = fixture.artifact.producer_issue;
		if (issue !== 'https://github.com/Extra-Chill/homeboy-extensions/issues/842') {
			throw new Error('Fixture-only runner surface contracts must link Homeboy Extensions #842.');
		}
	}

	const hiddenEvidenceGaps = validateHiddenEvidenceBoundary(fixture.audit.hidden_evidence_boundaries, {
		benchmarkMode: fixture.audit.hidden_evidence_boundaries?.benchmark_mode_eligible === true,
		field: `${fixtureFile}.audit.hidden_evidence_boundaries`,
	});
	if (hiddenEvidenceGaps.length > 0) {
		throw new Error(`Runner surface fixture ${fixtureFile} failed hidden evidence audit: ${hiddenEvidenceGaps.map((item) => `${item.code}:${item.field}`).join('; ')}`);
	}

	summaries.push({
		fixture: path.relative(root, fixturePath),
		producer_issue: fixture.artifact.producer_issue,
		producer_status: fixture.recommendation.producer_status,
		classification_counts: counts,
		interference_findings: fixture.audit.interference_findings,
		hidden_evidence_boundaries: hiddenEvidenceSummary(fixture.audit.hidden_evidence_boundaries),
		minimal_live_run_config: fixture.recommendation.minimal_live_run_config,
	});
}

console.log(JSON.stringify({
	ok: true,
	fixtures: summaries,
}, null, 2));
