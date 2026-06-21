# Replay And Regrade

Replay/regrade is the maintainer workflow for proving that a benchmark row can be
reproduced from its uploaded evidence.

## One-Command Workflow

Download the GitHub Actions artifact for a live run, then run:

```sh
wp-gym replay path/to/downloaded-artifact.zip --regrade
```

The input may be a canonical eval artifact JSON file, an extracted artifact
directory, or a `.zip` downloaded from GitHub Actions. Zip inputs are extracted to
a temporary directory before validation so artifact references are checked against
the downloaded files.

`--regrade` enables benchmark-mode validation. The command fails nonzero when any
required local artifact is missing, any declared SHA-256 does not match the local
file, the replay trace is incompatible, the grader cannot run, or the regraded
output drifts from the sealed eval artifact.

## Output Contract

The command writes structured JSON:

```json
{
  "ok": true,
  "benchmark_mode": true,
  "regrade": true,
  "summary": {
    "total": 1,
    "ok": 1,
    "failed": 0,
    "failure_classes": { "none": 1 }
  },
  "results": []
}
```

Each result includes `regrade_status` so run-registry ingestion and issue/PR
summaries can distinguish:

- `none`: the original grade was reproduced and passed.
- `task_failure`: the original grade was reproduced and failed the task checks.
- `runtime_failure`: full episode replay could not run against the local runtime.
- `grader_failure`: the terminal grader failed or returned invalid output.
- `replay_incompatibility`: the artifact bundle is missing required local evidence,
  has mismatched hashes, has an incompatible trace, or the regraded output drifted
  from the sealed grade/check/failure-reason data.

Replayable action types are replayed through the local `WPGym` episode API.
Evidence-only action types remain audited in the trace and are reported as
warnings until the local replay harness supports them.

Browser/editor traces use the same rule. Their actions and observations validate
against `schemas/action.v1.schema.json`, `schemas/observation.v1.schema.json`,
and `schemas/trace.v1.schema.json`. Replayable browser `navigate`, `click`,
`fill`, `press`, and `capture` actions run through the runtime browser-action
adapter; evidence-only browser traces and editor traces are classified as
audit-only. Audit-only traces still verify retained state evidence and rerun the
terminal grader; they do not attempt to synthesize UI state that the runtime
cannot replay.

The replay metadata envelope defines the required browser/editor conditions:

- `reset`: clean-site, WordPress-state, or workspace-snapshot starting point plus
  optional seed and local state reference.
- `viewport`: width, height, scale factor, and mobile mode.
- `timing`: default timeout, readiness wait, and settle delay.
- `screenshots`: whether screenshots are required and how they were captured.
- `state`: DOM, editor-store, network, and console evidence requirements.

Fixtures cover the supported paths:

- `fixtures/replay-regrade/episode-trace.json` proves deterministic full-episode
  replay for current replayable action types.
- `fixtures/replay-regrade/browser-editor-audit-trace.json` proves browser/editor
  audit-only regrade with explicit warnings.
- `fixtures/replay-regrade/browser-editor-mismatch-trace.json` proves mismatched
  browser/editor action/result evidence fails instead of being silently accepted.

## Reproducing A Benchmark Row

1. Open the live run from the benchmark evidence table.
2. Download the `wp-gym-run-registry-<run-id>` artifact from GitHub Actions.
3. Run `wp-gym replay ~/Downloads/wp-gym-run-registry-<run-id>.zip --regrade`.
4. Attach the JSON summary to the issue or PR that promotes the benchmark row.

For local fixture coverage, run:

```sh
npm run replay-regrade:test
```

## Retained Live-Row Scale Report

After downloading or retaining a live `wp-gym-run-registry-<run-id>` artifact, the
registry report can replay/regrade every retained row from the artifact files:

```sh
npm run run-registry:report -- \
  --registry artifacts/wp-gym-run-registry/entries \
  --regrade \
  --json artifacts/wp-gym-run-registry/report.json \
  --markdown artifacts/wp-gym-run-registry/report.md \
  --scope pilot
```

The `replay_regrade` section reports attempted rows, deterministic rows, success
rate, drift rate, failure classes, gap codes, and fail-closed counts for rows that
are incomplete or nondeterministic. Rows with missing local evidence, stale hashes,
incompatible traces, grader failures, or grade drift are rejected instead of being
silently included in the accepted report rows.

To collect fresh retained live evidence without launching it implicitly, dispatch
the live workflow explicitly:

```sh
gh workflow run datamachine-live-run.yml \
  --repo Automattic/wp-gym \
  --ref feat/issue-254-live-replay-scale \
  -f task_set=benchmark-readiness-pilot \
  -f task_ids='' \
  -f bundle_ref='' \
  -f dry_run=false \
  -f attempts_per_model=30
```

The workflow now emits `report.json` and `report.md` with `--regrade`, so the
uploaded run-registry artifact carries the scale replay/regrade summary alongside
the retained replay bundles.
