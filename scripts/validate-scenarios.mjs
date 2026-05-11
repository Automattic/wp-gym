import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const scenarioDir = path.join(root, 'scenarios', 'block-markup');
const files = (await readdir(scenarioDir)).filter((file) => file.endsWith('.json')).sort();

if (files.length < 2) {
	throw new Error(`Expected at least 2 scenario manifests, found ${files.length}`);
}

for (const file of files) {
	const relativePath = path.join('scenarios', 'block-markup', file);
	const manifest = JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));

	for (const field of ['id', 'label', 'prompt', 'grader']) {
		if (!manifest[field]) {
			throw new Error(`${relativePath} is missing ${field}`);
		}
	}

	if (!existsSync(path.join(root, manifest.prompt))) {
		throw new Error(`${relativePath} prompt does not exist: ${manifest.prompt}`);
	}

	if (!manifest.grader.file || !existsSync(path.join(root, manifest.grader.file))) {
		throw new Error(`${relativePath} grader does not exist: ${manifest.grader.file}`);
	}

	if (manifest.grader.role !== 'grader') {
		throw new Error(`${relativePath} grader.role must be grader`);
	}
}

const phpFiles = [
	path.join('graders', 'block-markup', 'grader-common.php'),
	...files.map((file) => path.join('graders', 'block-markup', file.replace(/\.json$/, '.php'))),
];

for (const phpFile of phpFiles) {
	const result = spawnSync('php', ['-l', phpFile], { cwd: root, encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(`php -l failed for ${phpFile}:\n${result.stdout}${result.stderr}`);
	}
}

console.log(`Validated ${files.length} block-markup scenarios.`);
