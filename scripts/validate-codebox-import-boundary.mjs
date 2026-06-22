import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scannedDirs = ['src', 'scripts', 'bin'];
const sourceExtensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.jsx']);
const forbiddenPattern = /(?:from\s+['"]|import\s*\(\s*['"])(@automattic\/wp-codebox-(?:core|playground))/g;

async function sourceFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...await sourceFiles(fullPath));
		} else if (sourceExtensions.has(path.extname(entry.name))) {
			files.push(fullPath);
		}
	}
	return files;
}

const violations = [];

for (const dir of scannedDirs) {
	for (const file of await sourceFiles(path.join(root, dir))) {
		const source = await readFile(file, 'utf8');
		for (const match of source.matchAll(forbiddenPattern)) {
			violations.push(`${path.relative(root, file)} imports ${match[1]}`);
		}
	}
}

if (violations.length) {
	throw new Error(`Codebox internals must be imported through public Codebox exports or the runtime adapter boundary:\n${violations.join('\n')}`);
}
