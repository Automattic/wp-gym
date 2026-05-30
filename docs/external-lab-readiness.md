# External Lab Readiness

Issue: [#217](https://github.com/Automattic/wp-gym/issues/217)

`wp-gym` is ready for external RL/eval consumers to inspect and run a pilot
WordPress environment. It is not ready for headline benchmark claims until the
calibration and promotion gates under
[#127](https://github.com/Automattic/wp-gym/issues/127) are closed.

Use this page as the handoff runbook for labs that want to evaluate the current
environment shape, artifact contract, and remaining blockers.

## Current Status

The current supported surface is a pilot WordPress RL/eval loop:

| Area | Status |
| --- | --- |
| Scenario discovery | Available through the Node API and JSON CLI output. |
| Local episodes | Available for public scenarios through `WPGym.make()`, `reset()`, `step()`, `grade()`, and `trace()`. |
| Live model runs | Available through the manual `datamachine-live-run.yml` workflow. |
| Replay bundles | Uploaded by live runs and indexed by the run registry. |
| Registry reports | Available as JSON and Markdown summaries from validated registry entries. |
| Benchmark readiness | Blocked until calibration, repeated-run, held-out, replay-contract, and reward-soundness gates pass. |

Fresh pilot proof:

| Evidence | Value |
| --- | --- |
| Workflow run | https://github.com/Automattic/wp-gym/actions/runs/26664690962 |
| Workflow | `datamachine-live-run.yml` on `main` |
| Task set | `benchmark-readiness-pilot` |
| Models | OpenAI `gpt-5.5`, Anthropic `claude-opus-4-7` |
| Rows | 8 accepted / 8 inspected |
| Registry artifact | `wp-gym-run-registry-26664690962` |
| Registry summary | 8 passed, 0 failed, 0 errored, pilot pass@1 100% |
| Evidence comment | https://github.com/Automattic/wp-gym/issues/184#issuecomment-4580309580 |

That run proves matrix resolution, runner orchestration, WordPress runtime setup,
model calls, task execution, hidden grading, replay upload, registry emission, and
registry validation can complete end to end. It remains pilot evidence because the
rows are public, single-attempt, non-held-out, and not fully calibrated.

## Environment Shape

```text
external runner or GitHub workflow
        |
        v
wp-gym scenario + task-set metadata
        |
        v
WP Codebox-backed disposable WordPress episode
        |
        v
agent/model actions against WordPress state
        |
        v
hidden wp-gym grader -> reward/checks/failure reasons
        |
        v
replay bundle + canonical eval artifact + run registry entry
```

`wp-gym` owns scenario metadata, prompts, action/observation schemas, traces,
reward semantics, grader output, failure classes, eval artifacts, and registry
reports. WP Codebox supplies the disposable WordPress runtime substrate. Homeboy
and Data Machine provide live CI orchestration for the current pilot workflow.

The supported external API is JavaScript plus JSON CLI output. A Python or
Gymnasium wrapper is intentionally deferred until the action/observation contract
settles.

## Run Local Episodes

Install dependencies and inspect the public task surface:

```sh
npm ci
node bin/wp-gym.mjs list scenarios
node bin/wp-gym.mjs list task-sets
node bin/wp-gym.mjs show scenario block-markup-no-fallback-pricing-section
node bin/wp-gym.mjs capabilities block-markup-no-fallback-pricing-section
```

Run a no-model local episode:

```sh
node examples/no-model-episode.mjs block-markup-no-fallback-pricing-section
```

Run the external consumer proof from a clean throwaway package install:

```sh
npm run external-consumer:test
```

That command installs the current checkout into a temporary consumer project and
proves a lab can use only documented public surfaces: `import { WPGym } from
'wp-gym'`, exported schema subpaths, JSON CLI discovery, `reset()` / `step()` /
`grade()` / `trace()`, and `wp-gym run-registry validate --benchmark-mode`. The
expected terminal JSON includes `status: "passed"`, discovered scenario/task-set
counts, `step_observation: "command_result"`, `trace_steps: 1`, and
`registry_validation: "passed"`.

Run the CLI demo, which prints reset observation, step result, hidden grade, and
trace JSON:

```sh
node bin/wp-gym.mjs demo block-markup-no-fallback-pricing-section
```

Use the Node API directly from a lab runner:

```js
import { WPGym } from './src/index.js';

const scenarioId = 'block-markup-no-fallback-pricing-section';
const env = await WPGym.make(scenarioId);
const observation = await env.reset({ seed: 1234 });
const step = await env.step({
  type: 'wp_cli',
  command: "post create --post_type=page --post_title='Pricing' --post_content='<blocks>'",
});
const grade = await env.grade();
const trace = await env.trace();
await env.close();
```

See [`local-api.md`](local-api.md) and [`episode-contract.md`](episode-contract.md)
for the full local contract.

## Run Live Episodes

Use the dry-run workflow first. It resolves the same task/model matrix without
provider calls:

```sh
gh workflow run datamachine-live-run.yml \
  --repo Automattic/wp-gym \
  --ref main \
  -f task_set=benchmark-readiness-pilot \
  -f task_ids= \
  -f bundle_ref= \
  -f dry_run=true
```

After the dry run is green and provider secrets are configured, start the live
pilot:

```sh
gh workflow run datamachine-live-run.yml \
  --repo Automattic/wp-gym \
  --ref main \
  -f task_set=benchmark-readiness-pilot \
  -f task_ids= \
  -f bundle_ref= \
  -f dry_run=false
```

Inspect and download the artifacts:

```sh
gh run list --repo Automattic/wp-gym --workflow datamachine-live-run.yml --limit 5
gh run view <run-id> --repo Automattic/wp-gym --json url,conclusion,status,jobs
gh run download <run-id> --repo Automattic/wp-gym --dir artifacts/<run-id>
```

See [`benchmark-readiness.md`](benchmark-readiness.md) for the maintained live-run
matrix and expected artifact list.

## Inspect Replay Bundles

Live runs upload replay-critical evidence in workflow artifacts. The current
registry artifact is named `wp-gym-run-registry-<run-id>` and contains:

| Path | Purpose |
| --- | --- |
| `entries/` | Validated run registry entries. |
| `eval-artifacts/` | Canonical `wp-gym` eval artifact projections. |
| `report.json` | Machine-readable pilot summary. |
| `report.md` | Human-readable pilot summary. |
| `live-run-results/` | Downloaded Homeboy result artifacts used as input. |
| `live-replay-bundles/` | Replay bundles when emitted by the runner. |

Regrade a downloaded registry or replay artifact when validating a benchmark row:

```sh
wp-gym replay ~/Downloads/wp-gym-run-registry-<run-id>.zip --regrade
```

`--regrade` fails nonzero when local replay evidence is missing, hashes drift, the
trace is incompatible, the grader fails, or the sealed grade no longer matches.
Pilot rows may still expose compatibility gaps; benchmark rows must replay from
local hashable evidence.

See [`replay-regrade.md`](replay-regrade.md) for the replay status contract.

## Sealed Provenance Contract

External labs should treat benchmark-mode registry rows as sealed execution
receipts. A row is acceptable only when `npm run run-registry:validate --
--benchmark-mode` succeeds and the registry row exposes immutable provenance for:

- Workflow code: repository, workflow path, immutable `ref`, and commit `sha`.
- Runner code: runner/orchestrator name plus immutable source `ref` and `sha` when
  source-backed.
- Runtime: WordPress, PHP, Node.js, runtime/package versions, and
  `package_lock_sha256`.
- Provider: provider ID, model ID, and model snapshot/version when available.
- Tool policy: effective policy hash, enabled-tool-surface hash, and agent
  instruction hash.
- Inputs: scenario, prompt, grader, task-set, and bundle SHA-256 fingerprints.

Mutable refs such as `main`, `trunk`, `HEAD`, `refs/heads/*`, and `latest` are not
accepted for benchmark rows. Reports generated with `npm run run-registry:report --
--benchmark-mode` include the workflow SHA, tool-policy SHA, and bundle SHA per row
so a lab can compare runs before requesting private replay material.

## Inspect Registry Reports

Generate registry entries and reports from downloaded workflow artifacts:

```sh
npm run run-registry:emit -- \
  --input artifacts/<run-id> \
  --output artifacts/<run-id>/wp-gym-run-registry

npm run run-registry:report -- \
  --registry artifacts/<run-id>/wp-gym-run-registry/entries \
  --json artifacts/<run-id>/wp-gym-report.json \
  --markdown artifacts/<run-id>/wp-gym-report.md \
  --scope pilot
```

Read pilot reports as diagnostic evidence only. For each row, inspect:

- `task_set.benchmark_status` and `benchmark.eligible` before treating it as a benchmark row.
- `calibration.row_type` before mixing no-op, scripted, model, repeated-attempt, and human/reference evidence.
- `grade.success`, `grade.reward`, `grade.failure_class`, and failed `grade.checks` for task outcome.
- `artifact_index.replay`, `artifact_index.eval_artifact`, and hashes before replay or promotion review.
- `workflow_url`, provider, model, scenario hash, prompt hash, grader hash, and task-set hash for provenance.

See [`run-registry.md`](run-registry.md) for the registry schema and validation
rules.

## What Is Not Benchmark-Ready Yet

Do not use the current pilot for:

- Public benchmark leaderboards.
- Headline model comparisons.
- Claims that WordPress tasks are calibrated for difficulty or variance.
- Claims that public tasks are contamination-safe.
- Claims that one live pass proves benchmark replay compatibility.
- Claims that generated PRs alone are sufficient benchmark artifacts.

Current pilot evidence is useful for lab integration, API feedback, reward-shape
review, replay-shape review, and calibration planning. It is not benchmark data
until promotion reports pass with no blockers.

## Calibration Readiness Gates

Issue [#127](https://github.com/Automattic/wp-gym/issues/127) tracks promotion
from pilot/demo evidence to benchmark-ready calibration. The current child gates
are:

| Gate | Issue | Status | What it blocks |
| --- | --- | --- | --- |
| Cheap-model rows | [#213](https://github.com/Automattic/wp-gym/issues/213) | Open | Baseline pass-rate bands without only frontier rows. |
| Repeated attempts and variance | [#214](https://github.com/Automattic/wp-gym/issues/214) | Open | Confidence intervals and stability claims. |
| Human/reference reward audit | [#215](https://github.com/Automattic/wp-gym/issues/215) | Open | Reward soundness before benchmark promotion. |
| Benchmark-grade replay contracts | [#216](https://github.com/Automattic/wp-gym/issues/216) | Open | Promotion from diagnostic replay to benchmark replay. |
| Private held-out packs | [#212](https://github.com/Automattic/wp-gym/issues/212) | Open | Headline benchmark use and contamination-safe reporting. |
| Repeated-run reporting tools | [#203](https://github.com/Automattic/wp-gym/issues/203) | Closed | Report shape for repeated-run evidence. |
| Held-out policy docs | [#147](https://github.com/Automattic/wp-gym/issues/147), [#148](https://github.com/Automattic/wp-gym/issues/148) | Closed | Contamination-control policy foundation. |
| Registry and artifact index | [#136](https://github.com/Automattic/wp-gym/issues/136), [#145](https://github.com/Automattic/wp-gym/issues/145), [#163](https://github.com/Automattic/wp-gym/issues/163) | Closed | Durable run indexing and report generation. |
| Benchmark versioning and promotion policy | [#137](https://github.com/Automattic/wp-gym/issues/137), [#146](https://github.com/Automattic/wp-gym/issues/146) | Closed | Versioned promotion metadata and compatibility policy. |

Before a lab treats any row as benchmark-ready, run the promotion report and
verify it has no blockers:

```sh
npm run benchmark-promotion:report -- --task-set benchmark-readiness-pilot --check
```

The expected current result is failure with blockers. That failure is correct
until the open #127 child gates are resolved.

## Validation Checklist

Use these checks before sharing a refreshed readiness package:

```sh
npm run validate
npm run run-registry:validate
npm run replay-regrade:test
npm run benchmark-promotion:test
```

Use the full repo check before promoting implementation changes:

```sh
npm run verify
```
