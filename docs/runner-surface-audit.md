# Runner Surface Audit Contract

Issues: [wp-gym #22](https://github.com/Automattic/wp-gym/issues/22),
[Homeboy Extensions #842](https://github.com/Extra-Chill/homeboy-extensions/issues/842)

`wp-gym` needs to know whether a live Data Machine row exposed benchmark,
workspace, PR, artifact, or orchestration language to the agent. The reusable
capture belongs to the Homeboy Extensions runner, not to `wp-gym`.

This repo therefore owns only the benchmark-side consumer contract:

- schema: `schemas/visible-agent-surface.v1.schema.json`
- fixture contract: `fixtures/runner-surface/visible-agent-surface.fixture.json`
- live evidence fixture: `fixtures/runner-surface/live-block-markup-valid-semantic-blocks-openai.json`
- validator: `npm run runner-surface:test`

## Producer Boundary

Homeboy Extensions #842 emits generic prompt/tool/workspace surface evidence as
`metadata.runner_evidence` in each `run-results.json`. `wp-gym` consumes either
that extracted evidence or a referenced standalone artifact through
`eval_artifact.runner.surface`:

```json
{
  "runner": {
    "surface": {
      "status": "captured",
      "producer_issue": "https://github.com/Extra-Chill/homeboy-extensions/issues/842",
      "reference": {
        "kind": "visible_agent_surface",
        "path_or_url": "visible-agent-surface.json",
        "sha256": "..."
      }
    }
  }
}
```

Older rows may declare:

```json
{
  "runner": {
    "surface": {
      "status": "producer_pending",
      "producer_issue": "https://github.com/Extra-Chill/homeboy-extensions/issues/842"
    }
  }
}
```

Benchmark-mode validation reports this as a warning. Current rows should prefer
captured producer evidence from `metadata.runner_evidence`.

## Live Audit Evidence

Run https://github.com/Automattic/wp-gym/actions/runs/26641080784 produced a
captured runner surface for `block-markup-valid-semantic-blocks` on
`openai/gpt-5.5`. The evidence is represented in
`fixtures/runner-surface/live-block-markup-valid-semantic-blocks-openai.json`.

The row confirms the useful producer contract is now present:

- task prompt hash and instruction sources are captured
- runner-required abilities are captured separately from task tools
- tool audit events are redacted
- workspace capture state is explicit
- runtime/model/WordPress version data is captured

The audit also found one task-sandbox interference item:

| Finding | Surface | Recommendation |
| --- | --- | --- |
| `github_pr_tool_visible` | `create_github_pull_request` appeared in the task tool audit events. | Keep these rows as audit/calibration evidence until PR publication is moved outside the task-facing tool surface. |

Upstream tracker: https://github.com/Extra-Chill/homeboy-extensions/issues/852

## Classification

Each visible instruction or tool is classified as:

| Classification | Meaning |
| --- | --- |
| `acceptable_scaffolding` | Necessary sandbox/task setup that does not reveal benchmark mechanics. |
| `task_sandbox_interference` | Visible language that could bias task behavior, such as PR, grading, artifact, evaluation, or hidden-test instructions. |
| `unknown` | Needs human review before treating the row as clean signal. |

## Minimal Live-Run Config

The fixture records the current recommended minimal config:

- `disable_datamachine_directives`
- `scenario_allowed_tools_only`
- `hide_grader_and_task_metadata`
- `workspace_plugins_write_only` for code/workspace rows
- `publish_pr_outside_task_surface`

If a captured artifact reports `task_sandbox_interference > 0`, treat the row as
audit evidence rather than clean benchmark signal until the upstream runner
surface is fixed.
