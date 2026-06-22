import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scannedDirs = ['src', 'scripts', 'bin'];
const sourceExtensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.jsx']);
const packageFiles = ['package.json', 'package-lock.json'];

const publicCodeboxEntrypoints = new Set([
	'wp-codebox-workspace/core/public',
	'wp-codebox-workspace/core/contracts',
	'wp-codebox-workspace/core/artifacts',
	'wp-codebox-workspace/playground/public',
	'wp-codebox-workspace/cli/recipe-secret-env',
]);

const privateCodeboxPackages = new Set([
	'@automattic/wp-codebox-core',
	'@automattic/wp-codebox-playground',
	'@chubes4/wp-codebox-core',
	'@chubes4/wp-codebox-playground',
]);

const knownCompatibilityGaps = new Set([
	'src/runtime/wp-codebox-adapter.js imports commandRegistry, createRuntimeEpisode, normalizeObservationArtifactRefs, runRuntimeAction from wp-codebox-workspace/core until the locked WP Codebox dependency exposes the public runtime facade',
	'src/runtime/wp-codebox-adapter.js imports browserArtifactMetrics, createPlaygroundRuntimeBackend, playgroundRuntimeCommandIds from wp-codebox-workspace/playground until the locked WP Codebox dependency exposes the public playground facade',
	'package.json depends on wp-codebox-workspace until WP Codebox publishes public SDK packages',
	'package-lock.json root dependency resolves wp-codebox-workspace until WP Codebox publishes public SDK packages',
	'package-lock.json links @automattic/wp-codebox-core from the wp-codebox-workspace checkout until public SDK packages replace workspace links',
	'package-lock.json links @automattic/wp-codebox-playground from the wp-codebox-workspace checkout until public SDK packages replace workspace links',
	'package-lock.json links @chubes4/wp-codebox-core from the wp-codebox-workspace checkout until public SDK packages replace workspace links',
	'package-lock.json links @chubes4/wp-codebox-playground from the wp-codebox-workspace checkout until public SDK packages replace workspace links',
]);

const importPattern = /import\s+(?:([\s\S]*?)\s+from\s*)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

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
const compatibilityGaps = new Set();

for (const dir of scannedDirs) {
	for (const file of await sourceFiles(path.join(root, dir))) {
		const source = await readFile(file, 'utf8');
		for (const match of source.matchAll(importPattern)) {
			const importClause = match[1] || '';
			const specifier = match[2] || match[3];
			if (!isCodeboxPackageSpecifier(specifier)) {
				continue;
			}

			const relativeFile = path.relative(root, file);
			if (publicCodeboxEntrypoints.has(specifier)) {
				continue;
			}

			const gap = codeboxImportCompatibilityGap(relativeFile, specifier, importClause);
			if (gap) {
				compatibilityGaps.add(gap);
				continue;
			}

			violations.push(`${relativeFile} imports non-public Codebox entrypoint ${specifier}`);
		}
	}
}

for (const file of packageFiles) {
	const packagePath = path.join(root, file);
	const metadata = JSON.parse(await readFile(packagePath, 'utf8'));
	validatePackageMetadata(file, metadata);
}

for (const gap of compatibilityGaps) {
	if (!knownCompatibilityGaps.has(gap)) {
		violations.push(`Unexpected Codebox compatibility gap: ${gap}`);
	}
}

if (violations.length) {
	throw new Error(`Codebox imports must use documented public Codebox entrypoints. Known compatibility gaps must be explicit in scripts/validate-codebox-import-boundary.mjs:\n${violations.join('\n')}`);
}

function isCodeboxPackageSpecifier(specifier) {
	return specifier === 'wp-codebox-workspace'
		|| specifier.startsWith('wp-codebox-workspace/')
		|| privateCodeboxPackages.has(specifier)
		|| [...privateCodeboxPackages].some((packageName) => specifier.startsWith(`${packageName}/`));
}

function codeboxImportCompatibilityGap(relativeFile, specifier, importClause) {
	if (relativeFile === 'src/runtime/wp-codebox-adapter.js'
		&& specifier === 'wp-codebox-workspace/core'
		&& importsOnly(importClause, ['commandRegistry', 'createRuntimeEpisode', 'normalizeObservationArtifactRefs', 'runRuntimeAction'])) {
		return 'src/runtime/wp-codebox-adapter.js imports commandRegistry, createRuntimeEpisode, normalizeObservationArtifactRefs, runRuntimeAction from wp-codebox-workspace/core until the locked WP Codebox dependency exposes the public runtime facade';
	}

	if (relativeFile === 'src/runtime/wp-codebox-adapter.js'
		&& specifier === 'wp-codebox-workspace/playground'
		&& importsOnly(importClause, ['browserArtifactMetrics', 'createPlaygroundRuntimeBackend', 'playgroundRuntimeCommandIds'])) {
		return 'src/runtime/wp-codebox-adapter.js imports browserArtifactMetrics, createPlaygroundRuntimeBackend, playgroundRuntimeCommandIds from wp-codebox-workspace/playground until the locked WP Codebox dependency exposes the public playground facade';
	}

	return null;
}

function importsOnly(importClause, allowedNames) {
	const namedImportMatch = importClause.match(/\{([^}]+)\}/);
	if (!namedImportMatch) {
		return false;
	}

	const importedNames = namedImportMatch[1]
		.split(',')
		.map((entry) => entry.trim().split(/\s+as\s+/)[0].trim())
		.filter(Boolean);

	return importedNames.length > 0
		&& importedNames.every((name) => allowedNames.includes(name))
		&& allowedNames.every((name) => importedNames.includes(name));
}

function validatePackageMetadata(file, metadata) {
	if (file === 'package.json') {
		validateDependencyMap(file, 'dependencies', metadata.dependencies || {});
		validateDependencyMap(file, 'devDependencies', metadata.devDependencies || {});
		validateDependencyMap(file, 'optionalDependencies', metadata.optionalDependencies || {});
		return;
	}

	validatePackageLock(metadata);
}

function validateDependencyMap(file, section, dependencies) {
	for (const [name, version] of Object.entries(dependencies)) {
		if (privateCodeboxPackages.has(name)) {
			violations.push(`${file} ${section} references private Codebox workspace package ${name}`);
		}

		if (name === 'wp-codebox-workspace') {
			compatibilityGaps.add('package.json depends on wp-codebox-workspace until WP Codebox publishes public SDK packages');
			continue;
		}

		if (typeof version === 'string' && /wp-codebox-workspace\/packages\/(runtime-core|runtime-playground)/.test(version)) {
			violations.push(`${file} ${section}.${name} resolves through private Codebox workspace path ${version}`);
		}
	}
}

function validatePackageLock(lockfile) {
	const rootPackage = lockfile.packages?.[''];
	if (rootPackage?.dependencies?.['wp-codebox-workspace']) {
		compatibilityGaps.add('package-lock.json root dependency resolves wp-codebox-workspace until WP Codebox publishes public SDK packages');
	}

	for (const [packagePath, packageInfo] of Object.entries(lockfile.packages || {})) {
		const name = packagePath.replace(/^node_modules\//, '');
		if (!privateCodeboxPackages.has(name)) {
			continue;
		}

		if (packageInfo?.link === true && typeof packageInfo.resolved === 'string' && packageInfo.resolved.startsWith('node_modules/wp-codebox-workspace/packages/')) {
			compatibilityGaps.add(`package-lock.json links ${name} from the wp-codebox-workspace checkout until public SDK packages replace workspace links`);
			continue;
		}

		violations.push(`package-lock.json references private Codebox workspace package ${name}`);
	}
}
