# Eval Artifact Projection

Issue: [#117](https://github.com/Automattic/wp-gym/issues/117)

`wp-gym` owns the canonical eval artifact / episode result row. Direct wp-gym
runners emit this row as `metadata.eval_artifact` or as the top-level JSON value.
Other orchestrators may wrap their own sealed artifacts, but benchmark evidence
is trusted only after those artifacts project into this canonical row.

The current cross-runner boundary is Homeboy's `homeboy.sealed_eval_artifact`.
Homeboy owns the sealed evidence envelope; `wp-gym` owns the benchmark semantics.
The validator accepts Homeboy-wrapped rows when every required wp-gym semantic
field can be recovered from the wrapper without losing evidence.

The versioned JSON schema lives at `schemas/eval-artifact.schema.json`.
Artifact sensitivity, redaction, and sharing rules are defined in
[`docs/artifact-redaction-sharing-policy.md`](artifact-redaction-sharing-policy.md).

## Projection Boundary

Sandbox Runtime / WP Codebox owns generic runtime facts:

- Artifact bundle ID, schema version, creation time, runtime ID, and environment ID.
- Event, command, observation, mount, patch, package, screenshot, transcript, and
  replay artifact references.
- Runtime-level failures such as environment setup, command execution, timeout, or
  artifact export errors.

The runner owns execution facts:

- Provider, model, agent slug, workflow run ID or URL, and job ID.
- Prompt, bundle, and tool-policy fingerprints.
- Generated PR URL, result JSON reference, and replay/report links.

`wp-gym` owns eval facts:

- Scenario ID, label, task family, prompt fingerprint, and rule policy.
- Task-set ID, label, and source manifest path.
- Grader success, reward, score, checks, failure reasons, and general rule results.

Sandbox Runtime / WP Codebox must not emit `metadata.eval_artifact`, scenario
IDs, task-set IDs, reward fields, grader checks, or `wp-gym` failure
classifications. The projection may reference runtime artifact paths or hashes,
but eval semantics are added by `wp-gym` or its runner integration.

## Homeboy Sealed Artifact Projection

Homeboy emits `homeboy.sealed_eval_artifact` as a sealed runner artifact. That
artifact remains Homeboy-owned. `wp-gym` projects it into the canonical row using
generic fields only:

| Canonical field | Homeboy source |
| --- | --- |
| `projection.source_schema_name` | Constant `homeboy.sealed_eval_artifact` |
| `projection.created_at` | `sealed_eval_artifact.generated_at` |
| `runtime.artifact_bundle.id` | `sealed_eval_artifact.hashes.envelope` when available |
| `runtime.references.*` | `sealed_eval_artifact.artifacts.references` plus matching hashes |
| `runner.provider` | `sealed_eval_artifact.model.provider` |
| `runner.model` | `sealed_eval_artifact.model.model` |
| `runner.bundle_sha256` | `sealed_eval_artifact.hashes.bundle.sha256` |
| `runner.tool_policy_sha256` | `sealed_eval_artifact.hashes.tool_policy.sha256` |
| `runner.workflow.*` | `sealed_eval_artifact.runner` and `sealed_eval_artifact.run` |
| `scenario.*` | `sealed_eval_artifact.wp_gym.scenario` plus prompt hash fallback |
| `task_set.*` | `sealed_eval_artifact.wp_gym.task_set` |
| `grader.*` | `sealed_eval_artifact.wp_gym.grader` with grade fallback |
| `reports.*` | Homeboy result/replay references and workflow URL |

The Homeboy wrapper may contain Homeboy-specific fields such as `integration_seams`,
`termination`, or replay tool-audit metadata. Those fields are not required by the
wp-gym canonical schema unless they project to generic row fields above. If they
must be preserved for Homeboy replay, they remain in the sealed artifact envelope.
Sensitive raw fields that are needed only for private debugging should project as
`sealed_hash_only` references with hashes, not as public artifact links.

Benchmark mode treats missing required projection fields as errors. This prevents
a Homeboy wrapper from being accepted as benchmark evidence when scenario, task
set, prompt, grader, runner, or replay-critical references are absent.

## Failure Classes

The projection keeps infrastructure and task quality failures distinct:

- `runtime_failure`: WP Codebox could not prepare, run, observe, or export the
  generic artifact bundle.
- `agent_failure`: The agent loop failed before a complete task attempt could be
  graded, for example provider errors, missing final response, or exhausted runner
  policy before producing an attempt.
- `grader_failure`: The hidden grader or projection failed to execute or return a
  valid result, so task quality is unknown.
- `task_failure`: Runtime, agent, and grader completed, but `wp-gym` checks failed.
- `none`: The task passed.

`status.outcome` is intentionally coarse: `passed`, `failed`, or `errored`.
`status.failure_class` carries the actionable distinction.

## Source Field Map

Each top-level section can include `source_fields` entries with this shape:

```json
{
  "target": "metadata.eval_artifact.scenario.id",
  "source": "scenarios/site-building/community-garden.json:id",
  "owner": "wp-gym"
}
```

Use these owners:

- `sandbox-runtime` for fields copied from generic runtime artifacts.
- `runner` for Homeboy/runner workflow, model, and fingerprint metadata.
- `wp-gym` for scenario manifests, task-set manifests, and grader output.

Expected source examples:

- `runtime.artifact_bundle.id` from WP Codebox bundle metadata.
- `runtime.references.events[]` from WP Codebox event artifacts.
- `runner.provider` and `runner.model` from runner matrix metadata.
- `runner.bundle_sha256` and `runner.tool_policy_sha256` from runner fingerprints.
- `scenario.id`, `scenario.rules`, and `scenario.prompt_sha256` from `wp-gym`
  scenario and prompt files.
- `task_set.id` from the selected manifest in `task-sets/`.
- `grader.checks[]`, `grader.reward`, and `grader.failure_reasons` from hidden
  `wp-gym` graders.

## Minimal Shape

```json
{
  "schema_version": 1,
  "projection": {
    "name": "wp-gym-eval-artifact",
    "issue": "https://github.com/Automattic/wp-gym/issues/117",
    "created_at": "2026-05-20T00:00:00Z"
  },
  "status": {
    "outcome": "failed",
    "failure_class": "task_failure",
    "failure_reason": "required_semantic_blocks_missing",
    "message": "The runtime and grader completed, but hidden task checks failed."
  },
  "runtime": {
    "artifact_bundle": {
      "id": "wp-codebox-run-123",
      "schema_version": "1",
      "created_at": "2026-05-20T00:00:00Z",
      "runtime_id": "playground",
      "environment_id": "wp-gym-smoke"
    },
    "references": {
      "events": [{ "kind": "jsonl", "path_or_url": "artifacts/events.jsonl" }],
      "replay_bundle": [{ "kind": "zip", "path_or_url": "artifacts/replay.zip" }]
    }
  },
  "runner": {
    "provider": "openai",
    "model": "gpt-5.5",
    "agent_slug": "wordpress-task-runner",
    "bundle_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
    "tool_policy_sha256": "1111111111111111111111111111111111111111111111111111111111111111",
    "workflow": {
      "run_id": "123456789",
      "run_url": "https://github.com/Automattic/wp-gym/actions/runs/123456789"
    }
  },
  "scenario": {
    "id": "block-markup-no-fallback-pricing-section",
    "label": "No fallback pricing section",
    "task_family": "block-markup",
    "prompt_sha256": "2222222222222222222222222222222222222222222222222222222222222222",
    "rules": {
      "general": ["wordpress_editable_blocks"],
      "task_specific": ["required_semantic_blocks"]
    }
  },
  "task_set": {
    "id": "first-live-run",
    "label": "First live run",
    "source_path": "task-sets/first-live-run.json"
  },
  "grader": {
    "success": false,
    "reward": 0.25,
    "grade": { "score": 1, "max_score": 4 },
    "checks": [
      {
        "id": "semantic_blocks",
        "passed": false,
        "score": 0,
        "max_score": 1,
        "failure_reason": "required_semantic_blocks_missing",
        "message": "Expected editable pricing blocks were not found."
      }
    ],
    "failure_reasons": ["required_semantic_blocks_missing"]
  },
  "reports": {
    "pull_request_url": "https://github.com/Automattic/wp-gym/pull/123",
    "workflow_run_url": "https://github.com/Automattic/wp-gym/actions/runs/123456789"
  }
}
```
