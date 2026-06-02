# WP Codebox Adapter Contract

This document defines the `wp-gym` adapter boundary for
[issue #86](https://github.com/Automattic/wp-gym/issues/86) and
[issue #87](https://github.com/Automattic/wp-gym/issues/87).

WP Codebox is the complete generic runtime substrate for isolated WordPress
workspaces. It owns runtime creation, input mounts, controlled execution, state
observation, snapshots, artifact collection, and runtime cleanup. It should not
learn `wp-gym`, model-eval, benchmark, reward, grader, scenario, or task-set
concepts.

`wp-gym` owns the evaluation layer. It translates scenario manifests, prompts,
actions, observations, traces, graders, rewards, and reports onto WP Codebox
primitives and then projects the generic runtime outputs back into `wp-gym` eval
artifacts.

## Layer Boundary

WP Codebox provides generic primitives:

- Create and destroy an isolated WordPress runtime.
- Mount files, plugins, themes, blueprints, and workspace inputs.
- Execute controlled actions inside the sandbox.
- Observe runtime state through generic channels.
- Snapshot runtime state when callers ask for it.
- Collect files, logs, screenshots, command output, and other artifacts.

`wp-gym` provides eval semantics:

- Scenario ids, task families, prompt files, and task-set selection.
- Actor or runner selection for a task attempt.
- Hidden graders and reward policy.
- Success, done state, failure reason taxonomy, and report fields.
- Eval trace projection and validation.
- Eval artifact shape used by downstream analysis.

The adapter is therefore one-way in dependency terms: `wp-gym` consumes WP
Codebox. WP Codebox remains generic and does not validate or emit
`wp-gym`-specific eval fields.

When `wp-gym` passes caller metadata to WP Codebox, that metadata is opaque
runtime correlation only. It must not include eval identifiers such as scenario
ids, task-set ids, grader identity, reward state, or failure-class taxonomy;
those fields belong in `wp-gym` eval artifacts.

## Scenario To Runtime Input

The adapter maps a `wp-gym` scenario manifest into WP Codebox setup input:

| `wp-gym` concept | WP Codebox primitive | Notes |
| --- | --- | --- |
| Starting WordPress state | Runtime create input and optional blueprint | The adapter chooses the runtime image, WordPress version, and setup blueprint from scenario metadata. |
| Starter workspace files | Runtime mounts | Files are mounted as ordinary sandbox inputs; runtime does not know why they matter. |
| Required plugins/themes | Runtime mounts or setup commands | Scenario requirements become generic install/activate/setup steps. |
| Prompt or task text | Actor/runner invocation payload | The runtime only executes the selected actor; it does not interpret the prompt as an eval. |
| Expected artifacts | Artifact collection options | Runtime collects the requested generic artifacts; `wp-gym` decides how to grade them. |
| Time/tool policy | Runtime execution policy | Generic limits and allowed execution channels stay runtime-shaped, while task policy labels stay in `wp-gym`. |

CI orchestration can remain an external caller, but the runtime contract for
`wp-gym` is the generic WP Codebox recipe and command shape.

## Actions

`wp-gym` Action is an eval-layer command record. The adapter converts it into a
generic WP Codebox execution request, then records the action in the eval
trace.

| `wp-gym` action type | WP Codebox execution | Runtime output consumed by `wp-gym` |
| --- | --- | --- |
| `wp_cli` | Execute a `wp` command in the sandbox | Exit code, stdout, stderr, duration, and emitted artifacts. |
| `filesystem` | Read, write, patch, or list mounted files through runtime file primitives | File result, file metadata, and changed artifact paths. |
| `rest` | Execute an HTTP request against the sandbox WordPress site | Status, headers, body, timing, and server logs. |
| `browser` | Run a browser interaction or capture against the sandbox site when available | DOM/html, screenshot, console logs, network metadata, and timing. |
| `editor` | Run a generic block-editor interaction when the runtime exposes one | Editor store snapshot, post/block identity, DOM evidence, screenshots, and timing. |

The runtime execution request should use runtime names such as command, request,
file operation, browser action, timeout, cwd, environment, and artifact capture
options. `wp-gym` names such as reward, success, failure reason, scenario id, or
task id stay outside the runtime request.

## Observations

`wp-gym` Observation is the eval-layer view of sandbox state after setup, after an
action, or at final grading time. The adapter builds it from WP Codebox
observation results and selected artifacts.

| `wp-gym` observation source | WP Codebox source | Notes |
| --- | --- | --- |
| `logs` | Runtime log artifact or log stream snapshot | Includes PHP, WordPress, server, browser, and command logs when enabled. |
| `wp_state` | Generic WordPress observation command or exported state artifact | The adapter chooses the WordPress-specific query and shapes it for graders. |
| `files` | Runtime file listing/read artifacts | Used for workspace diffs, generated files, and grader inputs. |
| `html` | HTTP/browser capture artifact | Runtime captures the page; `wp-gym` decides whether the content satisfies the task. |
| `screenshot` | Browser screenshot artifact | Runtime stores the image; `wp-gym` references it from reports or graders. |
| `command_result` | Execution result from a prior runtime command | Exit code and output become observation evidence, not reward state. |

WP Codebox may expose additional generic observations later. `wp-gym` can
consume them without requiring the runtime to adopt eval-specific schema names.

## StepResult

`wp-gym` StepResult is an eval-layer envelope composed after a runtime action and
observation cycle. It should contain:

- The accepted `wp-gym` Action record.
- The WP Codebox execution result projected into `wp-gym` evidence fields.
- The `wp-gym` Observation assembled from runtime observations and artifacts.
- Eval-only fields such as `reward`, `done`, `success`, `failure_reasons`, and
  grader diagnostics when that step performs grading.

WP Codebox should only return generic execution and observation data. The
adapter attaches reward and completion semantics after the generic runtime work is
finished.

## Trace

`wp-gym` Trace is the eval-layer replay record. The adapter constructs it from:

- WP Codebox lifecycle events: create, mount, execute, observe, snapshot,
  collect artifacts, and destroy.
- `wp-gym` action and observation projections.
- Eval-only grader results, reward state, completion state, fingerprints, and
  report metadata.

Trace validation belongs in `wp-gym`. It can reject malformed action,
observation, StepResult, or eval artifact records without requiring WP Codebox to
validate eval semantics.
Artifact redaction and sharing policy also belongs in `wp-gym`; runtime adapters
should preserve enough provenance for `wp-gym` to classify references as
`public_report`, `private_lab`, `local_only`, or `sealed_hash_only`.

## Compatibility Gaps

The adapter should record a compatibility gap when a scenario needs a runtime
primitive that WP Codebox does not yet expose generically. The gap should be
described in runtime terms, for example:

- A missing execution channel, such as browser interaction.
- A missing observation channel, such as exported WordPress state.
- A missing artifact type, such as screenshot capture or normalized log bundles.
- A missing lifecycle hook, such as snapshot before cleanup.
- A missing generic editor primitive, such as opening a post, inserting a block,
  saving, or exporting editor store state.

The requested runtime change should stay generic. For example, ask WP Codebox for
a screenshot artifact, not a visual-grading artifact; ask for a WordPress state
export, not a `wp-gym` grader input.
