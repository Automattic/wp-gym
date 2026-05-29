import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schemaId = 'https://raw.githubusercontent.com/Automattic/wp-gym/main/schemas/held-out-pack-manifest.v1.schema.json';
const defaultInput = path.join(root, 'fixtures', 'held-out-packs');
const publicRepoPrivateRoots = new Set(['scenarios', 'prompts', 'fixtures', 'graders']);
const requiredArtifactNames = new Set(['scenario_manifest', 'prompt', 'grader', 'setup', 'expected_artifacts', 'replay_contract']);

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256File(file) {
	return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function collectJsonFiles(input) {
	const stat = fs.statSync(input);
	if (stat.isFile()) {
		return [input];
	}

	const files = [];
	for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
		const entryPath = path.join(input, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectJsonFiles(entryPath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(entryPath);
		}
	}
	return files.sort();
}

function repoRelative(file) {
	const relative = path.relative(root, file).replace(/\\/g, '/');
	return relative.startsWith('..') ? file : relative;
}

function gap(code, severity, field, message) {
	return { code, severity, field, message };
}

function createValidator() {
	const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
	ajv.addSchema(readJson(path.join(root, 'schemas/held-out-pack-manifest.v1.schema.json')));
	const validate = ajv.getSchema(schemaId);
	if (!validate) {
		throw new Error(`Missing compiled schema: ${schemaId}`);
	}
	return validate;
}

function artifactPath(manifestFile, artifact) {
	if (!artifact.path_or_url || /^[a-z][a-z0-9+.-]*:\/\//i.test(artifact.path_or_url) || artifact.path_or_url.startsWith('sealed://')) {
		return null;
	}
	return path.resolve(path.dirname(manifestFile), artifact.path_or_url);
}

function isPublicRepoPrivateMaterialPath(file) {
	const relative = path.relative(root, file).replace(/\\/g, '/');
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		return false;
	}
	return publicRepoPrivateRoots.has(relative.split('/')[0]);
}

function validatePackManifest(manifest, manifestFile, options = {}) {
	const validate = options.validate || createValidator();
	const requireLocalArtifacts = Boolean(options.requireLocalArtifacts);
	const gaps = [];

	if (!validate(manifest)) {
		gaps.push(...(validate.errors || []).map((error) => gap('schema_mismatch', 'error', error.instancePath || '/', `${error.instancePath || '/'} ${error.message}`)));
	}

	if (manifest.boundary?.artifact_access === 'private_lab' && manifest.boundary?.public_report_policy !== 'aggregate_only') {
		gaps.push(gap('private_lab_report_policy', 'error', 'boundary.public_report_policy', 'private_lab artifact access must publish aggregate-only public reports.'));
	}

	const entryIds = new Set();
	for (const [entryIndex, entry] of (manifest.entries || []).entries()) {
		const entryField = `entries[${entryIndex}]`;
		if (entryIds.has(entry.id)) {
			gaps.push(gap('duplicate_entry_id', 'error', `${entryField}.id`, `Duplicate held-out entry id: ${entry.id}`));
		}
		entryIds.add(entry.id);

		const artifacts = Array.isArray(entry.artifacts) ? entry.artifacts : [];
		const artifactNames = new Set(artifacts.map((artifact) => artifact.name));
		for (const requiredName of requiredArtifactNames) {
			if (!artifactNames.has(requiredName)) {
				gaps.push(gap('missing_required_artifact', 'error', `${entryField}.artifacts`, `${entry.id} must declare a ${requiredName} artifact reference.`));
			}
		}

		for (const artifact of artifacts) {
			if (artifact.sharing_level === 'public_report') {
				gaps.push(gap('public_private_artifact', 'error', `${entryField}.artifacts.${artifact.name}`, 'Held-out pack artifacts must not use public_report sharing.'));
			}

			const resolved = artifactPath(manifestFile, artifact);
			if (!resolved) {
				if (requireLocalArtifacts) {
					gaps.push(gap('missing_local_artifact_path', 'error', `${entryField}.artifacts.${artifact.name}.path_or_url`, `${artifact.name} must declare a local path when --require-local-artifacts is used.`));
				}
				continue;
			}

			if (isPublicRepoPrivateMaterialPath(resolved)) {
				gaps.push(gap('private_material_in_public_repo', 'error', `${entryField}.artifacts.${artifact.name}.path_or_url`, `${artifact.path_or_url} resolves inside public wp-gym private-material paths.`));
			}

			if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
				gaps.push(gap('missing_local_artifact', 'error', `${entryField}.artifacts.${artifact.name}.path_or_url`, `${artifact.path_or_url} does not exist as a local file.`));
				continue;
			}

			const computed = sha256File(resolved);
			if (computed !== artifact.sha256) {
				gaps.push(gap('stale_artifact_hash', 'error', `${entryField}.artifacts.${artifact.name}.sha256`, `${artifact.name} sha256 does not match ${artifact.path_or_url}.`));
			}
		}
	}

	return {
		ok: !gaps.some((item) => item.severity === 'error'),
		compatibility_gaps: gaps,
	};
}

function parseArgs(argv) {
	const args = { input: defaultInput, requireLocalArtifacts: false };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--input') {
			args.input = path.resolve(argv[++i]);
		} else if (arg === '--require-local-artifacts') {
			args.requireLocalArtifacts = true;
		} else if (arg === '--help' || arg === '-h') {
			args.help = true;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.error('Usage: node scripts/validate-held-out-packs.mjs [--input <manifest-json-or-dir>] [--require-local-artifacts]');
		process.exit(0);
	}

	const validate = createValidator();
	const results = collectJsonFiles(args.input).map((file) => {
		const manifest = readJson(file);
		const result = validatePackManifest(manifest, file, {
			validate,
			requireLocalArtifacts: args.requireLocalArtifacts,
		});
		return {
			file: repoRelative(file),
			ok: result.ok,
			compatibility_gaps: result.compatibility_gaps,
		};
	});

	const ok = results.every((result) => result.ok);
	console.log(JSON.stringify({ ok, require_local_artifacts: args.requireLocalArtifacts, results }, null, 2));
	if (!ok) {
		process.exit(1);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}

export { validatePackManifest };
