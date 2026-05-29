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

## Reproducing A Benchmark Row

1. Open the live run from the benchmark evidence table.
2. Download the `wp-gym-run-registry-<run-id>` artifact from GitHub Actions.
3. Run `wp-gym replay ~/Downloads/wp-gym-run-registry-<run-id>.zip --regrade`.
4. Attach the JSON summary to the issue or PR that promotes the benchmark row.

For local fixture coverage, run:

```sh
npm run replay-regrade:test
```
