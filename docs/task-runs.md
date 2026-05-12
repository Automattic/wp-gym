# Task Runs

`wp-gym` uses Homeboy Extensions WordPress Playground workloads as the default
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
      target_repo: chubes4/wp-gym
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
JSONL/leaderboard generation, transcript export, and replay bundle creation to
Homeboy Extensions. `wp-gym` only resolves task prompts/checks into a provider and
task matrix.

Runner-owned artifact PRs use Homeboy Extensions' data-driven artifact export
templates. `wp-gym` supplies task IDs and labels as template values, opts into full
job artifact JSON, and leaves result/check/tool/review tables to the reusable
runner so each model/task PR is reviewable without teaching the agent about GitHub.

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
6. Download the per-model artifacts from the completed workflow run. Replay
   bundle artifacts are named `wp-gym-replay-<task>-<provider-model>` when the
   Homeboy runner emits them.
