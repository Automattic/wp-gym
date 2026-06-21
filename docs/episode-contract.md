# Episode Contract

Issue #80 defines the canonical versioned contract for wp-gym episode actions,
observations, step results, and replay traces. Issue
[#134](https://github.com/Automattic/wp-gym/issues/134) tightens those contracts
so malformed or unknown action and observation fields fail validation instead of
quietly entering traces.
Issue [#255](https://github.com/Automattic/wp-gym/issues/255) defines the
browser/editor replay envelope and the boundary between deterministic replay and
audit-only evidence.

Schemas live in `schemas/`:

- `action.v1.schema.json`: requested actions.
- `observation.v1.schema.json`: replay evidence observed after actions.
- `step-result.v1.schema.json`: one step result with explicit reward/success.
- `trace.v1.schema.json`: complete episode replay trace.

Run `npm run episode-schemas:validate` to compile the schemas and validate the
representative examples used by the test suite.

## Action

An action is the request sent to the runner. Version 1 supports five action
families: `wp_cli`, `filesystem`, `rest`, `browser`, and `editor`.

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

`browser` actions declare replayability explicitly. `navigate`, `click`, `fill`,
`press`, and `capture` map to the runtime browser-action adapter so local
episodes and replay/regrade can drive the same generic browser interaction
contract. Use `evidence_only` when the runner captures browser evidence that is
useful for audit but should not be treated as deterministic replay input:

```json
{
  "schema_version": 1,
  "type": "browser",
  "operation": "capture",
  "replayability": "evidence_only",
  "url": "/",
  "viewport": { "width": 1280, "height": 720 },
  "timing": { "wait_until": "load", "settle_ms": 250, "timeout_ms": 30000 },
  "state": { "selector": "main", "text_contains": "Hello" },
  "capture": ["html", "screenshot"]
}
```

`editor` actions preserve block-editor intent and state without inventing a
wp-gym-specific runtime primitive. `open_post` and `inspect_state` can map to the
runtime editor-state adapter for generic target opening and editor-state capture.
Mutation operations remain evidence-only until generic editor mutation primitives
are available:

```json
{
  "schema_version": 1,
  "type": "editor",
  "operation": "insert_block",
  "replayability": "evidence_only",
  "post_id": 4,
  "block_name": "core/paragraph",
  "attributes": { "content": "Editor-authored paragraph." },
  "state": { "editor_store": "core/block-editor", "editor_selector": "selectedBlock" },
  "timeout_ms": 30000
}
```

## Observation

An observation is the replay evidence produced by the runtime. Version 1 supports
`command_result`, `logs`, `wp_state`, `files`, `rest_response`, `html`,
`screenshot`, `browser_result`, and `editor_result`.
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
  "viewport": { "width": 1280, "height": 720 },
  "state": { "url": "/", "title": "Home", "selector_text": "Hello" },
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

Editor result observations preserve the editor state that made an action
auditable: post identity, selected block identity, dirty/published state, editor
mode, and references to richer state artifacts when available.

```json
{
  "schema_version": 1,
  "type": "editor_result",
  "action_type": "editor",
  "operation": "insert_block",
  "replayability": "evidence_only",
  "state": {
    "post_id": 4,
    "post_type": "page",
    "post_status": "draft",
    "selected_block_client_id": "block-1",
    "block_count": 1,
    "dirty": true,
    "mode": "visual"
  },
  "artifacts": [
    {
      "path": "files/editor/state.json",
      "sha256": "2222222222222222222222222222222222222222222222222222222222222222",
      "mime_type": "application/json"
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
      "reset_seed": "1234",
      "allowed_action_types": ["wp_cli"],
      "setup": ["wordpress-playground-clean-site"],
      "success_checks": ["page_created", "expected_block_content"],
      "replay": {
        "mode": "deterministic",
        "reset": { "strategy": "wordpress_state", "seed": "1234", "state_ref": "wordpress-state.json" },
        "viewport": { "width": 1280, "height": 720 },
        "timing": { "default_timeout_ms": 30000, "settle_ms": 250, "wait_until": "load" },
        "screenshots": { "required": false, "format": "png", "full_page": true },
        "state": { "dom_required": false, "editor_store_required": false }
      }
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

Scenario manifests declare matching episode metadata under `episode_contract`
with `allowed_action_types`, `max_steps`, `setup`, and `success_checks`.
Existing runner artifacts can be mapped by translating tool
calls into actions, runtime outputs into observations, hidden grader output into
`reward`, and runner diagnostics into `telemetry`. Any artifact that lacks action
inputs or observation evidence should be treated as a compatibility gap rather
than a complete trace.

## Browser And Editor Replay Semantics

Replay metadata defines the episode conditions that must be restored before the
trace is meaningful:

- `reset.strategy` identifies whether replay starts from a clean site, retained
  WordPress state artifact, or workspace snapshot.
- `reset.seed` records deterministic seeding when the runner provides one.
- `viewport` fixes browser dimensions, scale factor, and mobile mode.
- `timing` records timeout, readiness, and post-action settling rules.
- `screenshots` declares whether screenshots are required evidence and how they
  were captured.
- `state` declares which DOM, editor-store, network, and console evidence is
  required for audit.

Deterministic replay is allowed only when the local replay harness has a generic
runtime primitive for the action and all required reset/state evidence is local
and hash-verified. Current benchmark replay supports deterministic `wp_cli`,
`filesystem`, and replayable browser `navigate`/`click`/`fill`/`press`/`capture`
traces through runtime browser actions. Editor open/state capture uses the
runtime editor-state adapter; editor mutation actions remain audit-only until
generic mutation primitives are available.

Audit-only browser/editor traces remain useful: `wp-gym replay --regrade`
validates the action and observation envelopes, reports audit-only warnings for
evidence-only browser steps and editor mutation steps, verifies retained
WordPress state, reruns the terminal grader, and compares the sealed grade. A
mismatch between a browser/editor action and its paired observation is an error
because the evidence can no longer be trusted.
