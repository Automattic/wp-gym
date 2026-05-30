# Benchmark Artifact Operations

Issues: [#244](https://github.com/Automattic/wp-gym/issues/244), [#258](https://github.com/Automattic/wp-gym/issues/258), [#262](https://github.com/Automattic/wp-gym/issues/262)

Benchmark consumers need retained artifacts, reproducible registry reports, and a
small operational check that catches missing evidence before a run is cited.

## Retention Policy

| Artifact | Producer | Durable location | retention-days | Failure handling |
| --- | --- | --- | --- | --- |
| `wp-gym-run-registry-<workflow-run-id>` | `Data Machine Live Task Run` `emit-run-registry` job | GitHub Actions artifact attached to the workflow run | 90 | Upload uses `if-no-files-found: error`; missing registry or replay payload fails the job. |
| `wp-gym-smoke-task` | `Playground Smoke` workflow | GitHub Actions artifact attached to the workflow run | 30 | Upload keeps smoke evidence when present and warns when Homeboy did not emit optional files. |
| Remote archive triage reports | `wp-gym remote-archive triage` | Committed report, PR comment, issue comment, release asset, or GitHub Actions artifact | Operator-owned | Triage exits nonzero on error-severity gaps such as missing reviewer reports or failed validations. |

Keep private held-out packs and private artifacts in their owning private lab or
artifact store. Public reports should include sealed hashes, aggregate outcomes,
and durable references, not private task contents.

## Registry Report Regeneration

Registry reports can be regenerated from retained registry entries and replay
bundles:

```bash
npm run run-registry:report -- \
  --registry artifacts/wp-gym-run-registry/entries \
  --json artifacts/wp-gym-run-registry/report.json \
  --markdown artifacts/wp-gym-run-registry/report.md \
  --scope pilot
```

The live workflow uploads `artifacts/wp-gym-run-registry` together with
`artifacts/live-replay-bundles` so reviewers can rerun the report command against
the retained evidence. Benchmark or headline reports should use
`--benchmark-mode` and should only cite rows that pass registry validation.

## Historical Retention Proof

`npm run artifact-retention:test` rebuilds a historical retained-run fixture set in
a temporary artifact store, validates each registry row in benchmark mode, and
regenerates the JSON and Markdown registry report from those retained rows. The
fixture set covers separate historical workflow run IDs and verifies that retained
registry rows, eval artifacts, replay bundles, task manifests, and scenario
manifests remain local, hashable, and report-regenerable.

The same check intentionally corrupts retained references to prove actionable
failures:

- Missing replay bundle references produce `missing_local_artifact` diagnostics.
- Stale eval artifact hashes produce `stale_artifact_hash` diagnostics.
- Remote transcript references produce `remote_artifact_not_hashable_locally`
  diagnostics in benchmark mode.

The regenerated report is also scanned for local-only evidence links. Public
benchmark comments should link to GitHub Actions run URLs, workflow artifact
names, PRs, issues, releases, or committed reports instead of temporary runner
paths.

## Operational Check

`npm run benchmark-ops:validate` verifies the repo-owned operational contract:

- Artifact uploads set explicit `retention-days`.
- Registry uploads retain both `artifacts/wp-gym-run-registry` and `artifacts/live-replay-bundles`.
- Registry uploads fail closed when required payloads are missing.
- The scheduled Benchmark Artifact Ops workflow runs registry, emitter, and remote archive checks.
- Stability Budget fixtures classify infra/provider/artifact/runner/task/grader failures.
- Historical retained-run fixtures validate missing, stale, and unhashable artifacts and regenerate reports.
- These operations docs remain tied to issues #244, #258, and #262.

The `Benchmark Artifact Ops` workflow runs on pull requests, manual dispatch, and
a weekly schedule. It validates configuration and fixture-backed report paths; it
does not make live model calls.

## Stability Budget

Benchmark reports should publish a moving-window stability report beside the run
registry report before citing live results. The stability report classifies
failures into these operational buckets:

| Class | Owner lane | Examples |
| --- | --- | --- |
| `infra` | CI/runtime infrastructure | hosted runner loss, checkout/network failures, disk pressure |
| `provider` | model provider | rate limits, provider timeouts, quota or temporary model unavailability |
| `artifact` | evidence transport | upload/download failures, missing retained artifacts |
| `runner` | orchestration | Homeboy/wp-codebox/opencode runner crash, process exit, command contract failure |
| `task` | scenario/runtime task | invalid scenario setup, WordPress app fatal, fixture contract mismatch |
| `grader` | grading | hidden grader exception, assertion bug, grader schema mismatch |

Default accepted failure-rate budgets are enforced per moving window:

| Workflow or family | Total | infra | provider | artifact | runner | task | grader |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `datamachine-live-run` | 5% | 2% | 3% | 1% | 2% | 2% | 1% |
| `benchmark-artifact-ops` | 2% | 1% | 0% | 1% | 1% | 0% | 0% |
| `playground-smoke` | 8% | 3% | 3% | 2% | 3% | 3% | 1% |
| `block-markup` task family | 5% | 2% | 3% | 1% | 2% | 2% | 1% |
| `wordpress-api` task family | 7% | 2% | 3% | 1% | 3% | 3% | 1% |

Generate the report from retained registry rows or fixture-backed operational
rows:

```bash
npm run stability-budget:report -- \
  --registry artifacts/wp-gym-run-registry/entries \
  --window-runs 50 \
  --window-days 30 \
  --json artifacts/wp-gym-run-registry/stability-report.json \
  --markdown artifacts/wp-gym-run-registry/stability-report.md \
  --fail-on-budget
```

Use `--window-runs` for repeated-run slices and `--window-days` for sustained
moving-window evidence. A passing report means every workflow and task-family
bucket stayed within its accepted flake threshold. A failing report should block
benchmark promotion or update the linked issue with the over-budget class,
workflow/task family, run IDs, and remediation owner lane.

Repeated runs are treated as flakes when the same workflow, task family,
scenario, provider, and model has at least one pass and at least one operational
failure inside the window. The JSON report includes `flaky_operations` so issue
updates can point directly at the unstable operation instead of hiding it in an
aggregate pass rate.

## Durable Shared Evidence

Shared benchmark evidence should point to GitHub workflow artifacts, PRs, issues,
releases, or committed docs. Keep local-only paths and local-only URLs in operator
notes, not reviewer-facing evidence.

Use these references in comments and reports:

- GitHub Actions run URL for the live workflow.
- `wp-gym-run-registry-<workflow-run-id>` artifact name.
- PR or issue comment containing the regenerated Markdown report.
- Release asset or committed report when a benchmark package is promoted.
