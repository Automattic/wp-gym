# Episode Contract

Issue #80 defines the canonical versioned contract for wp-gym episode actions,
observations, step results, and replay traces.

Schemas live in `schemas/`:

- `action.v1.schema.json`: requested actions.
- `observation.v1.schema.json`: replay evidence observed after actions.
- `step-result.v1.schema.json`: one step result with explicit reward/success.
- `trace.v1.schema.json`: complete episode replay trace.

Run `npm run episode-schemas:validate` to compile the schemas and validate the
representative examples used by the test suite.

## Action

An action is the request sent to the runner. Version 1 supports four action
families: `wp_cli`, `filesystem`, `rest`, and `browser`.

`wp_cli` is the first-class starting action because WordPress Playground and the
local runner stack can inspect and mutate many tasks through WP-CLI-style
commands:

```json
{
  "schema_version": 1,
  "type": "wp_cli",
  "command": "post list --post_type=page --format=json",
  "timeout_ms": 30000
}
```

The action records the intended command and timeout. Command status, stdout,
stderr, timeout outcome, and error details are observation evidence, not action
inputs.

## Observation

An observation is the replay evidence produced by the runtime. Version 1 supports
`command_result`, `logs`, `wp_state`, `files`, `html`, and `screenshot`.

The `command_result` observation maps directly to `wp_cli` actions:

```json
{
  "schema_version": 1,
  "type": "command_result",
  "action_type": "wp_cli",
  "command": "post list --post_type=page --format=json",
  "status": 0,
  "stdout": "[]",
  "stderr": "",
  "timeout_ms": 30000,
  "timed_out": false,
  "duration_ms": 84,
  "error": null
}
```

## Step Result

`StepResult` keeps grading outputs separate from behavioral diagnostics:

```json
{
  "schema_version": 1,
  "observation": { "type": "command_result" },
  "reward": {
    "value": 0,
    "success": false,
    "failure_reasons": ["page_missing"]
  },
  "done": false,
  "telemetry": {
    "duration_ms": 84
  }
}
```

`reward.value`, `reward.success`, `reward.failure_reasons`, and optional
`reward.checks` are the only scoring surface. `telemetry` is for diagnostics such
as timing, token use, tool counts, fingerprints, and runner metadata. The schema
rejects `reward`, `success`, and `score` keys inside telemetry metadata so run
shape cannot accidentally become a reward signal.

## Trace

A trace is the replayable episode envelope:

```json
{
  "schema_version": 1,
  "episode_id": "episode-001",
  "scenario_id": "smoke-homepage",
  "metadata": {
    "max_steps": 12,
    "allowed_action_types": ["wp_cli"],
    "setup": ["wordpress-playground-clean-site"],
    "success_checks": ["page_created", "expected_block_content"]
  },
  "steps": [
    {
      "step_index": 0,
      "timestamp": "2026-05-20T00:00:00Z",
      "action": {
        "schema_version": 1,
        "type": "wp_cli",
        "command": "post list --post_type=page --format=json"
      },
      "result": {
        "schema_version": 1,
        "observation": {
          "schema_version": 1,
          "type": "command_result",
          "action_type": "wp_cli",
          "command": "post list --post_type=page --format=json",
          "status": 0,
          "stdout": "[]",
          "stderr": "",
          "timed_out": false,
          "error": null
        },
        "reward": {
          "value": 0,
          "success": false,
          "failure_reasons": ["page_missing"]
        },
        "done": false,
        "telemetry": {
          "duration_ms": 84
        }
      }
    }
  ]
}
```

Scenario manifests can also declare matching episode metadata under optional
`episode_contract` with `allowed_action_types`, `max_steps`, `setup`, and
`success_checks`. Existing runner artifacts can be mapped by translating tool
calls into actions, runtime outputs into observations, hidden grader output into
`reward`, and runner diagnostics into `telemetry`. Any artifact that lacks action
inputs or observation evidence should be treated as a compatibility gap rather
than a complete trace.
