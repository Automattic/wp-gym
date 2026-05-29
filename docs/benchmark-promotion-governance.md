# Benchmark Promotion Governance

Issue: [#202](https://github.com/Automattic/wp-gym/issues/202)

`wp-gym` promotes pilot or calibration evidence to headline benchmark scores only
through an explicit promotion report. The report is a maintainer review artifact:
it lists every gate, links the evidence currently present in the repo, and emits
stable blocker codes for anything still missing.

## Command

Evaluate a scenario:

```sh
npm run benchmark-promotion:report -- --scenario block-markup-no-fallback-pricing-section
```

Evaluate a task set:

```sh
npm run benchmark-promotion:report -- --task-set benchmark-readiness-pilot
```

Emit Markdown for a PR or issue comment:

```sh
npm run benchmark-promotion:report -- \
  --task-set benchmark-readiness-pilot \
  --format markdown \
  --output artifacts/benchmark-promotion.md
```

Use `--check` when CI should fail on blockers:

```sh
npm run benchmark-promotion:report -- --task-set <task-set-id> --check
```

The CLI alias is:

```sh
bin/wp-gym.mjs benchmark-promotion report --task-set <task-set-id>
```

## Gates

Scenario promotion requires:

- Baseline result sets and calibration result sets are present.
- Difficulty band and pass-rate band are calibrated, not `uncalibrated`.
- A 95% confidence interval is present.
- Known shortcuts have executable reward fixture coverage and no unresolved known
  shortcuts remain for the headline version.
- Held-out private variants are ready, and the scenario uses the
  `held_out_private` split.
- Replay contract is `benchmark_replay`.
- Benchmark metadata includes full version identity hashes.
- `calibration.benchmark_blockers` is empty.

## Benchmark Replay Contract

`task_contract_level=benchmark_replay` means the row is no longer a diagnostic
contract. The scenario must be locally replayable and regradable from retained or
downloaded artifacts without hidden runner state.

Scenario metadata enforces this contract with:

- `expected_artifacts` includes `grader_result`, `replay_trace`, and
  `replay_bundle`.
- `expected_artifacts` includes at least one replayable state artifact:
  `wordpress_state`, `workspace_diff`, `plugin_files`, or `media_library`.
- `episode_contract.allowed_action_types` contains only action types the local
  replay harness can replay today: `wp_cli` and `filesystem`.
- `benchmark_blockers` no longer contains diagnostic-only blockers such as
  `diagnostic_contract_only`, `workspace_diff_diagnostic_only`, or
  `task_contract_workspace_diff_diagnostic`.

Benchmark-mode artifact validation also treats `replay_trace` and
`replay_bundle` as first-class expected artifacts. `wp-gym replay --regrade`
must be able to verify hashes, replay the canonical trace, rerun the terminal
grader, and compare the sealed grade result.

Task-set promotion requires:

- `benchmark_status=benchmark_ready`, `benchmark=true`,
  `headline_score_eligible=true`, `aggregate_score=true`, and
  `score_scope=benchmark`.
- Task-set contract level is `benchmark_replay`.
- Split policy requires and allows `held_out_private`.
- Benchmark metadata includes full version identity hashes.
- `benchmark_blockers` is empty.
- Every included scenario passes the scenario promotion gates.

## Embedded Promotion Report

When a scenario or task set is promoted, paste the generated manifest fragment
from the report into the promoted manifest as `promotion_report`.

```json
{
  "promotion_report": {
    "generated_by": "wp-gym benchmark-promotion report",
    "generated_at": "2026-05-29T00:00:00.000Z",
    "target_type": "task_set",
    "target_id": "example-benchmark-v1",
    "status": "pass",
    "source_sha256": "<report source hash>"
  }
}
```

`npm run validate` refuses benchmark-ready scenarios and benchmark task sets when
the fragment is absent, not passing, points at the wrong target, or is stale for
the current manifest inputs. Task-set freshness includes the task-set manifest and
the current included scenario manifests, so changing a task contract requires a
new promotion report.

## Review Ownership

A maintainer reviews promotion reports before merging benchmark-ready metadata.
Reviewers should confirm the report was generated from the branch being promoted,
the blocker list is empty, and the evidence links resolve to retained artifacts or
private held-out pack references allowed by the artifact sharing policy.

## Demotion And Deprecation

If a task is flawed after promotion, prefer demotion over papering over the score:

- Set the scenario or task set status to `deprecated` when old scores remain
  useful for historical comparison but should not receive new headline runs.
- Set the status to `retired` when it is retained only for archive/replay.
- Add a blocker code such as `grader_bug`, `task_ambiguous`,
  `shortcut_not_covered`, or `held_out_contamination_risk` before returning it to
  pilot or calibration.
- Open or update the tracking issue with the flawed evidence, affected benchmark
  version, demotion reason, and the expected path back to promotion.

Promotion back to `benchmark_ready` requires a fresh passing promotion report.
