# Grader Handoff Contract

Issue: [#89](https://github.com/Automattic/wp-gym/issues/89)

`wp-gym` owns hidden grading and reward policy. Sandbox Runtime, including the
`wp-codebox` execution path, owns the isolated WordPress runtime, agent execution,
state capture, and artifact export. The handoff between them is a runner contract:
runtime state and artifacts become private grader inputs, then `wp-gym` projects the
grader output into the canonical eval result.

Sandbox Runtime must not learn benchmark semantics such as hidden graders, model
visibility, reward thresholds, or failure reason IDs. Those are `wp-gym` and runner
policy layered above the generic runtime substrate.

## Handoff Flow

1. `wp-gym` resolves a scenario manifest, prompt, private grader file, hidden paths,
   runner workspace policy, and expected artifacts.
2. The runner starts a Sandbox Runtime task with only the model-visible prompt,
   writable roots, allowed tools, and runtime limits.
3. Sandbox Runtime executes the agent in an isolated WordPress environment and
   returns task status plus captured runtime state and artifacts.
4. The runner mounts or references private grader inputs outside the model-visible
   sandbox, restores the final WordPress state, and executes the scenario PHP grader.
5. `wp-gym` normalizes the grader result into the eval envelope used by reports and
   aggregation.

## Grader Inputs

A PHP grader may inspect the final state and artifacts made available by the runner:

- Final WordPress database and active runtime state.
- Files in the writable workspace, such as submitted plugin or theme files.
- Workspace diff and changed-file summaries.
- Runtime logs, transcripts, tool summaries, observations, and screenshots.
- Runner metadata, including scenario ID, provider/model, prompt fingerprint,
  bundle fingerprint, tool-policy fingerprint, timeout/truncation status, and
  artifact locations.

The runner decides which artifacts are mounted as files, exposed through
environment variables, passed as JSON metadata, or linked in the final report.
Graders should treat missing optional artifacts as a failed or skipped check only
when that artifact is part of the scenario contract.

Hidden grader files, hidden paths, and model-hidden inputs are `wp-gym`/runner
policy. For example, `environment.hidden_paths` may hide `graders/`, `scenarios/`,
`checks/`, or `task-sets/` from the agent workspace, and the runner may mount the
selected PHP grader only after the agent stops. Sandbox Runtime only enforces the
workspace/tool/runtime isolation requested by the runner; it does not know why a
path is hidden or whether a file is a grader.

## Eval Result Shape

PHP graders keep returning the existing shape:

```json
{
  "success": false,
  "reward": 0.75,
  "failure_reasons": ["missing_required_text"],
  "grade": {
    "score": 3,
    "max_score": 4,
    "checks": [
      {
        "id": "expected_heading_text",
        "passed": false,
        "score": 0,
        "max_score": 1,
        "message": "Expected heading text was not found.",
        "failure_reason": "missing_required_text"
      }
    ]
  }
}
```

Reports and aggregation should continue to read `success`, `reward`,
`grade.checks`, and top-level `failure_reasons`. Additional runner metadata belongs
under the surrounding result metadata, not inside the grader scoring contract unless
it is an explicit scenario check.

## Failure Boundaries

The runner must classify failures before aggregation so scores from different
failure classes are not conflated:

- Runtime failure: Sandbox Runtime could not start, restore WordPress, execute the
  agent loop, enforce limits, or export required state/artifacts. No PHP grader
  result is authoritative.
- Agent failure: The runtime completed, but the agent stopped without producing a
  usable attempt, exceeded its declared budget, refused the task, or otherwise did
  not reach the scenario completion policy. The grader may still run when final
  state exists, but the runner records the agent status separately.
- Grader failure: The PHP grader crashed, timed out, returned invalid JSON, or
  returned a shape missing required eval keys. The task output is not scored as a
  normal task failure because the grading mechanism failed.
- Task failure: Runtime and grader both completed, and the grader returned
  `success: false` with a valid `reward`, `grade.checks`, and `failure_reasons`.
  This is the normal model-quality failure path.

Stable aggregation should use the failure class plus any stable
`failure_reasons`. Runtime, agent, and grader failures may have runner-owned error
codes, but they should not masquerade as hidden task check failures.

## Scenario Example

`modern-wordpress-api-abilities-site-summary` uses `action_mode: "workspace"` and
expects `plugin_files`, `workspace_diff`, and `grader_result` artifacts. The model
only sees the developer request and editable `plugins/` workspace. After the agent
stops, the runner restores the final WordPress state, exposes the submitted plugin
files through the configured workspace root, mounts the private PHP grader from
`graders/modern-wordpress-api/abilities-site-summary.php`, and executes it against
WordPress.

The grader inspects registered abilities and submitted source, returns the standard
`success`/`reward`/`grade.checks`/`failure_reasons` shape, and the runner places
that result under `metadata.eval_artifact` with fingerprints and artifact links for
review. If the plugin misses the requested ability output, that is a task failure.
If the sandbox cannot export the workspace, that is a runtime failure. If the agent
hits its budget before a usable attempt, that is an agent failure. If the hidden PHP
grader throws before returning valid output, that is a grader failure.
