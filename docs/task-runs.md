# Task Runs

`wp-rl` uses Homeboy Extensions WordPress Playground workloads as the default
execution substrate. The repository supplies ordinary user/developer requests,
task metadata, and private completion checks; Homeboy supplies the disposable
WordPress runtime and CI-friendly artifacts.

## Prompt Shape

Task prompts should read like realistic requests from WordPress users or
developers. They should describe the desired outcome, content, and any public API
contract the requester would naturally know about.

Keep WordPress implementation-quality criteria in manifests and PHP checks. For
example, a user can ask for a pricing section with three plans, while the review
code can verify that the saved WordPress content remains editable and complete. A
developer can ask for a REST endpoint path and response fields, while the review
code can verify route registration details and permission handling.

## Task Contract

Each task should add:

- A task manifest with task metadata and expected artifacts.
- A prompt with the model-facing user or developer request.
- A Playground blueprint when the task needs a custom WordPress starting state.
- A PHP completion check with the private WordPress quality criteria.
- A `homeboy.json` `playground_workloads` entry that wires setup and completion checks.

## CI Run

The GitHub Actions smoke workflow runs the same smoke task on pull requests and
manual dispatch. Homeboy Extensions emits the derived files next to the Homeboy
result JSON, and the workflow uploads:

- The Homeboy result JSON.
- JSONL rows for downstream aggregation.
- A Markdown leaderboard for quick review.

This path intentionally keeps task definitions separate from the agent loop.
Homeboy Extensions owns the disposable WordPress runtime and artifact shape; an
agent loop such as Data Machine can drive the same tasks without changing the
task corpus.

## Data Machine Bundle

The minimal Data Machine bundle lives at `bundles/datamachine-task-runner`. It
contains one agent, one manual flow, and one AI pipeline step. The bundle prompt
queue is intentionally empty; the Homeboy Extensions runner injects the selected
task prompt at run time from the task manifest or prompt file.

Use the reusable workflow with the bundle slugs from `bundle-validator.json`:

```yaml
jobs:
  run-wp-rl-task:
    uses: Extra-Chill/homeboy-extensions/.github/workflows/datamachine-agent-ci.yml@main
    with:
      bundle_path: bundles/datamachine-task-runner
      bundle_validator_spec: bundle-validator.json
      agent_slug: wordpress-task-runner
      pipeline_slug: wordpress-task-runner-pipeline
      flow_slug: wordpress-task-runner-flow
      target_repo: chubes4/wp-rl
      prompt: ${{ inputs.prompt }}
      success_requires_pr: false
    secrets: inherit
```

The workflow should resolve `prompt` from the selected task's prompt file. Setup
and completion checks stay in the Playground workload around the agent run, so
the agent only sees the ordinary WordPress user or developer request.
