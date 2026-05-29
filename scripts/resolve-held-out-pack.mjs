import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePackManifest } from './validate-held-out-packs.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const requiredArtifacts = ['scenario_manifest', 'prompt', 'grader', 'setup', 'expected_artifacts', 'replay_contract'];

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function artifactPath(manifestFile, artifact) {
	const target = artifact?.path_or_url || '';
	if (!target || /^[a-z][a-z0-9+.-]*:\/\//i.test(target) || target.startsWith('sealed://')) {
		return '';
	}
	return path.resolve(path.dirname(manifestFile), target);
}

function artifactMap(manifestFile, entry) {
	return new Map((entry.artifacts || []).map((artifact) => [artifact.name, {
		...artifact,
		resolved_path: artifactPath(manifestFile, artifact),
	}]));
}

function sealedSource(publicReference, suffix) {
	return `sealed://${publicReference || 'held-out-pack'}/${suffix}`;
}

function assertLocalArtifact(artifacts, name, entryId) {
	const artifact = artifacts.get(name);
	if (!artifact?.resolved_path) {
		throw new Error(`${entryId} ${name} must resolve to a local artifact path for held-out execution.`);
	}
	return artifact;
}

function heldOutMetadata(pack, entry, artifacts) {
	return {
		pack_id: pack.pack.id,
		pack_version: pack.pack.version,
		public_reference: pack.pack.public_reference || `${pack.pack.id}@${pack.pack.version}`,
		compatibility_group: pack.pack.compatibility_group,
		entry_id: entry.id,
		scenario_id: entry.scenario_id,
		parent_scenario_id: entry.parent_scenario_id || null,
		variant_family: entry.variant_family,
		variant_seed: entry.variant_seed,
		split_membership: entry.split_membership,
		public_report_policy: pack.boundary.public_report_policy,
		sealed_hashes: Object.fromEntries(requiredArtifacts.map((name) => [name, artifacts.get(name)?.sha256 || entry.version_identity?.[`${name}_sha256`] || ''])),
	};
}

function scenarioTaskFromEntry(pack, manifestFile, entry) {
	const artifacts = artifactMap(manifestFile, entry);
	for (const name of requiredArtifacts) {
		assertLocalArtifact(artifacts, name, entry.id);
	}

	const scenarioArtifact = artifacts.get('scenario_manifest');
	const promptArtifact = artifacts.get('prompt');
	const graderArtifact = artifacts.get('grader');
	const scenario = readJson(scenarioArtifact.resolved_path);
	const environment = scenario.environment || {};
	const limits = scenario.limits || {};
	const truncation = environment.truncation_policy || {};
	const heldOut = heldOutMetadata(pack, entry, artifacts);
	const calibration = {
		...(scenario.calibration || {}),
		status: entry.calibration_status || scenario.calibration?.status || 'calibrating',
		benchmark_scope: scenario.calibration?.benchmark_scope || 'benchmark',
		headline_score_eligible: scenario.calibration?.headline_score_eligible !== false,
		held_out_private_variants_ready: scenario.calibration?.held_out_private_variants_ready === true,
		task_contract_level: entry.task_contract_level,
		benchmark_metadata: {
			benchmark_version: `${pack.pack.id}@${pack.pack.version}`,
			compatibility_group: pack.pack.compatibility_group,
			...(scenario.calibration?.benchmark_metadata || {}),
		},
	};

	return {
		id: entry.scenario_id,
		label: scenario.label || entry.scenario_id,
		scenarioFile: scenarioArtifact.resolved_path,
		promptFile: promptArtifact.resolved_path,
		graderFile: graderArtifact.resolved_path,
		usesWorkspace: Boolean(environment.uses_workspace),
		allowedTools: environment.allowed_tools || [],
		writableRoots: environment.writable_roots || [],
		hiddenPaths: [...new Set([...(environment.hidden_paths || []), 'graders/', 'scenarios/'])],
		workspaceTemplate: environment.workspace_template || '',
		completionPolicy: environment.completion_policy || {},
		capabilities: scenario.capabilities || null,
		calibration,
		benchmarkMetadata: calibration.benchmark_metadata,
		maxTurns: Number(truncation.max_turns || limits.max_turns || 12),
		stepBudget: Number(truncation.step_budget || limits.step_budget || 16),
		timeBudgetMs: Number(truncation.time_budget_ms || limits.time_budget_ms || 600000),
		rules: scenario.rules || {},
		generalRules: scenario.general_rules || scenario.rules?.general || [],
		taskRules: scenario.task_rules || scenario.rules?.task_specific || [],
		probes: scenario.probes || {},
		split: {
			membership: entry.split_membership,
			variant_family: entry.variant_family,
			variant_seed: entry.variant_seed,
			parent_scenario_id: entry.parent_scenario_id || '',
		},
		heldOut,
		privateSourcePath: sealedSource(heldOut.public_reference, `entries/${entry.id}/scenario_manifest`),
	};
}

function loadHeldOutPack(input, options = {}) {
	const manifestFile = path.resolve(input);
	const manifest = readJson(manifestFile);
	const validation = validatePackManifest(manifest, manifestFile, {
		requireLocalArtifacts: options.requireLocalArtifacts !== false,
	});
	if (!validation.ok) {
		const codes = validation.compatibility_gaps.map((gap) => gap.code).join(', ');
		throw new Error(`Held-out pack validation failed: ${codes}`);
	}
	return { manifestFile, manifest };
}

function loadHeldOutPackTasks(input, options = {}) {
	const pack = loadHeldOutPack(input, options);
	return {
		...pack,
		tasks: pack.manifest.entries.map((entry) => scenarioTaskFromEntry(pack.manifest, pack.manifestFile, entry)),
	};
}

function publicHeldOutPackSummary(input, options = {}) {
	const { manifestFile, manifest, tasks } = loadHeldOutPackTasks(input, options);
	return {
		ok: true,
		manifest: path.relative(root, manifestFile).startsWith('..') ? '<private-pack>' : path.relative(root, manifestFile).replace(/\\/g, '/'),
		pack: {
			id: manifest.pack.id,
			version: manifest.pack.version,
			compatibility_group: manifest.pack.compatibility_group,
			public_reference: manifest.pack.public_reference || null,
		},
		boundary: {
			storage: manifest.boundary.storage,
			artifact_access: manifest.boundary.artifact_access,
			public_report_policy: manifest.boundary.public_report_policy,
		},
		entries: tasks.map((task) => ({
			entry_id: task.heldOut.entry_id,
			scenario_id: task.id,
			parent_scenario_id: task.heldOut.parent_scenario_id,
			variant_family: task.heldOut.variant_family,
			variant_seed: task.heldOut.variant_seed,
			split_membership: task.heldOut.split_membership,
			calibration_status: task.calibration.status,
			task_contract_level: task.calibration.task_contract_level,
			sealed_hashes: task.heldOut.sealed_hashes,
			resolved_artifacts: Object.fromEntries(requiredArtifacts.map((name) => [name, true])),
		})),
	};
}

function parseArgs(argv) {
	const args = { input: process.env.WP_GYM_HELD_OUT_PACK || process.env.HELD_OUT_PACK_MANIFEST || '', requireLocalArtifacts: true };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--input') {
			args.input = argv[++index];
		} else if (arg === '--no-require-local-artifacts') {
			args.requireLocalArtifacts = false;
		} else if (arg === '--dry-run') {
			args.dryRun = true;
		} else if (arg === '--help' || arg === '-h') {
			args.help = true;
		} else if (!args.input) {
			args.input = arg;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || !args.input) {
		console.error('Usage: node scripts/resolve-held-out-pack.mjs --input <private-pack-manifest.json> [--dry-run] [--no-require-local-artifacts]');
		process.exit(args.help ? 0 : 2);
	}
	console.log(JSON.stringify(publicHeldOutPackSummary(args.input, { requireLocalArtifacts: args.requireLocalArtifacts }), null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}

export { loadHeldOutPackTasks, publicHeldOutPackSummary };
