import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkWorkspacePolicy } from './check-workspace-policy.mjs';

const policy = {
	writableRoots: ['plugins/'],
	hiddenPaths: ['graders/', 'scripts/', '.github/', 'docs/'],
};

function git(cwd, args) {
	return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function writeFile(root, relativePath, content = '') {
	const absolutePath = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
	fs.writeFileSync(absolutePath, content);
}

function makeRepo() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-gym-policy-'));
	git(root, ['init', '-q']);
	git(root, ['config', 'user.email', 'policy@example.test']);
	git(root, ['config', 'user.name', 'Policy Test']);
	writeFile(root, 'plugins/.gitkeep', '');
	writeFile(root, 'scripts/locked.php', '<?php // locked');
	writeFile(root, 'graders/hidden.php', '<?php // hidden');
	writeFile(root, 'docs/.gitkeep', '');
	writeFile(root, '.gitignore', 'docs/ignored.txt\n');
	writeFile(root, 'README.md', '# fixture\n');
	git(root, ['add', '.']);
	git(root, ['commit', '-qm', 'initial']);
	return root;
}

function runCase(name, mutate, expectPassed, expectedReason = null) {
	const root = makeRepo();
	mutate(root);
	const result = checkWorkspacePolicy({ workspaceRoot: root, policy });
	const reasons = result.violations.map((violation) => violation.reason);

	if (result.passed !== expectPassed) {
		throw new Error(`${name}: expected passed=${expectPassed}, got ${JSON.stringify(result)}`);
	}

	if (expectedReason && !reasons.includes(expectedReason)) {
		throw new Error(`${name}: expected reason ${expectedReason}, got ${JSON.stringify(result)}`);
	}

	console.log(`${name}: ${result.passed ? 'pass' : `fail (${reasons.join(', ')})`}`);
}

runCase('allowed plugin write', (root) => {
	writeFile(root, 'plugins/solution.php', '<?php // ok');
}, true);

runCase('hidden path write', (root) => {
	writeFile(root, 'scripts/changed.php', '<?php // hidden');
}, false, 'hidden_path');

runCase('repo root write', (root) => {
	writeFile(root, 'README.md', '# changed\n');
}, false, 'non_writable_path');

runCase('symlink to hidden path', (root) => {
	fs.symlinkSync('../graders/hidden.php', path.join(root, 'plugins/grader-link.php'));
}, false, 'symlink');

runCase('symlink outside workspace', (root) => {
	const outside = path.join(os.tmpdir(), `wp-gym-policy-outside-${process.pid}.php`);
	fs.writeFileSync(outside, '<?php // outside');
	fs.symlinkSync(outside, path.join(root, 'plugins/outside-link.php'));
}, false, 'symlink');

runCase('tracked symlink mode', (root) => {
	fs.symlinkSync('../README.md', path.join(root, 'plugins/tracked-link.md'));
	git(root, ['add', 'plugins/tracked-link.md']);
}, false, 'tracked_symlink');

runCase('gitlink submodule mode', (root) => {
	const submoduleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-gym-policy-submodule-'));
	git(submoduleRoot, ['init', '-q']);
	git(submoduleRoot, ['config', 'user.email', 'policy@example.test']);
	git(submoduleRoot, ['config', 'user.name', 'Policy Test']);
	writeFile(submoduleRoot, 'README.md', '# submodule\n');
	git(submoduleRoot, ['add', '.']);
	git(submoduleRoot, ['commit', '-qm', 'initial']);
	git(root, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', submoduleRoot, 'plugins/submodule']);
}, false, 'gitlink');

runCase('nested git metadata', (root) => {
	writeFile(root, 'plugins/vendor/.git/config', '[core]\nrepositoryformatversion = 0\n');
}, false, 'nested_git_metadata');

runCase('special file in writable root', (root) => {
	const fifo = path.join(root, 'plugins/socket-like-fifo');
	execFileSync('mkfifo', [fifo]);
}, false, 'non_regular_file');

runCase('hidden delete', (root) => {
	fs.unlinkSync(path.join(root, 'scripts/locked.php'));
}, false, 'hidden_path');

runCase('hidden rename into writable root', (root) => {
	git(root, ['mv', 'scripts/locked.php', 'plugins/locked.php']);
}, false, 'hidden_path');

runCase('ignored hidden path write', (root) => {
	writeFile(root, 'docs/ignored.txt', 'ignored but hidden\n');
}, false, 'hidden_path');

runCase('committed hidden path change', (root) => {
	writeFile(root, 'scripts/locked.php', '<?php // changed hidden');
	git(root, ['add', 'scripts/locked.php']);
}, false, 'hidden_path');

{
	const root = makeRepo();
	writeFile(root, 'plugins/solution.php', '<?php // ok');
	const result = checkWorkspacePolicy({
		workspaceRoot: root,
		policy: {
			...policy,
			writableRoots: [],
		},
	});
	const reasons = result.violations.map((violation) => violation.reason);
	if (result.passed || !reasons.includes('no_writable_roots')) {
		throw new Error(`empty writable roots: expected no_writable_roots, got ${JSON.stringify(result)}`);
	}
	console.log(`empty writable roots: fail (${reasons.join(', ')})`);
}

{
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-gym-policy-no-git-'));
	fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });
	const result = checkWorkspacePolicy({ workspaceRoot: root, policy });
	const reasons = result.violations.map((violation) => violation.reason);
	if (result.passed || !reasons.includes('missing_git_root')) {
		throw new Error(`missing git root: expected missing_git_root, got ${JSON.stringify(result)}`);
	}
	console.log(`missing git root: fail (${reasons.join(', ')})`);
}
