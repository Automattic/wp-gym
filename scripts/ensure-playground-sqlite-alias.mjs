import { copyFile, access } from 'node:fs/promises';
import path from 'node:path';

const sqliteDir = path.join(
	process.cwd(),
	'node_modules',
	'@wp-playground',
	'wordpress-builds',
	'src',
	'sqlite-database-integration'
);
const source = path.join(sqliteDir, 'sqlite-database-integration.zip');
const target = path.join(sqliteDir, 'sqlite-database-integration-trunk.zip');

try {
	await access(target);
} catch {
	try {
		await access(source);
		await copyFile(source, target);
	} catch {
		// Optional runtime dependency is not installed for metadata-only installs.
	}
}
