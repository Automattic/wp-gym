# Episode Contract

Issue #80 defines the canonical versioned contract for wp-gym episode actions,
observations, step results, and replay traces. Issue
[#134](https://github.com/Automattic/wp-gym/issues/134) tightens those contracts
so malformed or unknown action and observation fields fail validation instead of
quietly entering traces.

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

Action records are strict: unknown top-level fields are rejected. Use
`metadata` for runner-specific debug data. `metadata` must not contain `reward`,
`success`, or `score`.

`filesystem` actions are relative to the scenario workspace and cannot use
absolute paths or `..` segments:

```json
{
  "schema_version": 1,
  "type": "filesystem",
  "operation": "write",
  "path": "plugins/example/example.php",
  "content": "<?php\n"
}
```

`rest` actions preserve sandbox-relative HTTP intent for runners that can issue
requests against the WordPress runtime:

```json
{
  "schema_version": 1,
  "type": "rest",
  "method": "GET",
  "path": "/wp-json/wp/v2/posts",
  "timeout_ms": 30000
}
```

`browser` actions declare replayability explicitly. Use `evidence_only` when the
runner can capture browser/editor evidence but the local replay harness cannot
yet deterministically replay the interaction:

```json
{
  "schema_version": 1,
  "type": "browser",
  "operation": "capture",
  "replayability": "evidence_only",
  "url": "/",
  "capture": ["html", "screenshot"]
}
```

## Observation

An observation is the replay evidence produced by the runtime. Version 1 supports
`command_result`, `logs`, `wp_state`, `files`, `rest_response`, `html`,
`screenshot`, and `browser_result`.
Observations can include sensitive runtime output, so traces and exported
artifacts must follow the
[`artifact redaction and sharing policy`](artifact-redaction-sharing-policy.md)
before they are linked from public reports.

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

Filesystem observations include the action type and operation so trace readers do
not need to infer intent from file payloads:

```json
{
  "schema_version": 1,
  "type": "files",
  "action_type": "filesystem",
  "operation": "write",
  "files": [
    {
      "path": "plugins/example/example.php",
      "kind": "file",
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
    }
  ]
}
```

REST response observations preserve response evidence without turning it into a
reward signal:

```json
{
  "schema_version": 1,
  "type": "rest_response",
  "action_type": "rest",
  "method": "GET",
  "path": "/wp-json/wp/v2/posts",
  "status": 200,
  "headers": { "content-type": "application/json" },
  "body": [],
  "timed_out": false,
  "error": null
}
```

Browser result observations preserve interaction/capture evidence and artifact
references. They also repeat replayability so downstream replay tools can fail
or warn clearly:

```json
{
  "schema_version": 1,
  "type": "browser_result",
  "action_type": "browser",
  "operation": "capture",
  "replayability": "evidence_only",
  "url": "/",
  "artifacts": [
    {
      "path": "files/browser/screenshot.png",
      "sha256": "1111111111111111111111111111111111111111111111111111111111111111",
      "mime_type": "image/png"
    }
  ],
  "error": null
}
```

Observation records are also strict: unknown top-level fields are rejected. Use
`metadata` for runner-specific diagnostics, not scoring data.

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
