import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const scenarioRoot = path.join(root, 'scenarios');

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

if (files.length < 2) {
	throw new Error(`Expected at least 2 scenario manifests, found ${files.length}`);
}

for (const file of files) {
	const manifest = JSON.parse(await readFile(path.join(root, file), 'utf8'));

	for (const field of ['id', 'label', 'prompt', 'grader']) {
		if (!manifest[field]) {
			throw new Error(`${file} is missing ${field}`);
		}
	}

	if (!existsSync(path.join(root, manifest.prompt))) {
		throw new Error(`${file} prompt does not exist: ${manifest.prompt}`);
	}

	if (!manifest.grader.file || !existsSync(path.join(root, manifest.grader.file))) {
		throw new Error(`${file} checker does not exist: ${manifest.grader.file}`);
	}

	if (manifest.grader.role !== 'grader') {
		throw new Error(`${file} grader.role must be grader`);
	}
}

const phpFiles = [
	path.join('graders', 'block-markup', 'grader-common.php'),
	...files.map(async (file) => {
		const manifest = JSON.parse(await readFile(path.join(root, file), 'utf8'));
		return manifest.grader.file;
	}),
];

for (const phpFile of await Promise.all(phpFiles)) {
	const result = spawnSync('php', ['-l', phpFile], { cwd: root, encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(`php -l failed for ${phpFile}:\n${result.stdout}${result.stderr}`);
	}
}

console.log(`Validated ${files.length} scenario manifests.`);
