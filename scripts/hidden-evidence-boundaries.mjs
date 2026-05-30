const requiredHiddenEvidenceKinds = [
	'hidden_grader',
	'held_out_variant',
	'private_fixture',
	'expected_answer',
	'task_policy_internal',
];

const requiredVisibleSurfaces = [
	'prompt',
	'tools',
	'workspace',
	'artifacts',
	'report_body',
];

const hiddenPathLeakPattern = /(^|\/|\b)(graders?|checks?|private-fixtures?|held-out|held_out|expected-answers?|expected_answers?|task-policy|task_policy)(\/|\b|_)/i;
const hiddenValueLeakPattern = /(^|\b)(hidden_grader|held_out_(?:prompt|grader|fixture|manifest)|private_fixture|expected_answer|task_policy_internal)(\b|_)/i;

function boundaryGap(code, severity, field, message) {
	return { code, severity, field, message };
}

function uniqueSorted(values) {
	return [...new Set(values.filter(Boolean))].sort();
}

function hiddenEvidenceCoverageGaps(boundary, field = 'isolation.hidden_evidence_boundaries') {
	const gaps = [];
	if (!boundary || typeof boundary !== 'object') {
		return [boundaryGap('missing_hidden_evidence_audit', 'error', field, 'Benchmark-mode rows must include hidden evidence boundary audit metadata.')];
	}

	const coveredKinds = new Set(Array.isArray(boundary.covered_evidence_kinds) ? boundary.covered_evidence_kinds : []);
	for (const kind of requiredHiddenEvidenceKinds) {
		if (!coveredKinds.has(kind)) {
			gaps.push(boundaryGap('hidden_evidence_kind_not_audited', 'error', `${field}.covered_evidence_kinds`, `Hidden evidence audit must cover ${kind}.`));
		}
	}

	const surfaces = Array.isArray(boundary.surfaces) ? boundary.surfaces : [];
	const coveredSurfaces = new Set(surfaces.map((surface) => surface?.name));
	for (const surface of requiredVisibleSurfaces) {
		if (!coveredSurfaces.has(surface)) {
			gaps.push(boundaryGap('hidden_evidence_surface_not_audited', 'error', `${field}.surfaces`, `Hidden evidence audit must cover visible ${surface} surface.`));
		}
	}

	for (const [index, surface] of surfaces.entries()) {
		const findings = Array.isArray(surface?.findings) ? surface.findings : [];
		for (const finding of findings) {
			const exposed = finding?.exposed === true || finding?.status === 'exposed' || finding?.severity === 'error';
			if (exposed) {
				gaps.push(boundaryGap('hidden_evidence_exposed', 'error', `${field}.surfaces[${index}].findings`, `Visible ${surface.name || 'unknown'} surface exposes ${finding.kind || 'hidden evidence'}.`));
			}
		}
	}

	const acceptedExposures = Array.isArray(boundary.accepted_exposures) ? boundary.accepted_exposures : [];
	for (const [index, exposure] of acceptedExposures.entries()) {
		if (!['pilot_only', 'non_benchmark'].includes(exposure?.scope)) {
			gaps.push(boundaryGap('accepted_exposure_not_pilot_only', 'error', `${field}.accepted_exposures[${index}].scope`, 'Accepted hidden evidence exposures must be scoped to pilot_only or non_benchmark.'));
		}
	}

	return gaps;
}

function hiddenEvidenceTextFindings(value, field) {
	const findings = [];
	const visit = (candidate, path) => {
		if (typeof candidate === 'string') {
			if (hiddenPathLeakPattern.test(candidate) || hiddenValueLeakPattern.test(candidate)) {
				findings.push(boundaryGap('hidden_evidence_reference_visible', 'error', path, `${field} contains hidden evidence reference: ${candidate}`));
			}
			return;
		}
		if (Array.isArray(candidate)) {
			candidate.forEach((item, index) => visit(item, `${path}[${index}]`));
			return;
		}
		if (candidate && typeof candidate === 'object') {
			for (const [key, item] of Object.entries(candidate)) {
				visit(item, `${path}.${key}`);
			}
		}
	};
	visit(value, field);
	return findings;
}

function validateHiddenEvidenceBoundary(boundary, { benchmarkMode = false, field = 'isolation.hidden_evidence_boundaries' } = {}) {
	const gaps = hiddenEvidenceCoverageGaps(boundary, field);
	if (benchmarkMode && boundary?.benchmark_mode_eligible !== true) {
		gaps.push(boundaryGap('hidden_evidence_audit_not_benchmark_eligible', 'error', `${field}.benchmark_mode_eligible`, 'Benchmark-mode rows must explicitly pass hidden evidence boundary audit.'));
	}
	if (!benchmarkMode) {
		return gaps.filter((gap) => gap.code !== 'missing_hidden_evidence_audit');
	}
	return gaps;
}

function hiddenEvidenceSummary(boundary) {
	const surfaces = Array.isArray(boundary?.surfaces) ? boundary.surfaces : [];
	return {
		covered_evidence_kinds: uniqueSorted(Array.isArray(boundary?.covered_evidence_kinds) ? boundary.covered_evidence_kinds : []),
		covered_surfaces: uniqueSorted(surfaces.map((surface) => surface?.name)),
		benchmark_mode_eligible: boundary?.benchmark_mode_eligible === true,
		accepted_exposures: Array.isArray(boundary?.accepted_exposures) ? boundary.accepted_exposures : [],
	};
}

export {
	boundaryGap,
	hiddenEvidenceTextFindings,
	requiredHiddenEvidenceKinds,
	requiredVisibleSurfaces,
	validateHiddenEvidenceBoundary,
	hiddenEvidenceSummary,
};
