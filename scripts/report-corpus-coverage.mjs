import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scenarioRoot = path.join(root, 'scenarios');
const heldOutPackRoot = path.join(root, 'fixtures', 'held-out-packs');

const requestedAreas = [
	{
		id: 'gutenberg_blocks',
		label: 'Gutenberg blocks',
		matches: ['gutenberg_blocks', 'editable_core_blocks', 'parseable_block_markup', 'block-editor'],
	},
	{
		id: 'themes_site_editing',
		label: 'Themes/site editing',
		matches: ['theme_site_building', 'block_theme_choice', 'theme_json_templates_navigation', 'site-building'],
	},
	{
		id: 'plugin_apis',
		label: 'Plugin APIs',
		matches: ['plugin_quality_wordpress_standards', 'plugin-api', 'wordpress_docs_standards', 'supported_plugin_author_metadata'],
	},
	{
		id: 'rest_abilities',
		label: 'REST/Abilities',
		matches: ['rest-api', 'abilities-api', 'rest_route_registration', 'abilities_api_surface'],
	},
	{
		id: 'admin_ui',
		label: 'Admin UI',
		matches: ['custom_admin_ui', 'admin-ui', 'settings_api_registration', 'admin_capability_gating'],
	},
	{
		id: 'data_apis',
		label: 'Data APIs',
		matches: ['data_interaction_apis', 'settings-api', 'structured_site_state', 'structured_output'],
	},
	{
		id: 'cli_operations',
		label: 'CLI operations',
		matches: ['cli_operational_tooling', 'wp-cli', 'bounded_wp_cli_inspection', 'run_wp_cli'],
	},
	{
		id: 'media',
		label: 'Media',
		matches: ['media-import', 'attachments', 'media_library_api_usage', 'attachment_post_integrity'],
	},
	{
		id: 'permissions_security',
		label: 'Permissions/security',
		matches: ['permission_callback', 'permission_callback_present', 'admin_capability_gating', 'sanitized_option_storage', 'escaped_frontend_rendering'],
	},
	{
		id: 'performance',
		label: 'Performance',
		matches: ['performance', 'timings', 'request_counts', 'admin-editor-performance'],
	},
	{
		id: 'ai_tooling',
		label: 'AI/tooling surfaces',
		matches: ['ai_features', 'agent_tooling_automation_surfaces', 'ai-client', 'ai-provider', 'abilities-api'],
	},
];

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function repoRelative(file) {
	return path.relative(root, file).replace(/\\/g, '/');
}

function collectJsonFiles(dir) {
	if (!fs.existsSync(dir)) {
		return [];
	}

	const files = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectJsonFiles(entryPath));
		} else if (entry.isFile() && entry.name.endsWith('.json')) {
			files.push(entryPath);
		}
	}
	return files.sort();
}

function scenarioTokens(scenario) {
	return new Set([
		scenario.capabilities?.primary,
		...(scenario.capabilities?.secondary || []),
		...(scenario.capabilities?.criteria || []),
		...(scenario.tags || []),
		...(scenario.rules?.general || []),
		...(scenario.rules?.task_specific || []),
		...(scenario.episode_contract?.allowed_action_types || []),
		...(scenario.episode_contract?.success_checks || []),
		...(scenario.calibration?.known_shortcuts || []),
		...(scenario.calibration?.benchmark_blockers || []),
		...(scenario.expected_artifacts || []),
	].filter(Boolean));
}

function scenarioMatchesArea(scenario, area) {
	const tokens = scenarioTokens(scenario);
	return area.matches.some((match) => tokens.has(match));
}

function scenarioHeldOutStatus(scenario, heldOutEntriesByParent) {
	const indexedEntries = heldOutEntriesByParent.get(scenario.id) || [];
	if (indexedEntries.length > 0) {
		return {
			status: 'indexed',
			reference: indexedEntries.map((entry) => entry.id),
			note: 'Public-safe held-out pack index contains sealed metadata for this family.',
		};
	}

	const pointer = scenario.split?.held_out_private_variant;
	if (pointer?.status) {
		return {
			status: pointer.status,
			reference: pointer.reference || null,
			note: pointer.notes || null,
		};
	}

	const blockers = new Set(scenario.calibration?.benchmark_blockers || []);
	const isDiagnostic = scenario.calibration?.task_contract_level !== 'benchmark_replay';
	const isDemo = ['demo', 'excluded'].includes(scenario.calibration?.benchmark_scope);
	if (isDemo || isDiagnostic) {
		return {
			status: 'not_applicable',
			reference: null,
			note: `Not a benchmark-candidate family yet: ${[
				isDemo ? `${scenario.calibration?.benchmark_scope}_scope` : null,
				isDiagnostic ? scenario.calibration?.task_contract_level : null,
				...blockers,
			].filter(Boolean).join(', ')}.`,
		};
	}

	return {
		status: 'missing',
		reference: null,
		note: 'Benchmark-replay public family has no public-safe held-out pointer or sealed pack index entry.',
	};
}

function collectHeldOutEntriesByParent() {
	const entriesByParent = new Map();
	for (const file of collectJsonFiles(heldOutPackRoot)) {
		const manifest = readJson(file);
		for (const entry of manifest.entries || []) {
			if (!entry.parent_scenario_id) {
				continue;
			}
			const entries = entriesByParent.get(entry.parent_scenario_id) || [];
			entries.push({
				id: entry.id,
				file: repoRelative(file),
				variant_family: entry.variant_family,
				variant_seed: entry.variant_seed,
				calibration_status: entry.calibration_status || null,
			});
			entriesByParent.set(entry.parent_scenario_id, entries);
		}
	}
	return entriesByParent;
}

const scenarios = collectJsonFiles(scenarioRoot).map((file) => ({
	file: repoRelative(file),
	manifest: readJson(file),
}));
const heldOutEntriesByParent = collectHeldOutEntriesByParent();

const report = {
	schema_version: 1,
	generated_at: new Date().toISOString().slice(0, 10),
	issue: 'https://github.com/Automattic/wp-gym/issues/242',
	public_safe: true,
	coverage_areas: requestedAreas.map((area) => {
		const matchingScenarios = scenarios
			.filter(({ manifest }) => scenarioMatchesArea(manifest, area))
			.map(({ file, manifest }) => ({
				id: manifest.id,
				file,
				primary_capability: manifest.capabilities?.primary || null,
				benchmark_scope: manifest.calibration?.benchmark_scope || null,
				calibration_status: manifest.calibration?.status || null,
				task_contract_level: manifest.calibration?.task_contract_level || null,
				held_out_private: scenarioHeldOutStatus(manifest, heldOutEntriesByParent),
			}));
		return {
			id: area.id,
			label: area.label,
			status: matchingScenarios.length > 0 ? 'covered' : 'gap',
			scenarios: matchingScenarios,
		};
	}),
	benchmark_candidate_families: scenarios
		.filter(({ manifest }) => manifest.calibration?.task_contract_level === 'benchmark_replay')
		.map(({ file, manifest }) => ({
			id: manifest.id,
			file,
			variant_family: manifest.split?.variant_family || null,
			benchmark_scope: manifest.calibration?.benchmark_scope || null,
			calibration_status: manifest.calibration?.status || null,
			held_out_private: scenarioHeldOutStatus(manifest, heldOutEntriesByParent),
			benchmark_blockers: manifest.calibration?.benchmark_blockers || [],
		})),
};

report.remaining_gaps = report.coverage_areas
	.filter((area) => area.status === 'gap')
	.map((area) => area.id);
report.held_out_gaps = report.benchmark_candidate_families
	.filter((family) => family.held_out_private.status === 'missing')
	.map((family) => family.id);

if (process.argv.includes('--json')) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log(`Corpus coverage report (${report.generated_at})`);
	console.log('');
	for (const area of report.coverage_areas) {
		console.log(`${area.label}: ${area.status} (${area.scenarios.length} scenario${area.scenarios.length === 1 ? '' : 's'})`);
		for (const scenario of area.scenarios) {
			console.log(`  - ${scenario.id}: ${scenario.primary_capability}, ${scenario.benchmark_scope}/${scenario.calibration_status}, held-out=${scenario.held_out_private.status}`);
		}
	}
	console.log('');
	console.log(`Remaining requested-area gaps: ${report.remaining_gaps.length > 0 ? report.remaining_gaps.join(', ') : 'none'}`);
	console.log(`Benchmark-candidate held-out gaps: ${report.held_out_gaps.length > 0 ? report.held_out_gaps.join(', ') : 'none'}`);
}

if (process.argv.includes('--check') && report.held_out_gaps.length > 0) {
	process.exitCode = 1;
}
