import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const scenarioRoot = path.join(root, 'scenarios');
const today = new Date(`${process.env.CURRICULUM_FRESHNESS_DATE || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
const dueSoonDays = Number.parseInt(process.env.CURRICULUM_DUE_SOON_DAYS || '14', 10);

const capabilityAreas = [
	'ai_features',
	'agent_tooling_automation_surfaces',
	'custom_admin_ui',
	'data_interaction_apis',
	'cli_operational_tooling',
	'theme_site_building',
	'gutenberg_blocks',
	'performance_diagnostics',
	'plugin_quality_wordpress_standards',
];

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

function daysUntil(dateString) {
	const dueDate = new Date(`${dateString}T00:00:00Z`);
	return Math.floor((dueDate.getTime() - today.getTime()) / 86400000);
}

const report = {
	generated_at: today.toISOString().slice(0, 10),
	due_soon_days: dueSoonDays,
	global_capability_coverage: Object.fromEntries(
		capabilityAreas.map((area) => [area, { primary: 0, secondary: 0, scenarios: [] }])
	),
	capability_areas: Object.fromEntries(
		capabilityAreas.map((area) => [area, {
			total: 0,
			fresh: 0,
			watch: 0,
			stale: 0,
			retired: 0,
			due_soon: 0,
			scenarios: [],
		}])
	),
	missing_api_provenance: [],
	missing_capability_coverage: [],
	missing_global_capability_metadata: [],
};

for (const file of await listScenarioFiles(scenarioRoot)) {
	const manifest = JSON.parse(await readFile(path.join(root, file), 'utf8'));
	const provenance = manifest.api_provenance;
	const capabilities = manifest.capabilities;

	if (!capabilities?.primary || !report.global_capability_coverage[capabilities.primary]) {
		report.missing_global_capability_metadata.push({ file, id: manifest.id });
	} else {
		report.global_capability_coverage[capabilities.primary].primary += 1;
		report.global_capability_coverage[capabilities.primary].scenarios.push({ id: manifest.id, file, role: 'primary' });
		for (const area of capabilities.secondary || []) {
			if (report.global_capability_coverage[area]) {
				report.global_capability_coverage[area].secondary += 1;
				report.global_capability_coverage[area].scenarios.push({ id: manifest.id, file, role: 'secondary' });
			}
		}
	}

	if (!provenance) {
		if (Array.isArray(manifest.tags) && manifest.tags.includes('modern-api')) {
			report.missing_api_provenance.push({ file, id: manifest.id });
		}
		continue;
	}

	const area = report.capability_areas[provenance.capability_area];
	if (!area) {
		continue;
	}

	const dueInDays = daysUntil(provenance.freshness.next_review_due);
	const isStale = provenance.freshness.status === 'stale' || dueInDays < 0;
	const isDueSoon = !isStale && dueInDays <= dueSoonDays;

	area.total += 1;
	area[provenance.freshness.status] += 1;
	if (isStale && provenance.freshness.status !== 'stale') {
		area.stale += 1;
	}
	if (isDueSoon) {
		area.due_soon += 1;
	}
	area.scenarios.push({
		id: manifest.id,
		file,
		api_surface: provenance.api_surface,
		freshness_status: provenance.freshness.status,
		next_review_due: provenance.freshness.next_review_due,
		due_in_days: dueInDays,
		stale: isStale,
		due_soon: isDueSoon,
		lifecycle_status: provenance.curriculum.lifecycle_status,
	});
}

for (const [area, summary] of Object.entries(report.capability_areas)) {
	if (report.global_capability_coverage[area].primary === 0 && report.global_capability_coverage[area].secondary === 0) {
		report.missing_capability_coverage.push(area);
	}
}

if (process.argv.includes('--json')) {
	console.log(JSON.stringify(report, null, 2));
} else {
	console.log(`API curriculum freshness report (${report.generated_at})`);
	console.log('');
	console.log('Global scenario capability coverage:');
	for (const [area, summary] of Object.entries(report.global_capability_coverage)) {
		console.log(`${area}: primary=${summary.primary} secondary=${summary.secondary}`);
	}
	console.log('');
	for (const [area, summary] of Object.entries(report.capability_areas)) {
		console.log(`${area}: total=${summary.total} fresh=${summary.fresh} watch=${summary.watch} stale=${summary.stale} due_soon=${summary.due_soon}`);
		for (const scenario of summary.scenarios) {
			const marker = scenario.stale ? 'STALE' : scenario.due_soon ? 'DUE_SOON' : scenario.freshness_status.toUpperCase();
			console.log(`  - ${scenario.id}: ${marker}, due=${scenario.next_review_due}, lifecycle=${scenario.lifecycle_status}, api=${scenario.api_surface}`);
		}
	}

	if (report.missing_api_provenance.length > 0) {
		console.log('');
		console.log('Modern API scenarios missing api_provenance:');
		for (const scenario of report.missing_api_provenance) {
			console.log(`  - ${scenario.id} (${scenario.file})`);
		}
	}

	if (report.missing_capability_coverage.length > 0) {
		console.log('');
		console.log(`Capability areas without global scenario coverage: ${report.missing_capability_coverage.join(', ')}`);
	}

	if (report.missing_global_capability_metadata.length > 0) {
		console.log('');
		console.log('Scenarios missing global capability metadata:');
		for (const scenario of report.missing_global_capability_metadata) {
			console.log(`  - ${scenario.id} (${scenario.file})`);
		}
	}
}

if (process.argv.includes('--check') && (report.missing_api_provenance.length > 0 || report.missing_global_capability_metadata.length > 0)) {
	process.exitCode = 1;
}
