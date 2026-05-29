# Benchmark Readiness Pilot

Issue: [#9](https://github.com/Automattic/wp-gym/issues/9)

This runbook defines the smallest useful pilot matrix for proving `wp-gym` is
ready to collect baseline evidence without treating the results as benchmark
scores yet.

Benchmark versioning and compatibility policy is defined in
[`benchmark-versioning.md`](benchmark-versioning.md). The pilot task set may
carry prerelease benchmark metadata for traceability, but headline comparison
requires the benchmark-ready gates below.

The pilot answers the current review questions:

- Executable local environment shape: every row resolves to a WP Codebox-backed
  disposable WordPress runtime through the Data Machine live-run workflow.
- Calibration: every row keeps `benchmark_eligible=false` until baseline result
  sets and difficulty bands are recorded in scenario calibration metadata.
- Reward hacking: scenario manifests surface known shortcuts and the runner PR
  body reports benchmark blockers instead of hiding them behind a score.
- Replay evidence: each live row is expected to preserve a Homeboy result JSON,
  transcript artifact, replay bundle, hidden-grade checks, and generated PR body.

## Pilot Matrix

Use `task-sets/benchmark-readiness-pilot.json` for the first evidence run.

It selects four tasks across the shape requested in issue #9:

| Family | Scenario | Runtime shape | Why included |
| --- | --- | --- | --- |
| Gutenberg/block | `block-markup-valid-semantic-blocks` | WordPress state grader | Basic editable block output. |
| Gutenberg/block | `block-markup-no-fallback-pricing-section` | WordPress state grader | Known reward-shortcut pressure for empty block skeletons. |
| Abilities/API | `modern-wordpress-api-abilities-site-summary` | WP Codebox workspace plus WP-CLI grader | Plugin workspace, Abilities API lifecycle, generated PR evidence. |
| REST/plugin | `modern-wordpress-api-rest-route-status` | WP Codebox workspace plus WP-CLI grader | Plugin workspace, REST route contract, permission callback checks. |

The provider matrix is intentionally small:

| Provider | Model | Secret |
| --- | --- | --- |
| OpenAI | `gpt-5.5` | `OPENAI_API_KEY` |
| Anthropic | `claude-opus-4-7` | `ANTHROPIC_API_KEY` |

The resolved matrix contains 8 rows: 4 tasks times 2 providers. Four rows are
workspace-backed and should produce runner-owned generated PRs when they make
changes.

## Safe Checks

Run these before any live model call:

```sh
npm ci
npm run verify
TASK_SET=benchmark-readiness-pilot npm run matrix:live-run
TASK_SET=benchmark-readiness-pilot node scripts/resolve-live-run-matrix.mjs --check
BENCHMARK_MODE=1 TASK_SET=benchmark-readiness-pilot node scripts/resolve-live-run-matrix.mjs --check
```

Expected result:

- `npm run verify` passes schema, task-set, local API, runtime-plan, and matrix
  validation.
- `TASK_SET=benchmark-readiness-pilot node scripts/resolve-live-run-matrix.mjs --check`
  passes and reports 8 rows.
- The `BENCHMARK_MODE=1` command fails while this is still a pilot. That failure
  is intentional evidence that the matrix cannot be accidentally promoted to a
  benchmark scoreboard before calibration gates are satisfied.

## Dry-Run Workflow

Use the dry-run workflow first. It resolves the same matrix and runner config
without provider calls.

```sh
gh workflow run datamachine-live-run.yml \
  --repo Automattic/wp-gym \
  --ref main \
  -f task_set=benchmark-readiness-pilot \
  -f task_ids= \
  -f bundle_ref= \
  -f dry_run=true \
  -f agent_runtime=wp-codebox
```

Collect the run ID and inspect the resolved matrix:

```sh
gh run list --repo Automattic/wp-gym --workflow datamachine-live-run.yml --limit 5
gh run view <run-id> --repo Automattic/wp-gym --json url,conclusion,status,event,headBranch
gh run download <run-id> --repo Automattic/wp-gym --dir artifacts/<run-id>
```

Dry-run evidence proves:

- The workflow can resolve the selected task set.
- Provider/plugin configuration is explicit and secret-safe.
- Matrix rows include task IDs, provider/model labels, benchmark blockers, prompt
  content, artifact suffixes, runner workspace config, and hidden grader hooks.
- Workspace-backed rows target `Automattic/wp-gym`, hide private grader/scenario
  files from the agent workspace, and limit writes to `plugins/`.

Dry-run evidence does not prove model quality, grader calibration, or replay
completeness for a finished episode.

## Live Pilot Run

Run this only after the dry-run workflow is green and repository secrets are set.
It makes live provider calls.

```sh
gh workflow run datamachine-live-run.yml \
  --repo Automattic/wp-gym \
  --ref main \
  -f task_set=benchmark-readiness-pilot \
  -f task_ids= \
  -f bundle_ref= \
  -f dry_run=false \
  -f agent_runtime=wp-codebox
```

Watch and collect the run:

```sh
gh run watch <run-id> --repo Automattic/wp-gym --exit-status
gh run view <run-id> --repo Automattic/wp-gym --json url,conclusion,status,jobs
gh run download <run-id> --repo Automattic/wp-gym --dir artifacts/<run-id>
```

Expected live artifacts:

- `wp-gym-transcript-<run>-<task>-<provider-model>` for the model conversation
  and tool transcript.
- `wp-gym-replay-<run>-<task>-<provider-model>` for replayable episode evidence
  and artifact hashes.
- Homeboy result JSON with `metadata.eval_artifact`, `metadata.fingerprints`,
  rule metadata, grader result, failure class, and workflow/report links.
- Generated PRs for workspace-backed tasks, with task/model/result labels,
  hidden-grade checks, changed-file summary, tool summary, and artifact links in
  the PR body.

## Pilot Summary Template

After a live pilot, summarize results in the tracking issue with this table:

| Task | Provider/model | Outcome | Reward | Failure class | Failed checks | PR | Replay artifact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `<task_id>` | `<provider>/<model>` | `<passed|failed|errored>` | `<0..1>` | `<class>` | `<ids>` | `<url>` | `<artifact>` |

Include these rollups below the table:

- Runtime failures versus agent failures versus grader failures versus task
  failures.
- Repeated failure reasons that indicate task ambiguity or reward shortcuts.
- Any rows where artifacts are missing or cannot replay the episode.
- Any generated PR that lacks enough evidence in the body for review without
  downloading artifacts.

## Benchmark-Ready Gates

The pilot becomes benchmark-ready only after these gates are complete:

- At least two repeat runs preserve comparable replay artifacts and PR summaries
  for the full matrix.
- Scenario `calibration.baseline_result_sets` records the pilot run IDs or artifact
  sets used as baselines.
- Scenario `calibration.difficulty_band` is no longer `uncalibrated`.
- Known reward shortcuts are either fixed by stronger graders or explicitly kept
  as non-headline diagnostic tasks.
- Each declared `calibration.known_shortcuts` entry has executable reward-hacking
  coverage: at least one `adversarial_negative_fixture` for the shortcut and a
  nearby `positive_control_fixture` whose `covers_shortcut_ids` includes it.
- Calibration result sets use `schemas/calibration-result.schema.json` and include
  no-op, heuristic/scripted, cheap-model, frontier-model, repeated-attempt, and
  human/reference rows before any pass-rate claim is treated as benchmark data.
- Scenario calibration records `calibration_result_sets`, a calibrated
  `pass_rate_band`, a 95% confidence interval, and
  `held_out_private_variants_ready=true` before benchmark mode can pass.
- Scenario `calibration.task_contract_level` reaches `benchmark_replay` for rows
  that count toward headline scores.
- The task set flips to `benchmark_status=benchmark_ready`, `benchmark=true`,
  `headline_score_eligible=true`, `aggregate_score=true`, and
  `score_scope=benchmark` only after the gates above are satisfied.
- The task set and every included headline scenario declare benchmark version and
  compatibility metadata. Benchmark-ready scenarios also declare version identity
  hashes for manifest, prompt, grader, setup, expected artifacts, and replay
  contract inputs.

Until those gates are complete, pilot scores are evidence for runtime shape,
calibration work, reward-hacking analysis, and replay coverage. They are not a
benchmark leaderboard.
