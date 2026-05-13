# Task Runs

`wp-gym` uses Homeboy Extensions WordPress Playground workloads as the default
execution substrate. The repository supplies ordinary user/developer requests,
task metadata, and private completion checks; Homeboy supplies the disposable
WordPress runtime, Data Machine runner, generated code PRs, and replay artifacts.

The prototype loop is:

1. `wp-gym` selects a task and model matrix.
2. Homeboy starts a disposable WordPress Playground runtime.
3. Data Machine runs the task prompt through the selected model.
4. The model edits only the isolated `current-project` workspace alias.
5. Hidden PHP checks grade the finished WordPress state after the agent stops.
6. The runner opens one pull request per task/model with the generated files and
   a report body containing task, model, workflow, score, checks, changed files,
   tool summary, and replay/artifact links.

The generated PR body is the canonical review report for the prototype. Workflow
artifacts remain available for replay and debugging, but reviewers should not
need to download them to understand whether a model passed or failed the task.

## Prompt Shape

Task prompts should read like realistic requests from WordPress users or
developers. They should describe the desired outcome, content, and any public API
contract the requester would naturally know about.

Keep WordPress implementation-quality criteria in manifests and PHP checks. For
example, a user can ask for a pricing section with three plans, while the review
code can verify that the saved WordPress content remains editable and complete. A
developer can ask for a REST endpoint path and response fields, while the review
code can verify route registration details and permission handling.

For editable content and site-building tasks, prefer hidden checks that reward
Gutenberg block structure over shortcode markup. The agent-facing request should
ask for content the site owner can revise in the WordPress editor; the private
criteria should verify registered blocks and flag shortcode-like markup.

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
  run-wp-gym-task:
    uses: Extra-Chill/homeboy-extensions/.github/workflows/datamachine-agent-ci.yml@main
    with:
      bundle_path: bundles/datamachine-task-runner
      bundle_validator_spec: bundle-validator.json
      agent_slug: wordpress-task-runner
      pipeline_slug: wordpress-task-runner-pipeline
      flow_slug: wordpress-task-runner-flow
      target_repo: Automattic/wp-gym
      prompt: ${{ inputs.prompt }}
      success_requires_pr: false
    secrets: inherit
```

The workflow should resolve `prompt` from the selected task's prompt file. Setup
and completion checks stay in the Playground workload around the agent run, so
the agent only sees the ordinary WordPress user or developer request.

## First Live Task Set

The first live side-by-side task set is `task-sets/first-live-run.json`. It pins
three existing scenario manifests so the run can be repeated without relying on
the broader scenario directory order.

Selected tasks:

- `site-building-community-garden`: Marshside Community Garden site-building request.
- `block-markup-no-fallback-pricing-section`: editable pricing page layout request.
- `modern-wordpress-api-abilities-site-summary`: developer request for a site summary automation surface.

Private completion criteria stay in the scenario manifests and PHP checks. At a
high level, the checks look for WordPress-native content structure, required user
visible content, editable blocks instead of raw fallback markup, and the requested
developer API surface with the expected output fields. Shortcode-like markup is
treated as a quality failure for editable content tasks because it hides structure
from the block editor.

## Live Data Machine Runs

`.github/workflows/datamachine-live-run.yml` is the manual workflow for running
selected tasks side by side through the Data Machine agent loop in WordPress
Playground. The first matrix runs:

- OpenAI `gpt-5.5` with `OPENAI_API_KEY`.
- Anthropic `claude-opus-4-7` with `ANTHROPIC_API_KEY`.

The workflow delegates the agent run, provider plugin setup, Homeboy result JSON,
workspace capture, generated PR creation, transcript export, replay bundle
creation, and final PR summary refresh to Homeboy Extensions. `wp-gym` only
resolves task prompts/checks into a provider and task matrix.

Runner-owned PRs use Homeboy Extensions' data-driven artifact export templates.
For workspace-backed tasks, the runner captures the edited workspace branch,
opens a PR from that branch, then refreshes the PR summary after hidden grading
finishes. This keeps the model-facing task prompt clean while making the GitHub
PR identify the task, provider/model, workflow run, result, score, failed checks,
changed workspace branch, generated files, tool summary, and artifact/replay
links.

Homeboy Extensions also emits runner-owned reproducibility metadata in each
result. `wp-gym` projects the canonical eval envelope and fingerprints into the
workflow `engine_data_json` output so downstream reports can compare runs without
parsing the full Homeboy result JSON:

- `metadata.eval_artifact`: versioned canonical eval result envelope.
- `metadata.fingerprints.prompt.sha256`: model-facing task prompt fingerprint.
- `metadata.fingerprints.bundle.sha256`: Data Machine bundle fingerprint.
- `metadata.fingerprints.tool_policy.sha256`: enabled-tools and runner-policy fingerprint.

PR comments are not required for the prototype. Comments are useful for adding a
Homeboy report to a human-authored PR, but here the generated PR is itself the
evidence artifact. The PR body is intentionally stable and complete enough to
share directly.

The workflow uses the minimal Data Machine bundle from `bundles/datamachine-task-runner`
with the slugs from `bundle-validator.json`:

- Agent: `wordpress-task-runner`.
- Pipeline: `wordpress-task-runner-pipeline`.
- Flow: `wordpress-task-runner-flow`.

To trigger the first live run:

1. Open **Actions** -> **Data Machine Live Task Run**.
2. Click **Run workflow**.
3. Keep `task_set` as `first-live-run` to run the merged live task set, switch to
   `smoke` for the smallest wiring check, or enter `task_ids` as a comma-separated
   list such as `block-markup-no-fallback-pricing-section,modern-wordpress-api-abilities-site-summary`.
4. Leave `dry_run` disabled for a live model run, or enable it to validate the
   runner config without provider calls.
5. Confirm repository secrets include `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`.
6. Review the generated PRs. Each task/model that wrote workspace changes should
   have its own PR with the result summary and hidden-grade checks in the body.
7. Use workflow artifacts only when deeper replay/debugging is needed. Replay
   bundle artifacts are named `wp-gym-replay-<task>-<provider-model>` when the
   Homeboy runner emits them.

## Generated PR Body

The generated PR body is designed to be readable without opening CI logs. A clean
prototype PR should include:

- Task label and scenario ID.
- Provider and model.
- Workflow run URL.
- Success, reward, and score.
- Canonical eval artifact and input fingerprint locations in the Homeboy result
  JSON.
- Full hidden-grade check table with pass/fail, score, max score, and message.
- Changed workspace branch and file count.
- Links or paths for generated files and replay/job artifacts.
- Tool execution summary.

The PR title should include the task ID, provider/model, and result label, for
example:

```text
[wp-gym] failed - modern-wordpress-api-abilities-site-summary - openai/gpt-5.5
```

Generated PRs are review artifacts. Merge only intentionally accepted task
outputs; close failed or exploratory generated PRs after preserving the workflow
and PR links as evidence.
