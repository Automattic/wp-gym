# Runner Surface Audit Contract

Issues: [wp-gym #22](https://github.com/Automattic/wp-gym/issues/22),
[Homeboy Extensions #842](https://github.com/Extra-Chill/homeboy-extensions/issues/842)

`wp-gym` needs to know whether a live Data Machine row exposed benchmark,
workspace, PR, artifact, or orchestration language to the agent. The reusable
capture belongs to the Homeboy Extensions runner, not to `wp-gym`.

This repo therefore owns only the benchmark-side consumer contract:

- schema: `schemas/visible-agent-surface.v1.schema.json`
- fixture: `fixtures/runner-surface/visible-agent-surface.fixture.json`
- validator: `npm run runner-surface:test`

## Producer Boundary

Homeboy Extensions #842 should emit the real prompt/tool/workspace surface
artifact. `wp-gym` consumes that artifact through `eval_artifact.runner.surface`:

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

While the producer is pending, rows may declare:

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

Benchmark-mode validation reports this as a warning and issue #22 stays open
until real captured artifacts exist.

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
- `workspace_plugins_write_only`

If a captured artifact reports `task_sandbox_interference > 0`, treat the row as
audit evidence rather than clean benchmark signal until the upstream runner
surface is fixed.
