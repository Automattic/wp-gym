import { readdir, readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const root = process.cwd();
const scenarioRoot = path.join(root, 'scenarios');
const taskSetRoot = path.join(root, 'task-sets');
const requiredRepoFiles = [
	'schemas/scenario.schema.json',
	'scripts/resolve-live-run-matrix.mjs',
	'starter-workspaces/modern-wordpress-api',
];
const knownResetFixtures = new Set(['wordpress-playground-clean-site']);
const knownTools = new Set([
	'workspace_show',
	'workspace_ls',
	'workspace_read',
	'workspace_grep',
	'workspace_write',
	'workspace_edit',
	'workspace_apply_patch',
	'workspace_git_status',
	'wordpress_runtime_ls',
	'run_wp_cli',
]);
const knownActionTypes = new Set(['wp_cli', 'filesystem', 'rest', 'browser']);
const knownCompletionPolicies = new Set(['agent_final_response', 'explicit_final_response']);
const knownTerminationPolicies = new Set(['terminal_grader']);
const knownTruncationPolicies = new Set(['budget']);
const knownRewardTypes = new Set(['terminal_php_grader']);
const knownCalibrationStatuses = new Set(['demo', 'pilot', 'calibrating', 'benchmark_ready', 'deprecated', 'retired', 'excluded']);
const knownBenchmarkScopes = new Set(['demo', 'pilot', 'calibration', 'benchmark', 'excluded']);
const knownDifficultyBands = new Set(['uncalibrated', 'smoke', 'easy', 'medium', 'hard']);
const knownPassRateBands = new Set(['uncalibrated', 'too_easy', 'easy', 'target', 'hard', 'too_hard']);
const knownTaskContractLevels = new Set([
	'wordpress_state_diagnostic',
	'workspace_diff_diagnostic',
	'benchmark_replay',
]);
const knownTaskSetContractLevels = new Set([
	'mixed_diagnostic',
	'wordpress_state_diagnostic',
	'workspace_diff_diagnostic',
	'benchmark_replay',
]);
const knownScoreScopes = new Set(['demo', 'pilot', 'calibration', 'benchmark', 'excluded']);
const knownSplitMemberships = new Set(['public', 'calibration', 'validation', 'held_out_private']);
const knownGraderExposure = new Set(['full_public', 'summary_public', 'private']);
const knownProbeTypes = new Set(['rendered_site_design']);
const versionPattern = /^\d+\.\d+\.\d+(?:-[a-z0-9][a-z0-9.-]*)?$/;
const compatibilityGroupPattern = /^[a-z0-9][a-z0-9-]*$/;
const hashPattern = /^[a-f0-9]{64}$/;
const knownCapabilityAreas = new Set([
	'ai_features',
	'agent_tooling_automation_surfaces',
	'custom_admin_ui',
	'data_interaction_apis',
	'cli_operational_tooling',
	'theme_site_building',
	'gutenberg_blocks',
	'plugin_quality_wordpress_standards',
]);
const knownSourceInputTypes = new Set([
	'wordpress_core_source',
	'gutenberg_source',
	'wp_cli_source',
	'developer_docs',
	'canonical_plugin_source',
	'modern_api_repository',
]);
const knownFreshnessStatuses = new Set(['fresh', 'watch', 'stale', 'retired']);
const knownCurriculumLifecycleStatuses = new Set(['proposed', 'pilot', 'calibrating', 'benchmark_ready', 'retired']);
const isoDatePattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function assertObject(value, label) {
	if (!value || Array.isArray(value) || typeof value !== 'object') {
		throw new Error(`${label} must be an object`);
	}
}

function assertStringArray(value, label, { minItems = 0, pattern = null } = {}) {
	if (!Array.isArray(value) || value.length < minItems) {
		throw new Error(`${label} must be an array with at least ${minItems} item(s)`);
	}

	for (const entry of value) {
		if (typeof entry !== 'string' || entry.length < 1) {
			throw new Error(`${label} entries must be non-empty strings`);
		}

		if (pattern && !pattern.test(entry)) {
			throw new Error(`${label} entries have invalid format: ${entry}`);
		}
	}
}

function assertPositiveInteger(value, label) {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive integer`);
	}
}

function normalizeRepoRelativePath(value, label) {
	if (typeof value !== 'string' || value.trim().length < 1) {
		throw new Error(`${label} must be a non-empty string`);
	}

	const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '');
	if (
		normalized.startsWith('/') ||
		path.isAbsolute(normalized) ||
		normalized.split('/').includes('..')
	) {
		throw new Error(`${label} must be a repo-relative path without traversal: ${value}`);
	}

	return normalized;
}

function resolveRepoContained(fromFile, candidate, label) {
	if (typeof candidate !== 'string' || candidate.length < 1) {
		throw new Error(`${label} must be a non-empty string`);
	}

	const resolved = path.resolve(root, path.dirname(fromFile), candidate);
	const relative = path.relative(root, resolved);

	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(`${label} resolves outside the repository: ${candidate}`);
	}

	return relative.replace(/\\/g, '/');
}

function pathsOverlap(left, right) {
	return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function assertKnown(value, knownValues, label) {
	if (!knownValues.has(value)) {
		throw new Error(`${label} has unknown value: ${value}`);
	}
}

function validateBenchmarkMetadata(metadata, label, { requireVersionIdentity = false } = {}) {
	assertObject(metadata, `${label} benchmark_metadata`);

	if (typeof metadata.benchmark_version !== 'string' || !versionPattern.test(metadata.benchmark_version)) {
		throw new Error(`${label} benchmark_metadata.benchmark_version must be semver-like`);
	}
	if (typeof metadata.compatibility_group !== 'string' || !compatibilityGroupPattern.test(metadata.compatibility_group)) {
		throw new Error(`${label} benchmark_metadata.compatibility_group must be kebab-case`);
	}

	if (metadata.compatible_with !== undefined) {
		assertStringArray(metadata.compatible_with, `${label} benchmark_metadata.compatible_with`);
	}

	if (metadata.version_identity !== undefined || requireVersionIdentity) {
		assertObject(metadata.version_identity, `${label} benchmark_metadata.version_identity`);
		for (const field of ['manifest_sha256', 'prompt_sha256', 'grader_sha256', 'setup_sha256', 'expected_artifacts_sha256', 'replay_contract_sha256']) {
			if (typeof metadata.version_identity[field] !== 'string' || !hashPattern.test(metadata.version_identity[field])) {
				throw new Error(`${label} benchmark_metadata.version_identity.${field} must be a sha256 hex digest`);
			}
		}
	}
}

function assertIsoDate(value, label) {
	if (typeof value !== 'string' || !isoDatePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
		throw new Error(`${label} must be an ISO date in YYYY-MM-DD format`);
	}
}

function assertNonEmptyString(value, label) {
	if (typeof value !== 'string' || value.length < 1) {
		throw new Error(`${label} must be a non-empty string`);
	}
}

for (const repoFile of requiredRepoFiles) {
	if (!existsSync(path.join(root, repoFile))) {
		throw new Error(`Required repository contract file is missing: ${repoFile}`);
	}
}

function validateScenarioContract(file, manifest) {
	if (!Number.isInteger(manifest.schema_version) || manifest.schema_version < 1) {
		throw new Error(`${file} must declare schema_version as a positive integer`);
	}

	if (Array.isArray(manifest.tags) && manifest.tags.includes('modern-api') && !manifest.api_provenance) {
		throw new Error(`${file} modern-api scenarios must declare api_provenance`);
	}

	if (manifest.api_provenance !== undefined) {
		validateApiProvenance(file, manifest.api_provenance);
	}

	validateScenarioCapabilities(file, manifest.capabilities);

	assertObject(manifest.environment, `${file} environment`);
	assertObject(manifest.split, `${file} split`);
	assertKnown(manifest.split.membership, knownSplitMemberships, `${file} split.membership`);
	if (typeof manifest.split.variant_family !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.split.variant_family)) {
		throw new Error(`${file} split.variant_family must be kebab-case`);
	}
	if (typeof manifest.split.variant_seed !== 'string' || !/^[a-z0-9][a-z0-9_.-]*$/.test(manifest.split.variant_seed)) {
		throw new Error(`${file} split.variant_seed must be a stable non-secret seed label`);
	}
	if (
		manifest.split.parent_scenario_id !== undefined &&
		manifest.split.parent_scenario_id !== null &&
		(typeof manifest.split.parent_scenario_id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(manifest.split.parent_scenario_id))
	) {
		throw new Error(`${file} split.parent_scenario_id must be null or a scenario id`);
	}
	assertObject(manifest.split.artifact_policy, `${file} split.artifact_policy`);
	assertStringArray(manifest.split.artifact_policy.public_artifacts, `${file} split.artifact_policy.public_artifacts`, {
		pattern: /^[a-z0-9_]+$/,
	});
	assertStringArray(manifest.split.artifact_policy.private_artifacts, `${file} split.artifact_policy.private_artifacts`, {
		pattern: /^[a-z0-9_]+$/,
	});
	assertKnown(manifest.split.artifact_policy.grader_exposure, knownGraderExposure, `${file} split.artifact_policy.grader_exposure`);
	if (manifest.split.membership === 'held_out_private') {
		if (!manifest.split.parent_scenario_id) {
			throw new Error(`${file} held-out private variants must declare split.parent_scenario_id`);
		}
		if (manifest.split.artifact_policy.grader_exposure !== 'private') {
			throw new Error(`${file} held-out private variants must keep grader_exposure=private`);
		}
	}

	const environment = manifest.environment;
	if (!['wordpress', 'workspace'].includes(environment.action_mode)) {
		throw new Error(`${file} environment.action_mode must be wordpress or workspace`);
	}

	if (typeof environment.uses_workspace !== 'boolean') {
		throw new Error(`${file} environment.uses_workspace must be a boolean`);
	}

	if (environment.uses_workspace !== (environment.action_mode === 'workspace')) {
		throw new Error(`${file} environment.uses_workspace must match action_mode=workspace`);
	}

	if (typeof environment.reset_fixture !== 'string' || environment.reset_fixture.length < 1) {
		throw new Error(`${file} environment.reset_fixture must be a non-empty string`);
	}
	assertKnown(environment.reset_fixture, knownResetFixtures, `${file} environment.reset_fixture`);

	assertStringArray(environment.observation_channels, `${file} environment.observation_channels`, {
		minItems: 1,
		pattern: /^[a-z0-9_]+$/,
	});
	assertStringArray(environment.allowed_tools, `${file} environment.allowed_tools`, {
		pattern: /^[a-z0-9_]+$/,
	});
	assertStringArray(environment.writable_roots, `${file} environment.writable_roots`);
	assertStringArray(environment.hidden_paths, `${file} environment.hidden_paths`);

	for (const tool of environment.allowed_tools) {
		assertKnown(tool, knownTools, `${file} environment.allowed_tools`);
	}

	const writableRoots = environment.writable_roots.map((entry) =>
		normalizeRepoRelativePath(entry, `${file} environment.writable_roots entry`)
	);
	const hiddenPaths = environment.hidden_paths.map((entry) =>
		normalizeRepoRelativePath(entry, `${file} environment.hidden_paths entry`)
	);

	for (const [index, entry] of writableRoots.entries()) {
		if (writableRoots.indexOf(entry) !== index) {
			throw new Error(`${file} environment.writable_roots contains duplicate path: ${entry}`);
		}
	}

	for (const [index, entry] of hiddenPaths.entries()) {
		if (hiddenPaths.indexOf(entry) !== index) {
			throw new Error(`${file} environment.hidden_paths contains duplicate path: ${entry}`);
		}
	}

	for (const writableRoot of writableRoots) {
		for (const hiddenPath of hiddenPaths) {
			if (pathsOverlap(writableRoot, hiddenPath)) {
				throw new Error(`${file} hidden path overlaps writable root: ${hiddenPath} / ${writableRoot}`);
			}
		}
	}

	if (
		environment.workspace_template !== null &&
		typeof environment.workspace_template !== 'string'
	) {
		throw new Error(`${file} environment.workspace_template must be a string or null`);
	}

	if (typeof environment.workspace_template === 'string') {
		const workspaceTemplate = normalizeRepoRelativePath(
			environment.workspace_template,
			`${file} environment.workspace_template`
		);
		const workspaceTemplatePath = path.join(root, workspaceTemplate);

		if (!existsSync(workspaceTemplatePath)) {
			throw new Error(`${file} environment.workspace_template does not exist: ${workspaceTemplate}`);
		}

		if (environment.uses_workspace) {
			const stat = statSync(workspaceTemplatePath);
			if (!stat.isDirectory()) {
				throw new Error(`${file} environment.workspace_template must be a directory: ${workspaceTemplate}`);
			}
		}
	}

	if (environment.uses_workspace) {
		if (!environment.workspace_template) {
			throw new Error(`${file} workspace scenarios must declare environment.workspace_template`);
		}

		if (environment.writable_roots.length < 1) {
			throw new Error(`${file} workspace scenarios must declare at least one writable root`);
		}
	}

	for (const field of ['completion_policy', 'termination_policy', 'truncation_policy']) {
		assertObject(environment[field], `${file} environment.${field}`);
		if (typeof environment[field].type !== 'string' || environment[field].type.length < 1) {
			throw new Error(`${file} environment.${field}.type must be a non-empty string`);
		}
	}
	assertKnown(environment.completion_policy.type, knownCompletionPolicies, `${file} environment.completion_policy.type`);
	assertKnown(environment.termination_policy.type, knownTerminationPolicies, `${file} environment.termination_policy.type`);
	assertKnown(environment.truncation_policy.type, knownTruncationPolicies, `${file} environment.truncation_policy.type`);

	for (const field of ['max_turns', 'step_budget', 'time_budget_ms']) {
		assertPositiveInteger(environment.truncation_policy[field], `${file} environment.truncation_policy.${field}`);
	}

	assertObject(manifest.reward_spec, `${file} reward_spec`);
	if (typeof manifest.reward_spec.type !== 'string' || manifest.reward_spec.type.length < 1) {
		throw new Error(`${file} reward_spec.type must be a non-empty string`);
	}
	assertKnown(manifest.reward_spec.type, knownRewardTypes, `${file} reward_spec.type`);
	if (typeof manifest.reward_spec.success_threshold !== 'number') {
		throw new Error(`${file} reward_spec.success_threshold must be a number`);
	}
	if (
		!Array.isArray(manifest.reward_spec.reward_range) ||
		manifest.reward_spec.reward_range.length !== 2 ||
		!manifest.reward_spec.reward_range.every((value) => typeof value === 'number')
	) {
		throw new Error(`${file} reward_spec.reward_range must contain two numbers`);
	}
	if (manifest.reward_spec.reward_range[0] >= manifest.reward_spec.reward_range[1]) {
		throw new Error(`${file} reward_spec.reward_range must be ordered low-to-high`);
	}
	if (
		manifest.reward_spec.success_threshold < manifest.reward_spec.reward_range[0] ||
		manifest.reward_spec.success_threshold > manifest.reward_spec.reward_range[1]
	) {
		throw new Error(`${file} reward_spec.success_threshold must be within reward_range`);
	}

	assertStringArray(manifest.expected_artifacts, `${file} expected_artifacts`, {
		minItems: 1,
		pattern: /^[a-z0-9_]+$/,
	});

	assertObject(manifest.episode_contract, `${file} episode_contract`);
	if (manifest.episode_contract.schema_version !== 1) {
		throw new Error(`${file} episode_contract.schema_version must be 1`);
	}
	assertStringArray(manifest.episode_contract.allowed_action_types, `${file} episode_contract.allowed_action_types`, {
		minItems: 1,
	});
	for (const actionType of manifest.episode_contract.allowed_action_types) {
		assertKnown(actionType, knownActionTypes, `${file} episode_contract.allowed_action_types`);
	}
	assertPositiveInteger(manifest.episode_contract.max_steps, `${file} episode_contract.max_steps`);
	assertStringArray(manifest.episode_contract.setup, `${file} episode_contract.setup`, { minItems: 1 });
	assertStringArray(manifest.episode_contract.success_checks, `${file} episode_contract.success_checks`, {
		minItems: 1,
		pattern: /^[a-z0-9_]+$/,
	});

	assertObject(manifest.calibration, `${file} calibration`);
	assertKnown(manifest.calibration.status, knownCalibrationStatuses, `${file} calibration.status`);
	assertKnown(manifest.calibration.benchmark_scope, knownBenchmarkScopes, `${file} calibration.benchmark_scope`);
	assertKnown(manifest.calibration.difficulty_band, knownDifficultyBands, `${file} calibration.difficulty_band`);
	if (typeof manifest.calibration.headline_score_eligible !== 'boolean') {
		throw new Error(`${file} calibration.headline_score_eligible must be a boolean`);
	}
	assertStringArray(manifest.calibration.baseline_result_sets, `${file} calibration.baseline_result_sets`);
	if (manifest.calibration.calibration_result_sets !== undefined) {
		assertStringArray(manifest.calibration.calibration_result_sets, `${file} calibration.calibration_result_sets`);
	}
	if (manifest.calibration.pass_rate_band !== undefined) {
		assertKnown(manifest.calibration.pass_rate_band, knownPassRateBands, `${file} calibration.pass_rate_band`);
	}
	if (manifest.calibration.confidence_interval_95 !== undefined) {
		if (
			!Array.isArray(manifest.calibration.confidence_interval_95) ||
			manifest.calibration.confidence_interval_95.length !== 2 ||
			!manifest.calibration.confidence_interval_95.every((value) => typeof value === 'number' && value >= 0 && value <= 1) ||
			manifest.calibration.confidence_interval_95[0] > manifest.calibration.confidence_interval_95[1]
		) {
			throw new Error(`${file} calibration.confidence_interval_95 must be an ordered [low, high] pair between 0 and 1`);
		}
	}
	if (
		manifest.calibration.held_out_private_variants_ready !== undefined &&
		typeof manifest.calibration.held_out_private_variants_ready !== 'boolean'
	) {
		throw new Error(`${file} calibration.held_out_private_variants_ready must be a boolean`);
	}
	assertStringArray(manifest.calibration.known_shortcuts, `${file} calibration.known_shortcuts`, {
		pattern: /^[a-z0-9_]+$/,
	});
	assertKnown(manifest.calibration.task_contract_level, knownTaskContractLevels, `${file} calibration.task_contract_level`);
	assertStringArray(manifest.calibration.benchmark_blockers, `${file} calibration.benchmark_blockers`, {
		pattern: /^[a-z0-9_]+$/,
	});
	if (manifest.calibration.benchmark_metadata !== undefined) {
		validateBenchmarkMetadata(manifest.calibration.benchmark_metadata, `${file} calibration`);
	}
	if (manifest.calibration.status === 'benchmark_ready') {
		if (!manifest.calibration.headline_score_eligible) {
			throw new Error(`${file} benchmark_ready scenarios must be headline_score_eligible`);
		}
		if (manifest.calibration.baseline_result_sets.length < 1) {
			throw new Error(`${file} benchmark_ready scenarios must declare baseline_result_sets`);
		}
		if (!Array.isArray(manifest.calibration.calibration_result_sets) || manifest.calibration.calibration_result_sets.length < 1) {
			throw new Error(`${file} benchmark_ready scenarios must declare calibration_result_sets`);
		}
		if (!knownPassRateBands.has(manifest.calibration.pass_rate_band) || manifest.calibration.pass_rate_band === 'uncalibrated') {
			throw new Error(`${file} benchmark_ready scenarios must declare a calibrated pass_rate_band`);
		}
		if (!Array.isArray(manifest.calibration.confidence_interval_95)) {
			throw new Error(`${file} benchmark_ready scenarios must declare confidence_interval_95`);
		}
		if (manifest.calibration.held_out_private_variants_ready !== true) {
			throw new Error(`${file} benchmark_ready scenarios must declare held_out_private_variants_ready=true`);
		}
		if (manifest.calibration.known_shortcuts.length > 0) {
			throw new Error(`${file} benchmark_ready scenarios must not declare known_shortcuts`);
		}
		if (manifest.calibration.task_contract_level !== 'benchmark_replay') {
			throw new Error(`${file} benchmark_ready scenarios must declare task_contract_level=benchmark_replay`);
		}
		if (manifest.calibration.benchmark_blockers.length > 0) {
			throw new Error(`${file} benchmark_ready scenarios must not declare benchmark_blockers`);
		}
		validateBenchmarkMetadata(manifest.calibration.benchmark_metadata, `${file} calibration`, {
			requireVersionIdentity: true,
		});
	}
	if (
		manifest.calibration.headline_score_eligible &&
		manifest.calibration.held_out_private_variants_ready !== true
	) {
		throw new Error(`${file} headline_score_eligible scenarios must declare held_out_private_variants_ready=true`);
	}
	if (
		manifest.calibration.headline_score_eligible &&
		manifest.split.membership !== 'held_out_private'
	) {
		throw new Error(`${file} headline_score_eligible scenarios must use split.membership=held_out_private`);
	}

	if (manifest.probes !== undefined) {
		assertObject(manifest.probes, `${file} probes`);
		if (manifest.probes.behavioral_fingerprints !== undefined) {
			if (!Array.isArray(manifest.probes.behavioral_fingerprints)) {
				throw new Error(`${file} probes.behavioral_fingerprints must be an array`);
			}

			for (const probe of manifest.probes.behavioral_fingerprints) {
				assertObject(probe, `${file} behavioral fingerprint probe`);
				if (typeof probe.id !== 'string' || !/^[a-z0-9_]+$/.test(probe.id)) {
					throw new Error(`${file} behavioral fingerprint probe id must be snake_case`);
				}
				assertKnown(probe.type, knownProbeTypes, `${file} behavioral fingerprint probe type`);
				if (probe.reward_weight !== 0) {
					throw new Error(`${file} behavioral fingerprint probe ${probe.id} must declare reward_weight=0`);
				}
				if (typeof probe.description !== 'string' || probe.description.length < 1) {
					throw new Error(`${file} behavioral fingerprint probe ${probe.id} must declare description`);
				}
				assertStringArray(probe.dimensions, `${file} behavioral fingerprint probe ${probe.id} dimensions`, {
					minItems: 1,
					pattern: /^[a-z0-9_]+$/,
				});
			}
		}
	}
}

function validateScenarioCapabilities(file, capabilities) {
	assertObject(capabilities, `${file} capabilities`);
	if (capabilities.schema_version !== 1) {
		throw new Error(`${file} capabilities.schema_version must be 1`);
	}
	assertKnown(capabilities.primary, knownCapabilityAreas, `${file} capabilities.primary`);
	assertStringArray(capabilities.secondary || [], `${file} capabilities.secondary`);
	for (const area of capabilities.secondary || []) {
		assertKnown(area, knownCapabilityAreas, `${file} capabilities.secondary`);
		if (area === capabilities.primary) {
			throw new Error(`${file} capabilities.secondary must not repeat capabilities.primary: ${area}`);
		}
	}
	assertStringArray(capabilities.criteria, `${file} capabilities.criteria`, {
		minItems: 1,
		pattern: /^[a-z0-9_]+$/,
	});
}

function validateApiProvenance(file, provenance) {
	assertObject(provenance, `${file} api_provenance`);
	assertKnown(provenance.capability_area, knownCapabilityAreas, `${file} api_provenance.capability_area`);
	assertNonEmptyString(provenance.api_surface, `${file} api_provenance.api_surface`);

	if (!Array.isArray(provenance.source_inputs) || provenance.source_inputs.length < 1) {
		throw new Error(`${file} api_provenance.source_inputs must include at least one source input`);
	}

	const sourceInputIds = new Set();
	for (const [index, sourceInput] of provenance.source_inputs.entries()) {
		const label = `${file} api_provenance.source_inputs[${index}]`;
		assertObject(sourceInput, label);
		assertNonEmptyString(sourceInput.id, `${label}.id`);
		if (!/^[a-z0-9][a-z0-9-]*$/.test(sourceInput.id)) {
			throw new Error(`${label}.id must be kebab-case`);
		}
		if (sourceInputIds.has(sourceInput.id)) {
			throw new Error(`${file} api_provenance.source_inputs contains duplicate id: ${sourceInput.id}`);
		}
		sourceInputIds.add(sourceInput.id);
		assertKnown(sourceInput.type, knownSourceInputTypes, `${label}.type`);
		assertNonEmptyString(sourceInput.url, `${label}.url`);
		assertNonEmptyString(sourceInput.ref, `${label}.ref`);
		assertIsoDate(sourceInput.checked_at, `${label}.checked_at`);
		assertNonEmptyString(sourceInput.evidence, `${label}.evidence`);
	}

	assertObject(provenance.freshness, `${file} api_provenance.freshness`);
	assertKnown(provenance.freshness.status, knownFreshnessStatuses, `${file} api_provenance.freshness.status`);
	assertIsoDate(provenance.freshness.last_reviewed, `${file} api_provenance.freshness.last_reviewed`);
	assertIsoDate(provenance.freshness.next_review_due, `${file} api_provenance.freshness.next_review_due`);
	assertPositiveInteger(provenance.freshness.cadence_days, `${file} api_provenance.freshness.cadence_days`);
	if (provenance.freshness.next_review_due < provenance.freshness.last_reviewed) {
		throw new Error(`${file} api_provenance.freshness.next_review_due must not be before last_reviewed`);
	}

	assertObject(provenance.curriculum, `${file} api_provenance.curriculum`);
	assertKnown(provenance.curriculum.lifecycle_status, knownCurriculumLifecycleStatuses, `${file} api_provenance.curriculum.lifecycle_status`);
	assertNonEmptyString(provenance.curriculum.candidate_from_source_change, `${file} api_provenance.curriculum.candidate_from_source_change`);
	assertNonEmptyString(provenance.curriculum.promotion_next_step, `${file} api_provenance.curriculum.promotion_next_step`);
}

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
const scenarioManifestsById = new Map();
const scenarioValuesById = new Map();
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateScenarioSchema = ajv.compile(
	JSON.parse(await readFile(path.join(root, 'schemas/scenario.schema.json'), 'utf8'))
);

if (files.length < 2) {
	throw new Error(`Expected at least 2 scenario manifests, found ${files.length}`);
}

for (const file of files) {
	const manifest = JSON.parse(await readFile(path.join(root, file), 'utf8'));
	scenarioIdsByManifest.set(file, manifest.id);

	if (!validateScenarioSchema(manifest)) {
		throw new Error(`${file} schema errors: ${validateScenarioSchema.errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')}`);
	}

	for (const field of ['id', 'label', 'prompt_file', 'grader_file']) {
		if (!manifest[field]) {
			throw new Error(`${file} is missing ${field}`);
		}
	}

	if (scenarioManifestsById.has(manifest.id)) {
		throw new Error(`${file} duplicates scenario id ${manifest.id} from ${scenarioManifestsById.get(manifest.id)}`);
	}
	scenarioManifestsById.set(manifest.id, file);
	scenarioValuesById.set(manifest.id, manifest);

	validateScenarioContract(file, manifest);

	const promptPath = resolveRepoContained(file, manifest.prompt_file, `${file} prompt_file`);
	const graderPath = resolveRepoContained(file, manifest.grader_file, `${file} grader_file`);

	if (!existsSync(path.join(root, promptPath))) {
		throw new Error(`${file} prompt does not exist: ${manifest.prompt_file}`);
	}

	if (!existsSync(path.join(root, graderPath))) {
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

	for (const field of ['id', 'label', 'scenario_manifests']) {
		if (!manifest[field]) {
			throw new Error(`${file} is missing ${field}`);
		}
	}

	if (!Array.isArray(manifest.scenario_manifests) || manifest.scenario_manifests.length < 1) {
		throw new Error(`${file} must include at least one scenario manifest`);
	}

	if (manifest.benchmark_status !== undefined) {
		assertKnown(manifest.benchmark_status, knownCalibrationStatuses, `${file} benchmark_status`);
	}
	if (typeof manifest.benchmark !== 'boolean') {
		throw new Error(`${file} benchmark must be a boolean`);
	}
	if (
		manifest.headline_score_eligible !== undefined &&
		typeof manifest.headline_score_eligible !== 'boolean'
	) {
		throw new Error(`${file} headline_score_eligible must be a boolean`);
	}
	if (typeof manifest.aggregate_score !== 'boolean') {
		throw new Error(`${file} aggregate_score must be a boolean`);
	}
	assertKnown(manifest.score_scope, knownScoreScopes, `${file} score_scope`);
	assertKnown(manifest.task_contract_level, knownTaskSetContractLevels, `${file} task_contract_level`);
	if (manifest.split_policy !== undefined) {
		assertObject(manifest.split_policy, `${file} split_policy`);
		assertKnown(manifest.split_policy.lane, knownSplitMemberships, `${file} split_policy.lane`);
		assertStringArray(manifest.split_policy.allowed_splits, `${file} split_policy.allowed_splits`, {
			minItems: 1,
			pattern: /^[a-z0-9_]+$/,
		});
		for (const split of manifest.split_policy.allowed_splits) {
			assertKnown(split, knownSplitMemberships, `${file} split_policy.allowed_splits`);
		}
		if (typeof manifest.split_policy.requires_held_out_private !== 'boolean') {
			throw new Error(`${file} split_policy.requires_held_out_private must be a boolean`);
		}
		assertStringArray(manifest.split_policy.contamination_controls || [], `${file} split_policy.contamination_controls`, {
			pattern: /^[a-z0-9_]+$/,
		});
	}
	assertStringArray(manifest.benchmark_blockers, `${file} benchmark_blockers`, {
		pattern: /^[a-z0-9_]+$/,
	});
	if (manifest.benchmark_metadata !== undefined) {
		validateBenchmarkMetadata(manifest.benchmark_metadata, file);
	}
	validateTaskSetCapabilityCoverage(file, manifest, scenarioValuesById);
	if (manifest.benchmark) {
		if (manifest.benchmark_status !== 'benchmark_ready') {
			throw new Error(`${file} benchmark task sets must declare benchmark_status=benchmark_ready`);
		}
		if (manifest.score_scope !== 'benchmark') {
			throw new Error(`${file} benchmark task sets must declare score_scope=benchmark`);
		}
		if (!manifest.headline_score_eligible || !manifest.aggregate_score) {
			throw new Error(`${file} benchmark task sets must be headline and aggregate score eligible`);
		}
		if (manifest.task_contract_level !== 'benchmark_replay') {
			throw new Error(`${file} benchmark task sets must declare task_contract_level=benchmark_replay`);
		}
		if (manifest.benchmark_blockers.length > 0) {
			throw new Error(`${file} benchmark task sets must not declare benchmark_blockers`);
		}
		if (manifest.split_policy?.requires_held_out_private !== true) {
			throw new Error(`${file} benchmark task sets must require held-out private splits`);
		}
		validateBenchmarkMetadata(manifest.benchmark_metadata, file, { requireVersionIdentity: true });
	}

	if (!Array.isArray(manifest.tasks) || manifest.tasks.length < 1) {
		throw new Error(`${file} must include task metadata`);
	}

	const taskScenarioIds = new Set();
	for (const task of manifest.tasks) {
		assertObject(task, `${file} task`);
		if (typeof task.scenario_id !== 'string' || task.scenario_id.length < 1) {
			throw new Error(`${file} task entries must include scenario_id`);
		}
		if (taskScenarioIds.has(task.scenario_id)) {
			throw new Error(`${file} has duplicate task metadata for scenario: ${task.scenario_id}`);
		}
		taskScenarioIds.add(task.scenario_id);
	}

	const manifestScenarioIds = new Set();
	const allowedSplits = new Set(manifest.split_policy?.allowed_splits || []);
	for (const scenarioManifest of manifest.scenario_manifests) {
		const resolvedScenarioManifest = resolveRepoContained(
			file,
			scenarioManifest,
			`${file} scenario_manifests entry`
		);

		if (!existsSync(path.join(root, resolvedScenarioManifest))) {
			throw new Error(`${file} references missing scenario manifest: ${scenarioManifest}`);
		}

		const scenarioId = scenarioIdsByManifest.get(resolvedScenarioManifest);
		if (!scenarioId) {
			throw new Error(`${file} references a file that is not a discovered scenario manifest: ${scenarioManifest}`);
		}
		if (manifestScenarioIds.has(scenarioId)) {
			throw new Error(`${file} references duplicate scenario manifest id: ${scenarioId}`);
		}
		manifestScenarioIds.add(scenarioId);
		if (!taskScenarioIds.has(scenarioId)) {
			throw new Error(`${file} is missing task metadata for scenario: ${scenarioId}`);
		}
		if (allowedSplits.size > 0) {
			const scenario = scenarioValuesById.get(scenarioId);
			if (!allowedSplits.has(scenario.split.membership)) {
				throw new Error(`${file} does not allow ${scenarioId} split membership: ${scenario.split.membership}`);
			}
		}
	}

	for (const scenarioId of taskScenarioIds) {
		if (!manifestScenarioIds.has(scenarioId)) {
			throw new Error(`${file} has task metadata for a scenario not listed in scenario_manifests: ${scenarioId}`);
		}
	}
}

function uniqueSorted(values) {
	return [...new Set(values)].sort();
}

function validateCapabilityArray(value, label, { minItems = 0 } = {}) {
	assertStringArray(value, label, { minItems });
	const seen = new Set();
	for (const area of value) {
		assertKnown(area, knownCapabilityAreas, label);
		if (seen.has(area)) {
			throw new Error(`${label} contains duplicate capability area: ${area}`);
		}
		seen.add(area);
	}
}

function validateTaskSetCapabilityCoverage(file, manifest, scenarioValues) {
	assertObject(manifest.capability_coverage, `${file} capability_coverage`);
	if (manifest.capability_coverage.schema_version !== 1) {
		throw new Error(`${file} capability_coverage.schema_version must be 1`);
	}
	validateCapabilityArray(manifest.capability_coverage.primary, `${file} capability_coverage.primary`, { minItems: 1 });
	validateCapabilityArray(manifest.capability_coverage.secondary || [], `${file} capability_coverage.secondary`);

	const scenarioIds = (manifest.tasks || []).map((task) => task.scenario_id).filter(Boolean);
	const expectedPrimary = uniqueSorted(scenarioIds.map((scenarioId) => scenarioValues.get(scenarioId)?.capabilities?.primary).filter(Boolean));
	const expectedSecondary = uniqueSorted(scenarioIds.flatMap((scenarioId) => scenarioValues.get(scenarioId)?.capabilities?.secondary || []));
	const declaredPrimary = uniqueSorted(manifest.capability_coverage.primary || []);
	const declaredSecondary = uniqueSorted(manifest.capability_coverage.secondary || []);

	if (declaredPrimary.join(',') !== expectedPrimary.join(',')) {
		throw new Error(`${file} capability_coverage.primary must match task scenario primary capabilities: ${expectedPrimary.join(',')}`);
	}
	if (declaredSecondary.join(',') !== expectedSecondary.join(',')) {
		throw new Error(`${file} capability_coverage.secondary must match task scenario secondary capabilities: ${expectedSecondary.join(',')}`);
	}
}

async function listBenchmarkPolicyFixtureFiles(dir = path.join(root, 'fixtures', 'benchmark-policy'), relativeDir = 'fixtures/benchmark-policy') {
	if (!existsSync(dir)) {
		return [];
	}

	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		const relativePath = path.join(relativeDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...await listBenchmarkPolicyFixtureFiles(fullPath, relativePath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(relativePath);
		}
	}

	return files.sort();
}

for (const file of await listBenchmarkPolicyFixtureFiles()) {
	const fixture = JSON.parse(await readFile(path.join(root, file), 'utf8'));
	validateBenchmarkMetadata(fixture.benchmark_metadata, file, {
		requireVersionIdentity: fixture.benchmark_status === 'benchmark_ready',
	});
}

const phpFiles = [
	path.join('scripts', 'run-block-markup-fixture.php'),
	path.join('scripts', 'run-local-wordpress-state-grade.php'),
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
