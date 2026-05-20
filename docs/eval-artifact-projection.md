# Eval Artifact Projection

Issue: [#88](https://github.com/Automattic/wp-gym/issues/88)

`wp-gym` projects generic Sandbox Runtime artifacts into benchmark-specific eval
results. Sandbox Runtime, published as `wp-codebox`, stays generic: it emits
runtime metadata, events, command logs, observations, mounts, patches, packages,
screenshots, transcripts, and replay bundles where available. `wp-gym` adds the
scenario, task-set, model, runner, prompt, rule, reward, check, and report context.

The versioned JSON schema lives at `schemas/eval-artifact.schema.json` and is
stored under `metadata.eval_artifact` in runner outputs.

## Projection Boundary

Sandbox Runtime owns generic runtime facts:

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

`wp-codebox` must not emit `metadata.eval_artifact`, scenario IDs, task-set IDs,
reward fields, grader checks, or `wp-gym` failure classifications. The projection
may reference Sandbox Runtime artifact paths or hashes, but eval semantics are
added by `wp-gym` or its runner integration.

## Failure Classes

The projection keeps infrastructure and task quality failures distinct:

- `runtime_failure`: Sandbox Runtime could not prepare, run, observe, or export the
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

- `sandbox-runtime` for fields copied from generic Sandbox Runtime artifacts.
- `runner` for Homeboy/runner workflow, model, and fingerprint metadata.
- `wp-gym` for scenario manifests, task-set manifests, and grader output.

Expected source examples:

- `runtime.artifact_bundle.id` from Sandbox Runtime bundle metadata.
- `runtime.references.events[]` from Sandbox Runtime event artifacts.
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
    "issue": "https://github.com/Automattic/wp-gym/issues/88",
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
      "id": "sandbox-runtime-run-123",
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
