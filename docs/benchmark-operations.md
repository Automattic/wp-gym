# Benchmark Artifact Operations

Issue: [#244](https://github.com/Automattic/wp-gym/issues/244)

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

## Operational Check

`npm run benchmark-ops:validate` verifies the repo-owned operational contract:

- Artifact uploads set explicit `retention-days`.
- Registry uploads retain both `artifacts/wp-gym-run-registry` and `artifacts/live-replay-bundles`.
- Registry uploads fail closed when required payloads are missing.
- The scheduled Benchmark Artifact Ops workflow runs registry, emitter, and remote archive checks.
- These operations docs remain tied to issue #244.

The `Benchmark Artifact Ops` workflow runs on pull requests, manual dispatch, and
a weekly schedule. It validates configuration and fixture-backed report paths; it
does not make live model calls.

## Durable Shared Evidence

Shared benchmark evidence should point to GitHub workflow artifacts, PRs, issues,
releases, or committed docs. Keep local-only paths and local-only URLs in operator
notes, not reviewer-facing evidence.

Use these references in comments and reports:

- GitHub Actions run URL for the live workflow.
- `wp-gym-run-registry-<workflow-run-id>` artifact name.
- PR or issue comment containing the regenerated Markdown report.
- Release asset or committed report when a benchmark package is promoted.
