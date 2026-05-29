import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { loadHeldOutPackTasks } from './resolve-held-out-pack.mjs';

const root = process.cwd();
const checkOnly = process.argv.includes('--check');
const heldOutPackInput = process.env.WP_GYM_HELD_OUT_PACK || process.env.HELD_OUT_PACK_MANIFEST || '';

function readJson(file) {
	return JSON.parse(fs.readFileSync(path.isAbsolute(file) ? file : path.join(root, file), 'utf8'));
}

function readText(file) {
	return fs.readFileSync(path.isAbsolute(file) ? file : path.join(root, file), 'utf8').trim();
}

function sha256File(file) {
	return createHash('sha256').update(fs.readFileSync(path.isAbsolute(file) ? file : path.join(root, file))).digest('hex');
}

function truthyEnv(value) {
	return /^(1|true|yes)$/i.test(value || '');
}

function currentTaskSetId() {
	if (heldOutPackInput && !process.env.TASK_SET) {
		return 'held-out-private';
	}
	return process.env.TASK_SET || 'first-live-run';
}

function explicitTaskIds() {
	return (process.env.TASK_IDS || '')
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);
}

function runSegment() {
	return [process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT]
		.filter(Boolean)
		.join('-');
}

function resolveFrom(baseFile, candidate) {
	if (!candidate) {
		return '';
	}

	return path.normalize(path.join(path.dirname(baseFile), candidate)).replace(/\\/g, '/');
}

function fallbackTaskSetMetadata(id) {
	const scope = id === 'smoke' ? 'demo' : 'pilot';

	return {
		id,
		sourcePath: '',
		benchmark_status: scope,
		benchmark: false,
		headline_score_eligible: false,
		aggregate_score: false,
		score_scope: scope,
		task_contract_level: id === 'custom' ? 'mixed_diagnostic' : 'wordpress_state_diagnostic',
		benchmark_blockers: [`${scope}_task_set`, 'missing_baseline_results', 'uncalibrated_difficulty'],
		benchmark_metadata: null,
	};
}

function taskSetMetadata() {
	const taskSet = currentTaskSetId();
	if (heldOutPackInput && taskSet === 'held-out-private') {
		const { manifest } = loadHeldOutPackTasks(heldOutPackInput);
		return {
			id: manifest.pack.id,
			sourcePath: `sealed://${manifest.pack.public_reference || `${manifest.pack.id}@${manifest.pack.version}`}/task-set`,
			benchmark_status: 'benchmark_ready',
			benchmark: true,
			headline_score_eligible: true,
			aggregate_score: true,
			score_scope: 'benchmark',
			task_contract_level: 'benchmark_replay',
			benchmark_blockers: [],
			benchmark_metadata: {
				benchmark_version: `${manifest.pack.id}@${manifest.pack.version}`,
				compatibility_group: manifest.pack.compatibility_group,
				public_reference: manifest.pack.public_reference || null,
			},
			split_policy: {
				requires_held_out_private: true,
			},
		};
	}
	if (taskSet === 'custom' || taskSet === 'smoke') {
		return fallbackTaskSetMetadata(taskSet);
	}

	const manifest = readJson(`task-sets/${taskSet}.json`);

	return {
		id: manifest.id,
		sourcePath: `task-sets/${taskSet}.json`,
		benchmark_status: manifest.benchmark_status || 'pilot',
		benchmark: Boolean(manifest.benchmark),
		headline_score_eligible: Boolean(manifest.headline_score_eligible),
		aggregate_score: Boolean(manifest.aggregate_score),
		score_scope: manifest.score_scope || manifest.benchmark_status || 'pilot',
		task_contract_level: manifest.task_contract_level || 'mixed_diagnostic',
		benchmark_blockers: manifest.benchmark_blockers || [],
		benchmark_metadata: manifest.benchmark_metadata || null,
	};
}

function taskSetScenarioIds(taskSetFile) {
	const taskSet = readJson(taskSetFile);
	const ids = [];

	for (const scenarioFile of taskSet.scenario_manifests || []) {
		const scenarioPath = resolveFrom(taskSetFile, scenarioFile);
		const scenario = readJson(scenarioPath);
		ids.push(scenario.id);
	}

	for (const task of taskSet.tasks || []) {
		if (task.scenario_id && !ids.includes(task.scenario_id)) {
			ids.push(task.scenario_id);
		}
	}

	return ids;
}

function scenarioEnvironment(scenario) {
	if (!scenario.environment || typeof scenario.environment !== 'object') {
		throw new Error(`${scenario.id} is missing environment contract metadata.`);
	}

	return scenario.environment;
}

function scenarioBudgets(scenario) {
	const environment = scenarioEnvironment(scenario);
	const truncation = environment.truncation_policy || {};
	const limits = scenario.limits || {};

	return {
		maxTurns: Number(truncation.max_turns || limits.max_turns || 12),
		stepBudget: Number(truncation.step_budget || limits.step_budget || 16),
		timeBudgetMs: Number(truncation.time_budget_ms || limits.time_budget_ms || 600000),
	};
}

function scenarioTask(scenarioFile) {
	const scenario = readJson(scenarioFile);
	const environment = scenarioEnvironment(scenario);
	const budgets = scenarioBudgets(scenario);

	return {
		id: scenario.id,
		label: scenario.label || scenario.id,
		scenarioFile,
		split: scenario.split || {},
		promptFile: resolveFrom(scenarioFile, scenario.prompt_file || scenario.prompt),
		graderFile: resolveFrom(scenarioFile, scenario.grader_file || scenario.grader),
		usesWorkspace: Boolean(environment.uses_workspace),
		allowedTools: environment.allowed_tools || [],
		writableRoots: environment.writable_roots || [],
		hiddenPaths: environment.hidden_paths || [],
		workspaceTemplate: environment.workspace_template || '',
		completionPolicy: environment.completion_policy || {},
		capabilities: scenario.capabilities || null,
		calibration: scenario.calibration || {},
		benchmarkMetadata: scenario.calibration?.benchmark_metadata || null,
		maxTurns: budgets.maxTurns,
		stepBudget: budgets.stepBudget,
		timeBudgetMs: budgets.timeBudgetMs,
		rules: scenario.rules || {},
		generalRules: scenario.general_rules || scenario.rules?.general || [],
		taskRules: scenario.task_rules || scenario.rules?.task_specific || [],
		probes: scenario.probes || {},
	};
}

function smokeTask() {
	const smoke = readJson('tasks/smoke-homepage/manifest.json');

	return {
		id: smoke.id,
		label: smoke.label,
		scenarioFile: 'tasks/smoke-homepage/manifest.json',
		promptFile: smoke.prompt,
		graderFile: smoke.check,
		usesWorkspace: false,
		allowedTools: [],
		writableRoots: [],
		hiddenPaths: [],
		workspaceTemplate: '',
		completionPolicy: { type: 'agent_final_response' },
		capabilities: {
			schema_version: 1,
			primary: 'theme_site_building',
			secondary: ['gutenberg_blocks'],
			criteria: ['homepage_rendering', 'wordpress_native_content'],
		},
		calibration: {
			status: 'demo',
			benchmark_scope: 'demo',
			headline_score_eligible: false,
			task_contract_level: 'wordpress_state_diagnostic',
			benchmark_blockers: ['demo_task', 'diagnostic_contract_only', 'missing_baseline_results'],
		},
		benchmarkMetadata: null,
		split: {
			membership: 'public',
			variant_family: 'smoke-homepage',
			variant_seed: 'smoke-homepage-public-v1',
		},
		benchmarkMetadata: null,
		maxTurns: 8,
		stepBudget: 12,
		timeBudgetMs: 600000,
		rules: {},
		generalRules: [],
		taskRules: [],
		probes: {},
	};
}

function providers() {
	const anthropicProviderRef = process.env.ANTHROPIC_PROVIDER_SHA || process.env.ANTHROPIC_PROVIDER_REF || 'trunk';
	const anthropicProviderSha = process.env.ANTHROPIC_PROVIDER_SHA || '';

	return [
		{
			provider: 'openai',
			model: 'gpt-5.5',
			label: 'openai-gpt-5-5',
			providerPlugin: '{}',
			providerPlugins: [],
		},
		{
			provider: 'anthropic',
			model: 'claude-opus-4-7',
			label: 'anthropic-claude-opus-4-7',
			providerPlugin: JSON.stringify({
				repo: 'WordPress/ai-provider-for-anthropic',
				ref: anthropicProviderRef,
				path: '.',
				register_function: 'WordPress\\AnthropicAiProvider\\register_provider',
				credentials: {
					connectors_ai_anthropic_api_key: 'PROVIDER_SECRET_1',
				},
			}),
			providerPlugins: [{
				name: 'ai-provider-for-anthropic',
				repo: 'WordPress/ai-provider-for-anthropic',
				ref: anthropicProviderRef,
				sha: anthropicProviderSha,
			}],
		},
	];
}

function isGitSha(value) {
	return /^[a-f0-9]{40}([a-f0-9]{24})?$/i.test(String(value || ''));
}

function isMutableRef(ref) {
	const normalized = String(ref || '').trim();
	if (!normalized || isGitSha(normalized) || /^sha256:[a-f0-9]{64}$/i.test(normalized)) {
		return false;
	}
	const refPart = normalized.includes('@') ? normalized.split('@').pop() : normalized;
	return /^(HEAD|main|master|trunk|dev|develop|latest)$/i.test(refPart)
		|| /^refs\/heads\//.test(refPart)
		|| /^release\//i.test(refPart);
}

function providerProvenanceRejectReasons(provider) {
	const reasons = [];
	for (const plugin of provider.providerPlugins || []) {
		if (isMutableRef(plugin.ref) && !plugin.sha && !plugin.digest) {
			reasons.push(`mutable_provider_ref_${plugin.name || plugin.repo || 'unknown'}`.replace(/[^a-z0-9_]+/gi, '_').toLowerCase());
		}
	}
	return reasons;
}

function provenanceConfig(task, provider, metadata) {
	return JSON.stringify({
		workflow: {
			repository: process.env.GITHUB_REPOSITORY || 'Automattic/wp-gym',
			path: '.github/workflows/datamachine-live-run.yml',
			ref: process.env.GITHUB_WORKFLOW_REF || process.env.GITHUB_REF || '',
			sha: process.env.GITHUB_SHA || '',
		},
		runner: {
			name: 'homeboy',
			version: process.env.HOMEBOY_VERSION || '',
			ref: process.env.HOMEBOY_RUNNER_REF || '',
			sha: process.env.HOMEBOY_RUNNER_SHA || '',
		},
		runtime: {
			wordpress_version: process.env.WP_GYM_WORDPRESS_VERSION || '',
			php_version: process.env.PHP_VERSION || '',
			node_version: process.version,
			wp_codebox_version: process.env.WP_CODEBOX_VERSION || '',
			playground_version: process.env.WORDPRESS_PLAYGROUND_VERSION || '',
			package_lock_sha256: sha256File('package-lock.json'),
		},
		provider: {
			provider: provider.provider,
			model: provider.model,
			model_version: process.env.MODEL_VERSION || '',
			model_snapshot: process.env.MODEL_SNAPSHOT || '',
		},
		provider_plugins: provider.providerPlugins || [],
		tool_policy: {
			sha256: process.env.TOOL_POLICY_SHA256 || '',
			enabled_tools_sha256: createHash('sha256').update(JSON.stringify(task.allowedTools || [])).digest('hex'),
			agent_instructions_sha256: process.env.AGENT_INSTRUCTIONS_SHA256 || '',
		},
		inputs: {
			scenario_sha256: task.heldOut?.sealed_hashes?.scenario_manifest || sha256File(task.scenarioFile),
			prompt_sha256: sha256File(task.promptFile),
			grader_sha256: sha256File(task.graderFile),
			task_set_sha256: metadata.taskSet.sourcePath && !metadata.taskSet.sourcePath.startsWith('sealed://') ? sha256File(metadata.taskSet.sourcePath) : (task.heldOut?.sealed_hashes?.scenario_manifest || ''),
			bundle_sha256: sha256File('bundle-validator.json'),
			held_out_pack_id: task.heldOut?.pack_id || null,
			held_out_pack_version: task.heldOut?.pack_version || null,
			held_out_entry_id: task.heldOut?.entry_id || null,
		},
		...(task.heldOut ? { held_out: task.heldOut } : {}),
	});
}

function workspaceConfig(task, branchSlug) {
	if (!task.usesWorkspace) {
		return '{}';
	}

	const runPrefix = runSegment();

	return JSON.stringify({
		enabled: true,
		repo: 'wp-gym',
		clone_url: 'https://github.com/Automattic/wp-gym.git',
		from: process.env.GITHUB_REF_NAME || 'main',
		branch_prefix: `agent-runs/${runPrefix ? `${runPrefix}/` : ''}${branchSlug}`,
		agent_alias: 'current-project',
		agent_root: '.agent-workspace/current-project',
		expose_to_agent: true,
		capture_changes: true,
		workspace_template: task.workspaceTemplate,
		writable_roots: task.writableRoots,
		hidden_paths: task.hiddenPaths,
		commit_message: `feat: complete ${task.id}`,
	});
}

function flowStepPatches(task) {
	if (!task.usesWorkspace) {
		return '[]';
	}

	return JSON.stringify([
		{
			step_type: 'ai',
			merge: {
				enabled_tools: task.allowedTools,
			},
		},
	]);
}

function pipelineStepPatches(task) {
	if (!task.usesWorkspace) {
		return '[]';
	}

	// Completion must come from the agent's final response; a file write alone is
	// not a task-completion signal.
	if (task.completionPolicy.type === 'explicit_final_response') {
		return '[]';
	}

	return '[]';
}

function terminalActionsEnabled(task) {
	return task.allowedTools.includes('run_wp_cli');
}

function artifactExportConfig(task, provider, metadata) {
	return JSON.stringify({
		include_job_artifacts: true,
		pr_title_template: `[wp-gym] {result_label} - {task_id} - {provider}/{model}`,
		pr_body_template: [
			'## wp-gym Live Run',
			'- **Task:** {task_label}',
			'- **Task ID:** `{task_id}`',
			'- **Provider:** `{provider}`',
			'- **Model:** `{model}`',
			'- **Agent:** `{agent_slug}`',
			'- **Workflow:** {workflow_run_url}',
			'',
			'## Result',
			'- **Success:** `{success}`',
			'- **Reward:** `{reward}`',
			'- **Score:** `{grade_score}` / `{grade_max_score}`',
			'',
			'## Benchmark Status',
			'- **Task set:** `{task_set_id}`',
			'- **Task set status:** `{task_set_benchmark_status}`',
			'- **Task set version:** `{task_set_benchmark_version}`',
			'- **Task set compatibility group:** `{task_set_compatibility_group}`',
			'- **Scenario version:** `{scenario_benchmark_version}`',
			'- **Scenario compatibility group:** `{scenario_compatibility_group}`',
			'- **Score scope:** `{score_scope}`',
			'- **Benchmark eligible:** `{benchmark_eligible}`',
			'- **Aggregate score:** `{aggregate_score}`',
			'- **Task contract:** `{task_contract_level}`',
			'- **Split:** `{split_membership}`',
			'- **Variant family:** `{variant_family}`',
			'- **Variant seed:** `{variant_seed}`',
			'- **Run:** `{run_id}` attempt `{run_attempt}`',
			'- **Blockers:** `{benchmark_blockers}`',
			'',
			'{result_table}',
			'',
			'## Eval Reproducibility',
			'- **Homeboy result:** runner-owned job artifacts and sealed evidence metadata.',
			'- **wp-gym contract:** scenario manifest, task-set metadata, and resolved matrix row.',
			'- **Input fingerprints:** `metadata.fingerprints` in the Homeboy result JSON.',
			'- **Prompt fingerprint:** `metadata.fingerprints.prompt.sha256`.',
			'- **Bundle fingerprint:** `metadata.fingerprints.bundle.sha256`.',
			'- **Tool policy fingerprint:** `metadata.fingerprints.tool_policy.sha256`.',
			'- **Benchmark provenance:** `metadata.eval_artifact.provenance` pins workflow, runner, runtime, provider, tool-policy, and input hashes for benchmark-mode rows.',
			'- **Rule policy:** `rules`, `general_rules`, and `task_rules` from the resolved matrix row.',
			'- **Behavioral probes:** `probes` from the resolved matrix row.',
			'',
			'## Grade Checks',
			'{checks_table}',
			'',
			'## Changed Files',
			'- **Workspace changed:** {workspace_changed}',
			'- **Changed file count:** `{changed_file_count}`',
			'- **Workspace branch:** `{workspace_branch}`',
			'- **Workspace handle:** `{workspace_handle}`',
			'- **File list:** Review the PR **Files changed** tab for the runner workspace branch.',
			'',
			'## Artifacts and Replay',
			'- **Episode replay:** Homeboy exports an `episode_jsonl` artifact with action rows and terminal grader evidence.',
			'- **Replay bundle:** Homeboy exports the sealed replay bundle and artifact hashes.',
			'{links_table}',
			'',
			'## Tool Summary',
			'{tools_table}',
		].join('\n'),
		pr_template_values: {
			task_id: task.id,
			task_label: task.label,
			provider: provider.provider,
			model: provider.model,
			model_label: `${provider.provider}/${provider.model}`,
			task_set_id: metadata.taskSet.id,
			task_set_benchmark_status: metadata.taskSet.benchmark_status,
			task_set_benchmark_version: metadata.taskSet.benchmark_metadata?.benchmark_version || 'unversioned',
			task_set_compatibility_group: metadata.taskSet.benchmark_metadata?.compatibility_group || 'unversioned',
			scenario_benchmark_version: task.calibration.benchmark_metadata?.benchmark_version || 'unversioned',
			scenario_compatibility_group: task.calibration.benchmark_metadata?.compatibility_group || 'unversioned',
			score_scope: metadata.taskSet.score_scope,
			benchmark_eligible: metadata.benchmarkEligible,
			aggregate_score: metadata.taskSet.aggregate_score,
			task_contract_level: task.calibration.task_contract_level || 'unknown',
			split_membership: task.split?.membership || 'unknown',
			variant_family: task.split?.variant_family || '',
			variant_seed: task.split?.variant_seed || '',
			run_id: metadata.runId,
			run_attempt: metadata.runAttempt,
			benchmark_blockers: metadata.benchmarkRejectReasons.join(', ') || 'none',
		},
		pr_template_paths: {
			success: 'run.success',
			reward: 'run.reward',
			grade_score: 'run.grade.score',
			grade_max_score: 'run.grade.max_score',
			changed_file_count: 'run.runner_workspace_capture.status.dirty',
			job_status: 'run.job_status',
			transcript_session_id: 'run.transcript_session_id',
		},
	});
}

function resolveTasks() {
	if (heldOutPackInput) {
		const { tasks } = loadHeldOutPackTasks(heldOutPackInput);
		const explicitIds = explicitTaskIds();
		if (explicitIds.length === 0) {
			return tasks;
		}
		const byId = new Map(tasks.flatMap((task) => [[task.id, task], [task.heldOut.entry_id, task]]));
		return explicitIds.map((taskId) => {
			const task = byId.get(taskId);
			if (!task) {
				throw new Error(`Unknown held-out task ID: ${taskId}`);
			}
			return task;
		});
	}

	const homeboy = readJson('homeboy.json');
	const scenarioFiles = homeboy.extensions.wordpress.settings.playground_scenario_manifests || [];
	const smoke = smokeTask();
	const tasks = new Map([[smoke.id, smoke]]);

	for (const scenarioFile of scenarioFiles) {
		const task = scenarioTask(scenarioFile);
		tasks.set(task.id, task);
	}

	const taskSet = currentTaskSetId();
	const explicitIds = explicitTaskIds();

	if (taskSet === 'custom' && explicitIds.length === 0) {
		throw new Error('task_ids is required when task_set is custom.');
	}

	const selectedIds = explicitIds.length > 0
		? explicitIds
		: taskSet === 'all'
			? [...tasks.keys()]
			: taskSet === 'smoke'
				? ['smoke-homepage']
				: taskSetScenarioIds(`task-sets/${taskSet}.json`);

	return selectedIds.map((taskId) => {
		const task = tasks.get(taskId);
		if (!task) {
			throw new Error(`Unknown task ID: ${taskId}`);
		}
		return task;
	});
}

function benchmarkRejectReasons(task, taskSet) {
	const calibration = task.calibration || {};
	const reasons = [];

	if (!taskSet.benchmark) {
		reasons.push(`${taskSet.score_scope || 'pilot'}_task_set`);
	}
	if (taskSet.benchmark_status !== 'benchmark_ready') {
		reasons.push(`task_set_status_${taskSet.benchmark_status || 'unknown'}`);
	}
	if (!taskSet.headline_score_eligible) {
		reasons.push('task_set_not_headline_eligible');
	}
	if (!taskSet.aggregate_score) {
		reasons.push('task_set_not_aggregate_score_eligible');
	}
	if (taskSet.score_scope !== 'benchmark') {
		reasons.push(`score_scope_${taskSet.score_scope || 'unknown'}`);
	}
	if (calibration.status !== 'benchmark_ready') {
		reasons.push(`scenario_status_${calibration.status || 'unknown'}`);
	}
	if (calibration.benchmark_scope !== 'benchmark') {
		reasons.push(`scenario_scope_${calibration.benchmark_scope || 'unknown'}`);
	}
	if (!calibration.headline_score_eligible) {
		reasons.push('scenario_not_headline_eligible');
	}
	if (calibration.difficulty_band === 'uncalibrated') {
		reasons.push('uncalibrated_difficulty');
	}
	if (!Array.isArray(calibration.baseline_result_sets) || calibration.baseline_result_sets.length === 0) {
		reasons.push('missing_baseline_results');
	}
	if (!Array.isArray(calibration.calibration_result_sets) || calibration.calibration_result_sets.length === 0) {
		reasons.push('missing_calibration_results');
	}
	if (!calibration.pass_rate_band || calibration.pass_rate_band === 'uncalibrated') {
		reasons.push(`pass_rate_band_${calibration.pass_rate_band || 'unknown'}`);
	}
	if (!Array.isArray(calibration.confidence_interval_95) || calibration.confidence_interval_95.length !== 2) {
		reasons.push('missing_confidence_interval');
	}
	if (calibration.held_out_private_variants_ready !== true) {
		reasons.push('held_out_private_variants_not_ready');
	}
	if (taskSet.split_policy?.requires_held_out_private === true && !task.heldOut) {
		reasons.push('missing_private_held_out_pack_row');
	}
	if (taskSet.headline_score_eligible && taskSet.split_policy?.requires_held_out_private !== true && !task.heldOut) {
		reasons.push('task_set_missing_held_out_private_requirement');
	}
	if (task.split?.membership !== 'held_out_private') {
		reasons.push(`split_${task.split?.membership || 'unknown'}_not_held_out_private`);
	}
	if (Array.isArray(calibration.known_shortcuts) && calibration.known_shortcuts.length > 0) {
		reasons.push('known_reward_shortcut');
	}
	if (calibration.task_contract_level !== 'benchmark_replay') {
		reasons.push(`task_contract_${calibration.task_contract_level || 'unknown'}`);
	}
	if (Array.isArray(calibration.benchmark_blockers)) {
		reasons.push(...calibration.benchmark_blockers);
	}
	if (Array.isArray(taskSet.benchmark_blockers)) {
		reasons.push(...taskSet.benchmark_blockers);
	}
	if (!taskSet.benchmark_metadata?.benchmark_version) {
		reasons.push('missing_task_set_benchmark_version');
	}
	if (!taskSet.benchmark_metadata?.compatibility_group) {
		reasons.push('missing_task_set_compatibility_group');
	}
	if (!calibration.benchmark_metadata?.benchmark_version) {
		reasons.push('missing_scenario_benchmark_version');
	}
	if (!calibration.benchmark_metadata?.compatibility_group) {
		reasons.push('missing_scenario_compatibility_group');
	}

	return [...new Set(reasons)].sort();
}

function resolveMatrix() {
	const include = [];
	const taskSet = taskSetMetadata();
	const runId = process.env.GITHUB_RUN_ID || '';
	const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '';
	const runPrefix = runSegment();

	for (const task of resolveTasks()) {
		const prompt = readText(task.promptFile);
		const redactPrivateOutput = task.heldOut && !process.env.GITHUB_OUTPUT && !truthyEnv(process.env.WP_GYM_PRINT_PRIVATE_HELD_OUT);
		const workloadRunAfter = task.graderFile
			? JSON.stringify([{ type: 'php', file: task.graderFile }])
			: '[]';

		for (const provider of providers()) {
			const branchSlug = `${task.id}-${provider.label}`.replace(/[^A-Za-z0-9_.-]+/g, '-');
			const benchmarkRejectReasonList = [...new Set([
				...benchmarkRejectReasons(task, taskSet),
				...providerProvenanceRejectReasons(provider),
			])].sort();
			const benchmarkEligible = benchmarkRejectReasonList.length === 0;
			const artifactSuffix = runPrefix ? `${runPrefix}-${branchSlug}` : branchSlug;
			const rowMetadata = {
				taskSet,
				benchmarkEligible,
				benchmarkRejectReasons: benchmarkRejectReasonList,
				runId,
				runAttempt,
			};

			include.push({
				task_set_id: taskSet.id,
				task_set_benchmark_status: taskSet.benchmark_status,
				task_set_benchmark_version: taskSet.benchmark_metadata?.benchmark_version || '',
				task_set_compatibility_group: taskSet.benchmark_metadata?.compatibility_group || '',
				task_id: task.id,
				task_label: task.label,
				provider: provider.provider,
				model: provider.model,
				provider_label: provider.label,
				provider_plugin: provider.providerPlugin,
				provenance: provenanceConfig(task, provider, rowMetadata),
				prompt: redactPrivateOutput ? '[redacted-held-out-private-prompt]' : prompt,
				workload_run_after: redactPrivateOutput ? '[redacted-held-out-private-grader]' : workloadRunAfter,
				rules: JSON.stringify(task.rules),
				general_rules: JSON.stringify(task.generalRules),
				task_rules: JSON.stringify(task.taskRules),
				probes: JSON.stringify(task.probes),
				success_requires_pr: Boolean(task.usesWorkspace),
				runner_workspace: workspaceConfig(task, branchSlug),
				pipeline_step_patches: pipelineStepPatches(task),
				flow_step_patches: flowStepPatches(task),
				enable_terminal_actions: terminalActionsEnabled(task),
				wp_cli_tool_name: 'run_wp_cli',
				artifact_export_config: artifactExportConfig(task, provider, rowMetadata),
				max_turns: task.maxTurns,
				step_budget: task.stepBudget,
				time_budget_ms: task.timeBudgetMs,
				calibration_status: task.calibration.status || 'unknown',
				benchmark_scope: task.calibration.benchmark_scope || 'unknown',
				scenario_benchmark_version: task.calibration.benchmark_metadata?.benchmark_version || '',
				scenario_compatibility_group: task.calibration.benchmark_metadata?.compatibility_group || '',
				split_membership: task.split?.membership || 'unknown',
				variant_family: task.split?.variant_family || '',
				variant_seed: task.split?.variant_seed || '',
				parent_scenario_id: task.split?.parent_scenario_id || '',
				scenario_benchmark_version: task.calibration.benchmark_metadata?.benchmark_version || '',
				scenario_compatibility_group: task.calibration.benchmark_metadata?.compatibility_group || '',
				headline_score_eligible: Boolean(task.calibration.headline_score_eligible),
				score_scope: taskSet.score_scope,
				benchmark_eligible: benchmarkEligible,
				aggregate_score: taskSet.aggregate_score,
				task_contract_level: task.calibration.task_contract_level || 'unknown',
				benchmark_reject_reasons: benchmarkRejectReasonList,
				held_out_pack: task.heldOut ? {
					pack_id: task.heldOut.pack_id,
					pack_version: task.heldOut.pack_version,
					entry_id: task.heldOut.entry_id,
					scenario_id: task.heldOut.scenario_id,
					parent_scenario_id: task.heldOut.parent_scenario_id,
					compatibility_group: task.heldOut.compatibility_group,
					variant_family: task.heldOut.variant_family,
					variant_seed: task.heldOut.variant_seed,
					split_membership: task.heldOut.split_membership,
					public_report_policy: task.heldOut.public_report_policy,
					public_reference: task.heldOut.public_reference,
					sealed_hashes: task.heldOut.sealed_hashes,
				} : null,
				run_id: runId,
				run_attempt: runAttempt,
				artifact_suffix: artifactSuffix,
			});
		}
	}

	return { include };
}

function parseJsonField(row, field) {
	try {
		return JSON.parse(row[field]);
	} catch (error) {
		throw new Error(`${row.task_id} ${row.provider_label} has invalid JSON in ${field}: ${error.message}`);
	}
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function sameSet(actual, expected, label) {
	const actualValues = [...actual].sort();
	const expectedValues = [...expected].sort();

	assert(
		JSON.stringify(actualValues) === JSON.stringify(expectedValues),
		`${label} expected ${expectedValues.join(', ')}, got ${actualValues.join(', ')}`
	);
}

function checkExpectedShape(matrix, selectedTasks) {
	const taskSet = currentTaskSetId();
	const explicitIds = explicitTaskIds();
	const expectedByTaskSet = {
		'first-live-run': { rows: 6, workspaceRows: 2 },
		'benchmark-readiness-pilot': { rows: 8, workspaceRows: 4 },
		'visual-builder': { rows: 2, workspaceRows: 0 },
		smoke: { rows: 2, workspaceRows: 0 },
		'wordpress-investigation': { rows: 2, workspaceRows: 0 },
		all: { rows: 22, workspaceRows: 6 },
	};
	const expected = explicitIds.length === 0 ? expectedByTaskSet[taskSet] : null;

	if (expected) {
		assert(matrix.include.length === expected.rows, `${taskSet} expected ${expected.rows} rows, got ${matrix.include.length}`);
		const workspaceRows = matrix.include.filter((row) => row.success_requires_pr).length;
		assert(workspaceRows === expected.workspaceRows, `${taskSet} expected ${expected.workspaceRows} workspace rows, got ${workspaceRows}`);
	}

	const taskIds = new Set(selectedTasks.map((task) => task.id));
	sameSet(new Set(matrix.include.map((row) => row.task_id)), taskIds, 'matrix task ids');
}

function assertLiveRunMatrix(matrix) {
	const selectedTasks = resolveTasks();
	const tasksById = new Map(selectedTasks.map((task) => [task.id, task]));
	const providerLabels = new Set(providers().map((provider) => provider.label));
	const benchmarkMode = truthyEnv(process.env.BENCHMARK_MODE);
	const taskSet = taskSetMetadata();

	checkExpectedShape(matrix, selectedTasks);

	for (const task of selectedTasks) {
		const rows = matrix.include.filter((row) => row.task_id === task.id);
		assert(rows.length === providerLabels.size, `${task.id} expected ${providerLabels.size} provider rows, got ${rows.length}`);
		sameSet(new Set(rows.map((row) => row.provider_label)), providerLabels, `${task.id} provider labels`);
	}

	for (const row of matrix.include) {
		const task = tasksById.get(row.task_id);
		assert(task, `Unknown task row: ${row.task_id}`);
		assert(Number(row.max_turns) > 0, `${row.task_id} max_turns must be positive`);
		assert(Number(row.step_budget) > 0, `${row.task_id} step_budget must be positive`);
		assert(Number(row.time_budget_ms) > 0, `${row.task_id} time_budget_ms must be positive`);
		assert(row.calibration_status === (task.calibration.status || 'unknown'), `${row.task_id} calibration_status mismatch`);
		assert(row.benchmark_scope === (task.calibration.benchmark_scope || 'unknown'), `${row.task_id} benchmark_scope mismatch`);
		assert(row.task_set_benchmark_version === (taskSet.benchmark_metadata?.benchmark_version || ''), `${row.task_id} task_set_benchmark_version mismatch`);
		assert(row.task_set_compatibility_group === (taskSet.benchmark_metadata?.compatibility_group || ''), `${row.task_id} task_set_compatibility_group mismatch`);
		assert(row.scenario_benchmark_version === (task.calibration.benchmark_metadata?.benchmark_version || ''), `${row.task_id} scenario_benchmark_version mismatch`);
		assert(row.scenario_compatibility_group === (task.calibration.benchmark_metadata?.compatibility_group || ''), `${row.task_id} scenario_compatibility_group mismatch`);
		assert(row.split_membership === (task.split?.membership || 'unknown'), `${row.task_id} split_membership mismatch`);
		assert(row.task_set_benchmark_version === (taskSetMetadata().benchmark_metadata?.benchmark_version || ''), `${row.task_id} task_set_benchmark_version mismatch`);
		assert(row.task_set_compatibility_group === (taskSetMetadata().benchmark_metadata?.compatibility_group || ''), `${row.task_id} task_set_compatibility_group mismatch`);
		assert(row.scenario_benchmark_version === (task.calibration.benchmark_metadata?.benchmark_version || ''), `${row.task_id} scenario_benchmark_version mismatch`);
		assert(row.scenario_compatibility_group === (task.calibration.benchmark_metadata?.compatibility_group || ''), `${row.task_id} scenario_compatibility_group mismatch`);
		assert(row.headline_score_eligible === Boolean(task.calibration.headline_score_eligible), `${row.task_id} headline_score_eligible mismatch`);
		assert(row.task_contract_level === (task.calibration.task_contract_level || 'unknown'), `${row.task_id} task_contract_level mismatch`);
		assert(row.benchmark_scope !== 'benchmark' || row.headline_score_eligible === true, `${row.task_id} benchmark rows must be headline eligible`);
		assert(Array.isArray(row.benchmark_reject_reasons), `${row.task_id} benchmark_reject_reasons must be an array`);
		assert(
			row.benchmark_eligible === (row.benchmark_reject_reasons.length === 0),
			`${row.task_id} benchmark_eligible must match benchmark_reject_reasons`
		);
		if (Array.isArray(task.calibration.known_shortcuts) && task.calibration.known_shortcuts.length > 0) {
			assert(
				row.benchmark_reject_reasons.includes('known_reward_shortcut'),
				`${row.task_id} known shortcuts must block benchmark eligibility`
			);
		}
		if (row.benchmark_eligible) {
			assert(row.split_membership === 'held_out_private', `${row.task_id} benchmark eligible rows must use held-out private split membership`);
		}
		if (benchmarkMode) {
			assert(
				row.benchmark_eligible === true,
				`${row.task_id} ${row.provider_label} is not benchmark eligible: task_set=${row.task_set_id} status=${row.task_set_benchmark_status} score_scope=${row.score_scope} calibration_status=${row.calibration_status} benchmark_scope=${row.benchmark_scope} contract=${row.task_contract_level} reasons=${row.benchmark_reject_reasons.join(',')}`
			);
		}
		assert(row.workload_run_after !== '[]', `${row.task_id} must run a grader`);
		if (task.heldOut && !process.env.GITHUB_OUTPUT && !truthyEnv(process.env.WP_GYM_PRINT_PRIVATE_HELD_OUT)) {
			assert(row.prompt === '[redacted-held-out-private-prompt]', `${row.task_id} dry-run output must redact held-out prompt`);
			assert(row.workload_run_after === '[redacted-held-out-private-grader]', `${row.task_id} dry-run output must redact held-out grader`);
			assert(row.held_out_pack?.sealed_hashes?.prompt, `${row.task_id} dry-run output must include sealed prompt hash`);
		}
		assert(row.enable_terminal_actions === terminalActionsEnabled(task), `${row.task_id} terminal actions flag mismatch`);
		assert(row.wp_cli_tool_name === 'run_wp_cli', `${row.task_id} wp_cli_tool_name mismatch`);

		const pipelinePatches = parseJsonField(row, 'pipeline_step_patches');
		assert(Array.isArray(pipelinePatches) && pipelinePatches.length === 0, `${row.task_id} must not complete from pipeline write side effects`);

		const artifactExport = parseJsonField(row, 'artifact_export_config');
		assert(artifactExport.include_job_artifacts === true, `${row.task_id} must export job artifacts`);
		assert(artifactExport.pr_template_values?.task_id === row.task_id, `${row.task_id} artifact export task id mismatch`);
		assert(artifactExport.pr_template_values?.benchmark_eligible === row.benchmark_eligible, `${row.task_id} artifact export benchmark eligibility mismatch`);
		assert(artifactExport.pr_template_values?.score_scope === row.score_scope, `${row.task_id} artifact export score scope mismatch`);

		const provenance = parseJsonField(row, 'provenance');
		assert(provenance.provider?.provider === row.provider, `${row.task_id} provenance provider mismatch`);
		assert(provenance.provider?.model === row.model, `${row.task_id} provenance model mismatch`);
		assert(/^[a-f0-9]{64}$/.test(provenance.inputs?.scenario_sha256 || ''), `${row.task_id} provenance scenario hash missing`);
		assert(/^[a-f0-9]{64}$/.test(provenance.inputs?.prompt_sha256 || ''), `${row.task_id} provenance prompt hash missing`);
		assert(/^[a-f0-9]{64}$/.test(provenance.inputs?.grader_sha256 || ''), `${row.task_id} provenance grader hash missing`);
		assert(/^[a-f0-9]{64}$/.test(provenance.runtime?.package_lock_sha256 || ''), `${row.task_id} provenance package lock hash missing`);
		for (const [index, plugin] of (provenance.provider_plugins || []).entries()) {
			if (isMutableRef(plugin.ref) && !plugin.sha && !plugin.digest) {
				assert(
					row.benchmark_reject_reasons.some((reason) => reason.startsWith('mutable_provider_ref_')),
					`${row.task_id} provider plugin ${index} mutable ref must block benchmark eligibility`
				);
			}
		}
		if (runSegment()) {
			assert(row.artifact_suffix.startsWith(`${runSegment()}-`), `${row.task_id} artifact_suffix must include run id and attempt`);
		}

		if (!task.usesWorkspace) {
			assert(row.success_requires_pr === false, `${row.task_id} non-workspace row must not require PR`);
			assert(row.runner_workspace === '{}', `${row.task_id} non-workspace row must have empty runner workspace`);
			assert(row.flow_step_patches === '[]', `${row.task_id} non-workspace row must not patch tools`);
			continue;
		}

		assert(row.success_requires_pr === true, `${row.task_id} workspace row must require PR`);
		const runnerWorkspace = parseJsonField(row, 'runner_workspace');
		assert(runnerWorkspace.enabled === true, `${row.task_id} workspace must be enabled`);
		assert(runnerWorkspace.clone_url === 'https://github.com/Automattic/wp-gym.git', `${row.task_id} clone_url must target Automattic/wp-gym`);
		assert(runnerWorkspace.workspace_template === task.workspaceTemplate, `${row.task_id} workspace template mismatch`);
		assert(Array.isArray(runnerWorkspace.writable_roots) && runnerWorkspace.writable_roots.includes('plugins/'), `${row.task_id} workspace must limit writes to plugins/`);
		assert(Array.isArray(runnerWorkspace.hidden_paths) && runnerWorkspace.hidden_paths.includes('graders/'), `${row.task_id} workspace must hide graders/`);
		assert(Array.isArray(runnerWorkspace.hidden_paths) && runnerWorkspace.hidden_paths.includes('scenarios/'), `${row.task_id} workspace must hide scenarios/`);

		const flowPatches = parseJsonField(row, 'flow_step_patches');
		assert(flowPatches.length === 1, `${row.task_id} workspace row must patch one AI flow step`);
		sameSet(
			new Set(flowPatches[0]?.merge?.enabled_tools || []),
			new Set(task.allowedTools),
			`${row.task_id} enabled tools`
		);
	}
}

const matrix = resolveMatrix();

if (checkOnly) {
	assertLiveRunMatrix(matrix);
	console.log(`Resolved and checked ${matrix.include.length} live-run matrix entries.`);
} else if (process.env.GITHUB_OUTPUT) {
	fs.appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
} else {
	console.log(JSON.stringify(matrix, null, 2));
}
