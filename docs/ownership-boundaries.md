# Ownership Boundaries

Issue: [#69](https://github.com/Automattic/wp-gym/issues/69)

`wp-gym` is the eval framework. It owns scenario meaning, task prompts, action and
observation schemas, hidden graders, reward policy, failure reasons, traces, and
eval artifacts.

WP Codebox is the runtime substrate. It owns disposable WordPress runtime
episodes, mounts, controlled command execution, observations, snapshots,
artifact collection, previews, and cleanup. WP Codebox stays generic: it should
not learn `wp-gym`, scenario IDs, task sets, hidden graders, rewards, benchmark
leaderboards, or model-scoring semantics.

Homeboy is CI orchestration. It checks out repositories, installs dependencies,
wires GitHub Actions secrets and matrix inputs, invokes `wp-gym`, uploads
artifacts, and reports status or PR summaries. Homeboy does not own the local
`wp-gym` runtime contract.

Data Machine is an optional actor. It can be the agent loop that attempts a task,
but it does not define scenario semantics or own runtime execution. Other actors
can use the same `wp-gym` tasks.

Data Machine Code is repository and GitHub workflow glue. It manages worktrees,
branches, commits, pushes, and PRs around runs. It does not own eval semantics or
runtime execution.

## Runtime Stack

```text
Local / portable:
wp-gym -> WP Codebox runtime episode -> wp-gym grader/trace/report

GitHub Actions / fleet:
Homeboy -> wp-gym -> WP Codebox runtime episode -> Homeboy artifacts/status
```

## Dependency Direction

```text
wp-gym consumes WP Codebox.
Homeboy invokes wp-gym.
Data Machine may act inside a wp-gym task.
DMC manages the repo state around a run.
```

This direction prevents runtime workarounds from leaking into the eval layer and
prevents eval concepts from coupling the generic WordPress runtime to `wp-gym`.

## Ownership Table

| Concern | Owner | Notes |
| --- | --- | --- |
| Scenario manifests, prompts, task sets | `wp-gym` | Model-facing task and private eval metadata. |
| Action, observation, step, trace schemas | `wp-gym` | Eval-layer records built from runtime output. |
| Hidden PHP graders, reward, failure reasons | `wp-gym` | Runtime failures remain distinct from task failures. |
| Runtime episodes, mounts, commands, snapshots | WP Codebox | Generic WordPress runtime operations only. |
| Runtime artifacts, logs, previews | WP Codebox | Generic artifact bundles; `wp-gym` projects eval meaning. |
| GitHub Actions matrix, secrets, uploads | Homeboy | Invokes `wp-gym`; does not compile `wp-gym` concepts into runtime contracts. |
| Agent task attempt | Data Machine or another actor | Actor receives the model-facing prompt and enabled tools. |
| Worktrees, commits, PRs | Data Machine Code | Repository lifecycle around generated outputs. |

## Rule Of Thumb

If a concept names success, reward, grading, scenario identity, or model quality,
it belongs in `wp-gym`.

If a concept names WordPress runtime creation, command execution, mounts,
snapshots, previews, or generic artifacts, it belongs in WP Codebox.

If a concept names CI jobs, matrices, secrets, artifact upload, or GitHub status,
it belongs in Homeboy.
