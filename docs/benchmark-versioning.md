# Benchmark Versioning And Promotion Policy

Issues: [#137](https://github.com/Automattic/wp-gym/issues/137), [#259](https://github.com/Automattic/wp-gym/issues/259)

`wp-gym` results are comparable only inside an explicit benchmark version and
compatibility group. Pilot and calibration runs can produce useful evidence, but
they are not headline scores until the task set and every included scenario pass
the gates below.

## Metadata Shape

Task sets may declare `benchmark_metadata` at the top level. Scenarios may
declare `calibration.benchmark_metadata`.

```json
{
  "benchmark_metadata": {
    "benchmark_version": "1.0.0",
    "compatibility_group": "core-block-editing-v1",
    "compatible_with": [],
    "version_identity": {
      "manifest_sha256": "<sha256>",
      "prompt_sha256": "<sha256>",
      "grader_sha256": "<sha256>",
      "setup_sha256": "<sha256>",
      "expected_artifacts_sha256": "<sha256>",
      "replay_contract_sha256": "<sha256>"
    }
  }
}
```

`benchmark_version` is semver-like. Pre-1.0 prerelease versions such as
`0.0.0-pilot.1` are allowed for pilot evidence. `compatibility_group` names the
scoreboard lane where results can be compared. `compatible_with` lists previous
versions in the same group that remain comparable.

## Benchmark Release Artifact

Canonical benchmark releases live in `benchmark-releases/`. Generate a release
candidate from repo metadata with:

```sh
npm run benchmark-release:generate -- \
  --task-set benchmark-readiness-pilot \
  --output benchmark-releases/benchmark-readiness-pilot-0.0.0-pilot.1.json
```

Validate checked-in release candidates with:

```sh
npm run benchmark-release:validate
wp-gym benchmark-release validate
```

The release artifact is the boundary that frontier-lab consumers can cite. It is
derived from the task-set manifest and included scenario manifests, prompts,
graders, setup metadata, expected artifacts, and replay contracts. The checked-in
artifact shape includes:

- `schema_version`: release manifest contract version.
- `report_schema_version`: the report contract that benchmark-mode consumers must
  surface, currently `wp-gym/benchmark-release-report/v1`.
- `release`: release id, type, status, benchmark version, compatibility group,
  task-set manifest path/hash, score scope, headline eligibility, aggregate
  eligibility, and task contract level.
- `policies`: task-set, scoring, runtime/provenance, private-pack, and
  compatibility policy statements that govern the release.
- `scenarios`: one entry per included task with manifest/prompt/grader paths,
  scenario version, compatibility group, split/private-pack reference, task
  contract level, expected artifacts, and the full version identity hash envelope.
- `validation`: maintainer commands and release checklist items that must pass
  before the artifact is cited.

`benchmark-releases/benchmark-readiness-pilot-0.0.0-pilot.1.json` is intentionally
classified as `type=pilot` and `status=pilot`: it proves the release machinery and
calibration artifact shape without making headline benchmark claims.

## Release Status Discipline

Use these release types in reports and release artifacts:

- `pilot`: early evidence, demo runs, or mixed diagnostic task contracts. Pilot
  releases may be useful for harness debugging but are not headline scores.
- `calibration`: repeated attempts, cheap baselines, held-out readiness, and
  grader soundness are being measured. Calibration releases can compare internal
  gates, not public headline ranks.
- `headline`: benchmark-ready task set with held-out/private split, benchmark
  replay, promotion report, immutable provenance, and empty blockers.

Benchmark-mode run-registry rows must identify the exact release via
`benchmark.release_id`, `benchmark.release_version`, `benchmark.release_type`,
`benchmark.release_status`, `benchmark.release_manifest`, and
`benchmark.release_manifest_sha256`. `npm run run-registry:validate` checks those
fields in benchmark mode and verifies local release-manifest hashes when the
manifest is repo-relative.

## Scenario Version Identity

A benchmark-ready scenario version is the hash envelope over the task contract:

- `manifest_sha256`: canonical scenario manifest metadata.
- `prompt_sha256`: user/developer prompt text shown to the agent.
- `grader_sha256`: hidden terminal grader code.
- `setup_sha256`: reset fixture, workspace template, allowed tools, hidden paths,
  writable roots, and runtime setup inputs.
- `expected_artifacts_sha256`: expected artifact names and replay-critical
  evidence requirements.
- `replay_contract_sha256`: episode schema, allowed action types, success checks,
  replay bundle requirements, and grade identity rules.

Any changed hash creates a new scenario version unless the change is limited to a
patch-level metadata correction listed below.

## Compatibility Rules

Runs are comparable when all of these match:

- Same task-set `compatibility_group`.
- Same task-set `benchmark_version`, or the newer task set lists the older version
  in `compatible_with`.
- Same scenario `compatibility_group` for each row.
- Same scenario `benchmark_version`, or the newer scenario lists the older version
  in `compatible_with`.
- Same headline eligibility and aggregate-score policy.

Provider/model changes do not require a new benchmark version. Runtime, prompt,
grader, setup, expected-artifact, or replay-contract changes require a new
version unless the old and new versions are explicitly listed as compatible.

## Promotion States

- `demo`: examples and smoke tests; never headline eligible.
- `pilot`: useful live-run evidence; missing one or more benchmark gates.
- `calibrating`: baseline and repeat-run evidence is being collected.
- `benchmark_ready`: headline-score eligible after all gates pass.
- `deprecated`: still retained for historical comparison, but no new headline runs.
- `retired`: kept only for archived result retention and replay.
- `excluded`: diagnostic or unsuitable for benchmark scoring.

## Headline And Aggregate Gates

Set `headline_score_eligible=true`, `aggregate_score=true`, and
`score_scope=benchmark` only when:

- The task set has `benchmark_status=benchmark_ready` and `benchmark=true`.
- The task set has `benchmark_metadata.benchmark_version` and
  `benchmark_metadata.compatibility_group`.
- Every included scenario has `calibration.status=benchmark_ready`,
  `calibration.benchmark_scope=benchmark`, and
  `calibration.headline_score_eligible=true`.
- Every included scenario has `calibration.benchmark_metadata.benchmark_version`,
  `calibration.benchmark_metadata.compatibility_group`, and full
  `version_identity` hashes.
- Every included scenario records baseline result sets, calibration result sets,
  a calibrated pass-rate band, a 95% confidence interval, and
  `held_out_private_variants_ready=true`.
- Known reward shortcuts are either fixed or the scenario remains non-headline.
- The task-set and scenario `benchmark_blockers` arrays are empty.

Benchmark mode validation fails when a row lacks the version or compatibility
metadata needed for a headline comparison.

Promotion governance is enforced by
[`benchmark-promotion-governance.md`](benchmark-promotion-governance.md). A
benchmark-ready scenario or benchmark task set must include a current passing
`promotion_report` fragment generated by `wp-gym benchmark-promotion report`.
`npm run validate` rejects promoted metadata when that fragment is absent or stale
for the current manifest inputs.

## Version Bumps

New benchmark version required:

- Prompt wording changes that affect task requirements or hints.
- Grader behavior, score thresholds, or hidden checks change.
- Scenario manifest rules, runtime setup, fixtures, writable/hidden paths, allowed
  tools, expected artifacts, or replay contract change.
- Task-set membership, weighting, aggregate policy, or headline eligibility changes.
- Release artifact policy changes that alter task, scoring, runtime/provenance,
  private-pack, compatibility, validation, or report-schema requirements.
- Private or held-out pack content, grader, fixture, replay contract, sealed hash,
  or public-report policy changes.

Patch-level metadata update allowed:

- Typo fixes in labels, descriptions, docs, issue links, or notes.
- Adding evidence links or retention notes without changing task behavior.
- Marking an old version `deprecated` or `retired` while retaining its results.
- Regenerating a release artifact only because source hashes changed for one of the
  patch-level metadata updates above.

## Release Checklist

Before promoting or citing a benchmark release candidate:

- Run `npm run benchmark-release:validate` and confirm the generated fixture is
  fresh against current repo metadata.
- Run `npm run validate` so scenario and task-set benchmark metadata still pass
  repo contract checks.
- Run `npm run run-registry:validate` for benchmark-mode registry fixtures and
  release identity fields.
- Run `npm run benchmark-promotion:test` and, for headline releases, generate a
  fresh promotion report with `npm run benchmark-promotion:report -- --task-set <id>`.
- Confirm the release type/status matches the evidence lane: pilot, calibration,
  or headline.
- Confirm private-pack references are versioned and sealed without exposing private
  prompt, fixture, expected-output, or grader contents.
- Confirm reviewer-facing docs, reports, or PRs link to GitHub artifacts, issues,
  PRs, releases, or committed release manifests rather than local paths.

## Deprecation And Retention

Deprecated benchmark versions remain readable and replayable. They should retain
their run artifacts, matrix rows, task-set metadata, scenario metadata, and grade
identity. Retired versions are excluded from new aggregate scoreboards, but their
artifacts should remain available for historical audits as long as repository and
artifact retention allow.
