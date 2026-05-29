import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publicHeldOutPackSummary } from './resolve-held-out-pack.mjs';
import { validatePackManifest } from './validate-held-out-packs.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const secretNeedle = 'PRIVATE_HELD_OUT_SYNTHETIC_PROMPT_DO_NOT_PRINT';

function writeFile(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, value);
}

function writeJson(file, value) {
	writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256File(file) {
	return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: root,
		env: { ...process.env, ...options.env },
		encoding: 'utf8',
	});
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
	}
	return result;
}

function createSyntheticPrivatePack(dir) {
	const privateRoot = path.join(dir, 'private-pack');
	const scenarioFile = path.join(privateRoot, 'scenario.json');
	const promptFile = path.join(privateRoot, 'prompt.md');
	const graderFile = path.join(privateRoot, 'grader.php');
	const setupFile = path.join(privateRoot, 'setup.json');
	const expectedFile = path.join(privateRoot, 'expected-artifacts.json');
	const replayFile = path.join(privateRoot, 'replay-contract.json');
	const manifestFile = path.join(privateRoot, 'manifest.json');

	writeJson(scenarioFile, {
		id: 'held-out-synthetic-scenario',
		label: 'Synthetic held-out validation scenario',
		environment: {
			uses_workspace: false,
			allowed_tools: [],
			hidden_paths: ['graders/', 'scenarios/'],
			truncation_policy: {
				max_turns: 4,
				step_budget: 6,
				time_budget_ms: 120000,
			},
		},
		capabilities: {
			schema_version: 1,
			primary: 'gutenberg_blocks',
			secondary: [],
			criteria: ['held_out_private_resolution'],
		},
		calibration: {
			status: 'benchmark_ready',
			benchmark_scope: 'benchmark',
			headline_score_eligible: true,
			held_out_private_variants_ready: true,
			task_contract_level: 'benchmark_replay',
			difficulty_band: 'medium',
			baseline_result_sets: ['synthetic-private-baseline'],
			calibration_result_sets: ['synthetic-private-calibration'],
			pass_rate_band: 'balanced',
			confidence_interval_95: [0.7, 0.9],
		},
	});
	writeFile(promptFile, `${secretNeedle}: build the hidden page variant.\n`);
	writeFile(graderFile, "<?php\nreturn array( 'success' => true );\n");
	writeJson(setupFile, { wordpress: 'synthetic' });
	writeJson(expectedFile, { checks: ['synthetic'] });
	writeJson(replayFile, { contract: 'synthetic-private-replay' });

	const hashes = {
		scenario_manifest: sha256File(scenarioFile),
		prompt: sha256File(promptFile),
		grader: sha256File(graderFile),
		setup: sha256File(setupFile),
		expected_artifacts: sha256File(expectedFile),
		replay_contract: sha256File(replayFile),
	};
	writeJson(manifestFile, {
		schema_version: 1,
		pack: {
			id: 'synthetic-held-out-pack',
			version: '1.0.0',
			label: 'Synthetic held-out private pack fixture',
			compatibility_group: 'synthetic-held-out-v1',
			created_at: '2026-05-29T00:00:00Z',
			public_reference: 'held-out-pack:synthetic-held-out-pack@1.0.0',
		},
		boundary: {
			storage: 'local_private_pack',
			public_safe_fields: ['pack_id', 'pack_version', 'compatibility_group', 'scenario_id', 'variant_family', 'variant_seed', 'sha256', 'aggregate_outcomes'],
			withheld_fields: ['prompt', 'grader', 'fixtures', 'expected_artifacts', 'replay_bundles', 'private_paths'],
			artifact_access: 'private_lab',
			public_report_policy: 'aggregate_only',
		},
		promotion_policy: {
			requires_benchmark_replay: true,
			requires_aggregate_only_public_reports: true,
			requires_version_identity: true,
			requires_hash_locked_artifacts: true,
		},
		entries: [{
			id: 'synthetic-held-out-entry',
			scenario_id: 'held-out-synthetic-scenario',
			parent_scenario_id: 'block-markup-valid-semantic-blocks',
			variant_family: 'block-markup-valid-semantic-blocks',
			variant_seed: 'synthetic-v1',
			split_membership: 'held_out_private',
			task_contract_level: 'benchmark_replay',
			calibration_status: 'benchmark_ready',
			version_identity: {
				manifest_sha256: hashes.scenario_manifest,
				prompt_sha256: hashes.prompt,
				grader_sha256: hashes.grader,
				setup_sha256: hashes.setup,
				expected_artifacts_sha256: hashes.expected_artifacts,
				replay_contract_sha256: hashes.replay_contract,
			},
			artifacts: [
				{ name: 'scenario_manifest', kind: 'json', path_or_url: 'scenario.json', sha256: hashes.scenario_manifest, sharing_level: 'private_lab', redaction_status: 'raw_private' },
				{ name: 'prompt', kind: 'markdown', path_or_url: 'prompt.md', sha256: hashes.prompt, sharing_level: 'private_lab', redaction_status: 'raw_private' },
				{ name: 'grader', kind: 'php', path_or_url: 'grader.php', sha256: hashes.grader, sharing_level: 'private_lab', redaction_status: 'raw_private' },
				{ name: 'setup', kind: 'json', path_or_url: 'setup.json', sha256: hashes.setup, sharing_level: 'private_lab', redaction_status: 'raw_private' },
				{ name: 'expected_artifacts', kind: 'json', path_or_url: 'expected-artifacts.json', sha256: hashes.expected_artifacts, sharing_level: 'private_lab', redaction_status: 'raw_private' },
				{ name: 'replay_contract', kind: 'json', path_or_url: 'replay-contract.json', sha256: hashes.replay_contract, sharing_level: 'private_lab', redaction_status: 'raw_private' }
			],
		}],
	});

	return { manifestFile, hashes };
}

function createSyntheticEvalArtifact(file, row, hashes) {
	writeJson(file, {
		schema_version: 1,
		projection: {
			name: 'wp-gym-eval-artifact',
			issue: 'https://github.com/Automattic/wp-gym/issues/117',
			created_at: '2026-05-29T00:00:00Z',
		},
		status: { outcome: 'passed', failure_class: 'none', failure_reason: null, message: null },
		runtime: {
			artifact_bundle: {
				id: 'synthetic-held-out-bundle',
				schema_version: '1',
				created_at: '2026-05-29T00:00:00Z',
				runtime_id: 'wp-codebox',
				environment_id: 'synthetic-private-lab',
			},
			references: {},
		},
		runner: {
			provider: row.provider,
			model: row.model,
			agent_slug: 'wordpress-task-runner',
			bundle_sha256: hashes.scenario_manifest,
			tool_policy_sha256: hashes.setup,
			workflow: { run_id: 'synthetic-held-out-run', run_url: 'https://github.com/Automattic/wp-gym/actions/runs/204' },
		},
		scenario: {
			id: row.task_id,
			label: row.task_label,
			source_path: `sealed://${row.held_out_pack.public_reference}/entries/${row.held_out_pack.entry_id}/scenario_manifest`,
			sha256: hashes.scenario_manifest,
			prompt_sha256: hashes.prompt,
			task_family: 'block-markup',
			capabilities: { schema_version: 1, primary: 'gutenberg_blocks', secondary: [], criteria: ['held_out_private_resolution'] },
			calibration: {
				status: 'benchmark_ready',
				benchmark_scope: 'benchmark',
				headline_score_eligible: true,
				held_out_private_variants_ready: true,
			},
		},
		task_set: {
			id: 'synthetic-held-out-pack',
			label: 'Synthetic held-out private pack fixture',
			source_path: `sealed://${row.held_out_pack.public_reference}/task-set`,
			sha256: hashes.scenario_manifest,
			version: 'synthetic-held-out-pack@1.0.0',
			benchmark_status: 'benchmark_ready',
			headline_score_eligible: true,
			aggregate_score: true,
			benchmark: true,
			compatibility_group: 'synthetic-held-out-v1',
		},
		held_out: row.held_out_pack,
		provenance: JSON.parse(row.provenance),
		grader: {
			success: true,
			reward: 1,
			grade: { score: 1, max_score: 1 },
			checks: [{ id: 'synthetic_private_passed', passed: true, score: 1, max_score: 1, failure_reason: null, message: null }],
			failure_reasons: [],
		},
		reports: {},
	});
}

async function main() {
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-gym-held-out-'));
	try {
		const { manifestFile, hashes } = createSyntheticPrivatePack(temp);
		const validation = validatePackManifest(readJson(manifestFile), manifestFile, { requireLocalArtifacts: true });
		if (!validation.ok) {
			throw new Error(`Synthetic private pack failed validation: ${validation.compatibility_gaps.map((gap) => gap.code).join(', ')}`);
		}

		const dryRun = JSON.stringify(publicHeldOutPackSummary(manifestFile));
		if (dryRun.includes(secretNeedle) || dryRun.includes(temp)) {
			throw new Error('Dry-run summary leaked private prompt text or private filesystem paths.');
		}

		const dryMatrix = run('node', ['scripts/resolve-live-run-matrix.mjs', '--check'], {
			env: { WP_GYM_HELD_OUT_PACK: manifestFile, TASK_IDS: 'synthetic-held-out-entry', ANTHROPIC_PROVIDER_SHA: 'a'.repeat(40) },
		});
		if (dryMatrix.stdout.includes(secretNeedle) || dryMatrix.stdout.includes(temp)) {
			throw new Error('Held-out matrix dry-run leaked private prompt text or private filesystem paths.');
		}

		const githubOutput = path.join(temp, 'github-output.txt');
		run('node', ['scripts/resolve-live-run-matrix.mjs'], {
			env: { WP_GYM_HELD_OUT_PACK: manifestFile, TASK_IDS: 'synthetic-held-out-entry', ANTHROPIC_PROVIDER_SHA: 'a'.repeat(40), GITHUB_OUTPUT: githubOutput },
		});
		const output = fs.readFileSync(githubOutput, 'utf8');
		const matrix = JSON.parse(output.replace(/^matrix=/, '').trim());
		const row = matrix.include.find((item) => item.provider === 'openai');
		if (!row || !row.prompt.includes(secretNeedle) || row.workload_run_after === '[redacted-held-out-private-grader]') {
			throw new Error('Live held-out matrix did not resolve private runner inputs through GITHUB_OUTPUT.');
		}

		const evalFile = path.join(temp, 'eval-artifact.json');
		createSyntheticEvalArtifact(evalFile, row, hashes);
		const registryDir = path.join(temp, 'registry');
		run('node', ['scripts/emit-run-registry.mjs', '--input', evalFile, '--output', registryDir, '--require-entry']);
		const reportFile = path.join(temp, 'held-out-report.json');
		run('node', ['scripts/aggregate-run-registry.mjs', '--registry', path.join(registryDir, 'entries'), '--scope', 'headline', '--json', reportFile]);
		const report = readJson(reportFile);
		if (report.overall.runs !== 1 || report.rows[0]?.held_out_pack?.sealed_hashes?.prompt !== hashes.prompt) {
			throw new Error('Aggregate held-out report did not preserve public-safe sealed hashes.');
		}
		const publicReport = JSON.stringify(report);
		if (publicReport.includes(secretNeedle) || publicReport.includes(temp)) {
			throw new Error('Aggregate held-out report leaked private prompt text or private filesystem paths.');
		}

		console.log(JSON.stringify({ ok: true, validated_private_pack: true, dry_run_redacted: true, live_matrix_resolved: true, aggregate_report_public_safe: true }, null, 2));
	} finally {
		fs.rmSync(temp, { recursive: true, force: true });
	}
}

await main();
