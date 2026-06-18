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
const pilotFamilies = [
	{
		entryId: 'block-markup-valid-semantic-blocks-held-out-v1',
		scenarioId: 'block-markup-valid-semantic-blocks-held-out',
		parentScenarioId: 'block-markup-valid-semantic-blocks',
		variantFamily: 'block-markup-cookout-page',
		variantSeed: 'held-out-v1',
		label: 'Private cookout page variant',
		capabilities: { schema_version: 1, primary: 'gutenberg_blocks', secondary: ['theme_site_building'], criteria: ['held_out_private_resolution'] },
		environment: { uses_workspace: false, allowed_tools: [], writable_roots: [], hidden_paths: ['graders/', 'scenarios/', 'prompts/', 'checks/', 'task-sets/'], workspace_template: '', completion_policy: { type: 'agent_final_response' } },
	},
	{
		entryId: 'block-markup-no-fallback-pricing-section-held-out-v1',
		scenarioId: 'block-markup-no-fallback-pricing-section-held-out',
		parentScenarioId: 'block-markup-no-fallback-pricing-section',
		variantFamily: 'block-markup-pricing-page',
		variantSeed: 'held-out-v1',
		label: 'Private pricing page variant',
		capabilities: { schema_version: 1, primary: 'gutenberg_blocks', secondary: ['theme_site_building'], criteria: ['held_out_private_resolution'] },
		environment: { uses_workspace: false, allowed_tools: [], writable_roots: [], hidden_paths: ['graders/', 'scenarios/', 'prompts/', 'checks/', 'task-sets/'], workspace_template: '', completion_policy: { type: 'agent_final_response' } },
	},
	{
		entryId: 'modern-wordpress-api-abilities-site-summary-held-out-v1',
		scenarioId: 'modern-wordpress-api-abilities-site-summary-held-out',
		parentScenarioId: 'modern-wordpress-api-abilities-site-summary',
		variantFamily: 'modern-wordpress-api-site-summary',
		variantSeed: 'held-out-v1',
		label: 'Private ability summary variant',
		capabilities: { schema_version: 1, primary: 'agent_tooling_automation_surfaces', secondary: ['plugin_quality_wordpress_standards'], criteria: ['held_out_private_resolution'] },
		environment: {
			uses_workspace: true,
			allowed_tools: ['workspace_show', 'workspace_ls', 'workspace_read', 'workspace_grep', 'workspace_write', 'workspace_edit', 'workspace_apply_patch', 'workspace_git_status', 'wordpress_runtime_ls', 'run_wp_cli'],
			writable_roots: ['plugins/'],
			hidden_paths: ['graders/', 'scenarios/', 'prompts/', 'checks/', 'task-sets/', '.github/', 'docs/', 'scripts/'],
			workspace_template: 'starter-workspaces/modern-wordpress-api',
			completion_policy: { type: 'explicit_final_response' },
		},
	},
	{
		entryId: 'modern-wordpress-api-rest-route-status-held-out-v1',
		scenarioId: 'modern-wordpress-api-rest-route-status-held-out',
		parentScenarioId: 'modern-wordpress-api-rest-route-status',
		variantFamily: 'modern-wordpress-api-rest-status',
		variantSeed: 'held-out-v1',
		label: 'Private REST status variant',
		capabilities: { schema_version: 1, primary: 'data_interaction_apis', secondary: ['plugin_quality_wordpress_standards'], criteria: ['held_out_private_resolution'] },
		environment: {
			uses_workspace: true,
			allowed_tools: ['workspace_show', 'workspace_ls', 'workspace_read', 'workspace_grep', 'workspace_write', 'workspace_edit', 'workspace_apply_patch', 'workspace_git_status', 'wordpress_runtime_ls', 'run_wp_cli'],
			writable_roots: ['plugins/'],
			hidden_paths: ['graders/', 'scenarios/', 'prompts/', 'checks/', 'task-sets/', '.github/', 'docs/', 'scripts/'],
			workspace_template: 'starter-workspaces/modern-wordpress-api',
			completion_policy: { type: 'explicit_final_response' },
		},
	},
];

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
	const manifestFile = path.join(privateRoot, 'manifest.json');
	const entries = [];
	const hashesByEntry = new Map();

	for (const family of pilotFamilies) {
		const entryRoot = path.join(privateRoot, family.entryId);
		const scenarioFile = path.join(entryRoot, 'scenario.json');
		const promptFile = path.join(entryRoot, 'prompt.md');
		const graderFile = path.join(entryRoot, 'grader.php');
		const setupFile = path.join(entryRoot, 'setup.json');
		const expectedFile = path.join(entryRoot, 'expected-artifacts.json');
		const replayFile = path.join(entryRoot, 'replay-contract.json');

		writeJson(scenarioFile, {
			id: family.scenarioId,
			label: family.label,
			environment: {
				...family.environment,
				truncation_policy: {
					max_turns: family.environment.uses_workspace ? 25 : 12,
					step_budget: family.environment.uses_workspace ? 12 : 16,
					time_budget_ms: 600000,
				},
			},
			capabilities: family.capabilities,
			calibration: {
				status: 'benchmark_ready',
				benchmark_scope: 'benchmark',
				headline_score_eligible: true,
				held_out_private_variants_ready: true,
				task_contract_level: 'benchmark_replay',
				difficulty_band: 'medium',
				baseline_result_sets: [`${family.entryId}-baseline`],
				calibration_result_sets: [`${family.entryId}-calibration`],
				pass_rate_band: 'balanced',
				confidence_interval_95: [0.7, 0.9],
				benchmark_metadata: {
					benchmark_version: 'pilot-held-out-private@1.0.0',
					compatibility_group: 'pilot-held-out-private-v1',
				},
				benchmark_blockers: [],
			},
		});
		writeFile(promptFile, `${secretNeedle}:${family.entryId}: build the hidden pilot variant.\n`);
		writeFile(graderFile, "<?php\nreturn array( 'success' => true );\n");
		writeJson(setupFile, { wordpress: 'synthetic', parent_scenario_id: family.parentScenarioId });
		writeJson(expectedFile, { checks: ['synthetic'], parent_scenario_id: family.parentScenarioId });
		writeJson(replayFile, { contract: 'synthetic-private-replay', parent_scenario_id: family.parentScenarioId });

		const hashes = {
			scenario_manifest: sha256File(scenarioFile),
			prompt: sha256File(promptFile),
			grader: sha256File(graderFile),
			setup: sha256File(setupFile),
			expected_artifacts: sha256File(expectedFile),
			replay_contract: sha256File(replayFile),
		};
		hashesByEntry.set(family.entryId, hashes);
		entries.push({
			id: family.entryId,
			scenario_id: family.scenarioId,
			parent_scenario_id: family.parentScenarioId,
			variant_family: family.variantFamily,
			variant_seed: family.variantSeed,
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
				{ name: 'scenario_manifest', kind: 'json', path_or_url: `${family.entryId}/scenario.json`, sha256: hashes.scenario_manifest, sharing_level: 'private_lab', redaction_status: 'raw_private' },
				{ name: 'prompt', kind: 'markdown', path_or_url: `${family.entryId}/prompt.md`, sha256: hashes.prompt, sharing_level: 'private_lab', redaction_status: 'raw_private' },
				{ name: 'grader', kind: 'php', path_or_url: `${family.entryId}/grader.php`, sha256: hashes.grader, sharing_level: 'private_lab', redaction_status: 'raw_private' },
				{ name: 'setup', kind: 'json', path_or_url: `${family.entryId}/setup.json`, sha256: hashes.setup, sharing_level: 'private_lab', redaction_status: 'raw_private' },
				{ name: 'expected_artifacts', kind: 'json', path_or_url: `${family.entryId}/expected-artifacts.json`, sha256: hashes.expected_artifacts, sharing_level: 'private_lab', redaction_status: 'raw_private' },
				{ name: 'replay_contract', kind: 'json', path_or_url: `${family.entryId}/replay-contract.json`, sha256: hashes.replay_contract, sharing_level: 'private_lab', redaction_status: 'raw_private' },
			],
		});
	}

	writeJson(manifestFile, {
		schema_version: 1,
		pack: {
			id: 'pilot-held-out-private',
			version: '1.0.0',
			label: 'Synthetic pilot held-out private pack fixture',
			compatibility_group: 'pilot-held-out-private-v1',
			created_at: '2026-05-29T00:00:00Z',
			public_reference: 'held-out-pack:pilot-held-out-private@1.0.0',
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
		entries,
	});

	return { manifestFile, hashesByEntry };
}

function createSyntheticEvalArtifact(file, row, hashes) {
	const baseName = path.basename(file, '.json');
	const referenceDir = path.join(path.dirname(file), 'references');
	const resultReferenceFile = path.join(referenceDir, `${baseName}.result.json`);
	const replayReferenceFile = path.join(referenceDir, `${baseName}.replay.json`);
	const eventsReferenceFile = path.join(referenceDir, `${baseName}.events.json`);
	const graderPayload = {
		success: true,
		reward: 1,
		grade: { score: 1, max_score: 1 },
		checks: [{ id: 'synthetic_private_passed', passed: true, score: 1, max_score: 1, failure_reason: null, message: null }],
		failure_reasons: [],
	};
	writeJson(resultReferenceFile, { ok: true, row: row.task_id, grader: graderPayload });
	writeJson(replayReferenceFile, { replay: true, row: row.task_id });
	writeJson(eventsReferenceFile, { events: [], row: row.task_id });
	const reference = (filePath, kind) => ({
		kind,
		path_or_url: path.relative(path.dirname(file), filePath).replace(/\\/g, '/'),
		sha256: sha256File(filePath),
		sharing_level: 'public_report',
		redaction_status: 'not_needed',
	});
	const resultReference = reference(resultReferenceFile, 'json');
	const replayReference = reference(replayReferenceFile, 'json');
	const eventsReference = reference(eventsReferenceFile, 'jsonl');
	const provenance = JSON.parse(row.provenance);
	provenance.workflow.sha = 'b'.repeat(40);
	provenance.workflow.ref = provenance.workflow.sha;
	provenance.runner.sha = 'c'.repeat(40);
	provenance.runner.ref = provenance.runner.sha;
	provenance.runtime.wordpress_version = '6.9-alpha';
	provenance.runtime.php_version = '8.4.0';
	provenance.runtime.wp_codebox_version = 'synthetic-held-out-validation';
	provenance.tool_policy.sha256 = hashes.setup;
	provenance.tool_policy.agent_instructions_sha256 = hashes.replay_contract;
	provenance.inputs.task_set_sha256 = hashes.scenario_manifest;
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
			bundle_sha256: provenance.inputs.bundle_sha256,
			tool_policy_sha256: provenance.tool_policy.sha256,
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
			rules: { general: [], task_specific: [] },
			calibration: {
				status: 'benchmark_ready',
				benchmark_scope: 'benchmark',
				headline_score_eligible: true,
				held_out_private_variants_ready: true,
			},
		},
		task_set: {
			id: 'pilot-held-out-private',
			label: 'Synthetic pilot held-out private pack fixture',
			source_path: `sealed://${row.held_out_pack.public_reference}/task-set`,
			sha256: hashes.scenario_manifest,
			version: 'pilot-held-out-private@1.0.0',
			benchmark_status: 'benchmark_ready',
			headline_score_eligible: true,
			aggregate_score: true,
			benchmark: true,
			compatibility_group: 'pilot-held-out-private-v1',
		},
		held_out: row.held_out_pack,
		isolation: {
			hidden_evidence_boundaries: {
				covered_evidence_kinds: ['hidden_grader', 'held_out_variant', 'private_fixture', 'expected_answer', 'task_policy_internal'],
				surfaces: [
					{ name: 'prompt', status: 'pass', findings: [] },
					{ name: 'tools', status: 'pass', findings: [] },
					{ name: 'workspace', status: 'pass', findings: [] },
					{ name: 'artifacts', status: 'pass', findings: [] },
					{ name: 'report_body', status: 'pass', findings: [] },
				],
				benchmark_mode_eligible: true,
				accepted_exposures: [],
			},
		},
		provenance,
		grader: graderPayload,
		reports: {
			result_json: [resultReference],
			replay: [replayReference],
		},
		runtime: {
			artifact_bundle: {
				id: 'synthetic-held-out-bundle',
				schema_version: '1',
				created_at: '2026-05-29T00:00:00Z',
				runtime_id: 'wp-codebox',
				environment_id: 'synthetic-private-lab',
			},
			references: {
				events: [eventsReference],
				replay_bundle: [replayReference],
			},
		},
		eval_artifact: {
			kind: 'json',
			path_or_url: `sealed://benchmark-artifacts/${hashes.scenario_manifest}/${row.provider_label}`,
			sha256: hashes.scenario_manifest,
			media_type: 'application/json',
		},
	});
}

function assertPublicSafePilotIndex() {
	const index = readJson(path.join(root, 'fixtures', 'held-out-packs', 'public-safe-pack-index.json'));
	const expectedParents = new Set(pilotFamilies.map((family) => family.parentScenarioId));
	const actualParents = new Set((index.entries || []).map((entry) => entry.parent_scenario_id));
	for (const parentScenarioId of expectedParents) {
		if (!actualParents.has(parentScenarioId)) {
			throw new Error(`Public-safe held-out pack index is missing ${parentScenarioId}.`);
		}
	}
	if (JSON.stringify(index).includes(secretNeedle)) {
		throw new Error('Public-safe held-out pack index leaked private fixture text.');
	}
}

async function main() {
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-gym-held-out-'));
	try {
		assertPublicSafePilotIndex();
		const { manifestFile, hashesByEntry } = createSyntheticPrivatePack(temp);
		const validation = validatePackManifest(readJson(manifestFile), manifestFile, { requireLocalArtifacts: true });
		if (!validation.ok) {
			throw new Error(`Synthetic private pack failed validation: ${validation.compatibility_gaps.map((gap) => gap.code).join(', ')}`);
		}

		const dryRunSummary = publicHeldOutPackSummary(manifestFile);
		if (dryRunSummary.entries.length !== pilotFamilies.length) {
			throw new Error(`Dry-run summary expected ${pilotFamilies.length} held-out entries, got ${dryRunSummary.entries.length}.`);
		}
		const dryRun = JSON.stringify(dryRunSummary);
		if (dryRun.includes(secretNeedle) || dryRun.includes(temp)) {
			throw new Error('Dry-run summary leaked private prompt text or private filesystem paths.');
		}

		const dryMatrix = run('node', ['scripts/resolve-live-run-matrix.mjs', '--check'], {
			env: { WP_GYM_HELD_OUT_PACK: manifestFile, ANTHROPIC_PROVIDER_SHA: 'a'.repeat(40) },
		});
		if (dryMatrix.stdout.includes(secretNeedle) || dryMatrix.stdout.includes(temp)) {
			throw new Error('Held-out matrix dry-run leaked private prompt text or private filesystem paths.');
		}

		const githubOutput = path.join(temp, 'github-output.txt');
		run('node', ['scripts/resolve-live-run-matrix.mjs'], {
			env: { WP_GYM_HELD_OUT_PACK: manifestFile, ANTHROPIC_PROVIDER_SHA: 'a'.repeat(40), GITHUB_OUTPUT: githubOutput },
		});
		const output = fs.readFileSync(githubOutput, 'utf8');
		const matrix = JSON.parse(output.replace(/^matrix=/, '').trim());
		if (matrix.include.length !== pilotFamilies.length * 2) {
			throw new Error(`Live held-out matrix expected ${pilotFamilies.length * 2} rows, got ${matrix.include.length}.`);
		}
		const row = matrix.include.find((item) => item.provider === 'openai');
		if (!row || !row.prompt.includes(secretNeedle) || row.workload_run_after === '[redacted-held-out-private-grader]') {
			throw new Error('Live held-out matrix did not resolve private runner inputs through GITHUB_OUTPUT.');
		}
		const fullMatrix = JSON.parse(run('node', ['scripts/resolve-live-run-matrix.mjs'], {
			env: { WP_GYM_HELD_OUT_PACK: manifestFile, ANTHROPIC_PROVIDER_SHA: 'a'.repeat(40), WP_GYM_PRINT_PRIVATE_HELD_OUT: 'true' },
		}).stdout);
		if (fullMatrix.include.length !== pilotFamilies.length * 2 || fullMatrix.include.some((item) => !item.benchmark_eligible)) {
			throw new Error('Full held-out matrix did not preserve benchmark-ready metadata.');
		}

		const evalDir = path.join(temp, 'eval-artifacts');
		for (const matrixRow of fullMatrix.include) {
			const hashes = hashesByEntry.get(matrixRow.held_out_pack.entry_id);
			if (!hashes) {
				throw new Error(`Missing hashes for ${matrixRow.held_out_pack.entry_id}.`);
			}
			createSyntheticEvalArtifact(path.join(evalDir, `${matrixRow.provider_label}-${matrixRow.task_id}.json`), matrixRow, hashes);
		}
		const registryDir = path.join(temp, 'registry');
		run('node', ['scripts/emit-run-registry.mjs', '--input', evalDir, '--output', registryDir, '--benchmark-mode', '--require-entry']);
		const reportFile = path.join(temp, 'held-out-report.json');
		run('node', ['scripts/aggregate-run-registry.mjs', '--registry', path.join(registryDir, 'entries'), '--scope', 'headline', '--benchmark-mode', '--json', reportFile]);
		const report = readJson(reportFile);
		if (report.overall.runs !== matrix.include.length || report.rows.some((item) => !hashesByEntry.get(item.held_out_pack.entry_id) || item.held_out_pack.sealed_hashes.prompt !== hashesByEntry.get(item.held_out_pack.entry_id).prompt)) {
			throw new Error('Aggregate held-out report did not preserve public-safe sealed hashes.');
		}
		const publicReport = JSON.stringify(report);
		if (publicReport.includes(secretNeedle) || publicReport.includes(temp)) {
			throw new Error('Aggregate held-out report leaked private prompt text or private filesystem paths.');
		}

		console.log(JSON.stringify({ ok: true, pilot_private_entries: pilotFamilies.length, validated_private_pack: true, dry_run_redacted: true, live_matrix_resolved: true, aggregate_report_public_safe: true }, null, 2));
	} finally {
		fs.rmSync(temp, { recursive: true, force: true });
	}
}

await main();
