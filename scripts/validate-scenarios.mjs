import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const scenarioRoot = path.join(root, 'scenarios');
const taskSetRoot = path.join(root, 'task-sets');

async function listScenarioFiles(dir, relativeDir = 'scenarios') {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		const relativePath = path.join(relativeDir, entry.name);

		if (entry.isDirectory()) {
			files.push(...await listScenarioFiles(fullPath, relativePath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(relativePath);
		}
	}

	return files.sort();
}

const files = await listScenarioFiles(scenarioRoot);
const scenarioIdsByManifest = new Map();

if (files.length < 2) {
	throw new Error(`Expected at least 2 scenario manifests, found ${files.length}`);
}

for (const file of files) {
	const manifest = JSON.parse(await readFile(path.join(root, file), 'utf8'));
	const manifestDir = path.dirname(file);
	scenarioIdsByManifest.set(file, manifest.id);

	for (const field of ['id', 'label', 'prompt_file', 'grader_file']) {
		if (!manifest[field]) {
			throw new Error(`${file} is missing ${field}`);
		}
	}

	if (!existsSync(path.join(root, manifestDir, manifest.prompt_file))) {
		throw new Error(`${file} prompt does not exist: ${manifest.prompt_file}`);
	}

	if (!existsSync(path.join(root, manifestDir, manifest.grader_file))) {
		throw new Error(`${file} checker does not exist: ${manifest.grader_file}`);
	}

	if (!manifest.rules || Array.isArray(manifest.rules) || typeof manifest.rules !== 'object') {
		throw new Error(`${file} must declare rules as an object`);
	}

	for (const field of ['general', 'task_specific']) {
		if (!Array.isArray(manifest.rules[field]) || manifest.rules[field].length < 1) {
			throw new Error(`${file} rules.${field} must include at least one rule id`);
		}

		for (const rule of manifest.rules[field]) {
			if (typeof rule !== 'string' || !/^[a-z0-9_]+$/.test(rule)) {
				throw new Error(`${file} rules.${field} entries must be snake_case strings`);
			}
		}
	}
}

async function listTaskSetFiles() {
	if (!existsSync(taskSetRoot)) {
		return [];
	}

	const entries = await readdir(taskSetRoot, { withFileTypes: true });

	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
		.map((entry) => path.join('task-sets', entry.name))
		.sort();
}

const taskSetFiles = await listTaskSetFiles();

for (const file of taskSetFiles) {
	const manifest = JSON.parse(await readFile(path.join(root, file), 'utf8'));
	const manifestDir = path.dirname(file);
	const taskScenarioIds = new Set((manifest.tasks ?? []).map((task) => task.scenario_id));

	for (const field of ['id', 'label', 'scenario_manifests']) {
		if (!manifest[field]) {
			throw new Error(`${file} is missing ${field}`);
		}
	}

	if (!Array.isArray(manifest.scenario_manifests) || manifest.scenario_manifests.length < 1) {
		throw new Error(`${file} must include at least one scenario manifest`);
	}

	for (const scenarioManifest of manifest.scenario_manifests) {
		const resolvedScenarioManifest = path.relative(root, path.join(root, manifestDir, scenarioManifest));

		if (!existsSync(path.join(root, resolvedScenarioManifest))) {
			throw new Error(`${file} references missing scenario manifest: ${scenarioManifest}`);
		}

		const scenarioId = scenarioIdsByManifest.get(resolvedScenarioManifest);
		if (!taskScenarioIds.has(scenarioId)) {
			throw new Error(`${file} is missing task metadata for scenario: ${scenarioId}`);
		}
	}
}

const phpFiles = [
	path.join('graders', 'block-markup', 'grader-common.php'),
	path.join('graders', 'modern-wordpress-api', 'grader-common.php'),
	...files.map(async (file) => {
		const manifest = JSON.parse(await readFile(path.join(root, file), 'utf8'));
		return path.join(path.dirname(file), manifest.grader_file);
	}),
];

for (const phpFile of await Promise.all(phpFiles)) {
	const result = spawnSync('php', ['-l', phpFile], { cwd: root, encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(`php -l failed for ${phpFile}:\n${result.stdout}${result.stderr}`);
	}
}

console.log(`Validated ${files.length} scenario manifests and ${taskSetFiles.length} task sets.`);
