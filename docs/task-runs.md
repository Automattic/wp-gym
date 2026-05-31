# Task Runs

`wp-gym` owns the task corpus and eval contract: ordinary user/developer
requests, task metadata, private completion checks, rewards, traces, and reports.
The default local execution path uses WP Codebox runtime episodes for disposable
WordPress state. Homeboy supplies CI orchestration, matrix inputs, GitHub
workflow status, generated code PRs, and replay artifacts for live runs.

The prototype loop is:

1. `wp-gym` selects a task and model matrix.
2. Homeboy starts the CI job and invokes `wp-gym` with the selected task.
3. `wp-gym` creates a disposable WP Codebox runtime episode.
4. Data Machine, or another configured actor, runs the task prompt through the
   selected model.
5. The model edits only the isolated `current-project` workspace alias.
6. Hidden PHP checks grade the finished WordPress state after the agent stops.
7. The runner opens one pull request per task/model with the generated files and
   a report body containing task, model, workflow, score, checks, changed files,
   tool summary, and replay/artifact links.

The generated PR body is the canonical review report for the prototype. Workflow
artifacts remain available for replay and debugging, but reviewers should not
need to download them to understand whether a model passed or failed the task.
Artifact links in PR bodies should point only to `public_report` or approved
`private_lab` evidence under the
[`artifact redaction and sharing policy`](artifact-redaction-sharing-policy.md).

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

For content migration and media import tasks, prompts can point to source packages
provided in the task workspace. Manifests should declare the allowed import
surfaces through `environment.allowed_tools`; WP-CLI, REST API, filesystem staging,
and browser/UI flows are all acceptable when the scenario enables the required
tools. Hidden graders should verify final WordPress state separately for content,
attachment posts, local files, featured image metadata, and stale remote media
URLs.

## Reward And Fingerprints

Hidden PHP graders own the reward. Their `checks` array should contain the hard
task criteria that decide `success`, `reward`, and `grade.score`: required content,
registered WordPress blocks, valid API contracts, permission handling, and other
behavior the model was actually asked to produce.

Failed checks should also expose stable failure identifiers:

- `failure_reason` on each failed check.
- `failure_reasons` on the top-level result as the unique set of failed reasons.

Failure reasons are diagnostic labels, not extra scoring inputs. They let reports
compare failure modes across models without parsing human messages or changing
reward math.

Behavioral fingerprints are separate from rewards. They capture run shape for
analysis, such as prompt/bundle/tool-policy hashes from the runner or rendered
site design fingerprints declared in scenario `probes`. A fingerprint can explain
why two successful runs look different, reveal repeated visual tropes, or support
future corpus design work, but it should have `reward_weight: 0` until it is
promoted into an explicit hidden check.

Scenario manifests also declare rule policy separately from the grader code:

```json
{
  "rules": {
    "general": ["wordpress_editable_blocks", "no_raw_html_or_shortcodes"],
    "task_specific": ["required_semantic_blocks"]
  }
}
```

General rules are reusable WordPress expectations that can apply to many tasks,
such as editable block output, no raw HTML/shortcodes, production build parity,
WordPress docs standards, and no speculative plugin packaging metadata. Task
specific rules describe the scenario's private contract, such as required blocks,
REST route shape, or Abilities API lifecycle behavior.

The manifest declarations are policy labels. Hidden graders and Homeboy runner
checks still produce the actual pass/fail evidence and `failure_reason` values.
Homeboy preserves the rule policy under `metadata.eval_artifact.rules` so reports
can group failures by general versus task-specific expectations.

Homeboy also evaluates known general rules into
`metadata.eval_artifact.general_rule_results`. The first executable layer maps
grader failure reasons to general rules and checks production-build parity from
workspace evidence: `production_build_when_assets_change` passes when no buildable
assets changed, and reports `production_build_not_run` when CSS/JS/theme assets
changed without attached production-build evidence.

The grader handoff from WP Codebox artifacts into hidden `wp-gym` PHP graders is
documented in
[`docs/grader-handoff.md`](grader-handoff.md). That contract treats hidden grader
files and model-hidden inputs as `wp-gym`/runner policy, preserves the existing
`success`, `reward`, `grade.checks`, and `failure_reasons` result shape, and keeps
runtime failures, agent failures, grader failures, and task failures distinct.

The local Gym-like API is documented in [`docs/local-api.md`](local-api.md). It
uses the same scenario manifests and episode schemas for local experiments while
consuming WP Codebox for WordPress runtime orchestration.

## Task Contract

Each task should add:

- A task manifest with task metadata and expected artifacts.
- A prompt with the model-facing user or developer request.
- A Playground blueprint when the task needs a custom WordPress starting state.
- A PHP completion check with the private WordPress quality criteria.
- Reusable `rules.general` and scenario-specific `rules.task_specific` labels.
- Optional zero-weight `probes` for behavioral fingerprints.
- A `homeboy.json` `wp_codebox_workloads` entry that wires setup and completion checks.

The task-family roadmap and acceptance criteria for expanding the corpus are in
[`docs/corpus-expansion-plan.md`](corpus-expansion-plan.md).

## CI Run

The GitHub Actions smoke workflow runs the same smoke task on pull requests and
manual dispatch. Homeboy invokes `wp-gym`, preserves the Homeboy result JSON, and
the workflow uploads:

- The Homeboy result JSON.
- JSONL rows for downstream aggregation.
- A Markdown leaderboard for quick review.

This path intentionally keeps task definitions separate from the agent loop.
`wp-gym` owns task and eval semantics, WP Codebox owns the disposable WordPress
runtime and generic artifact shape, and an agent loop such as Data Machine can
drive the same tasks without changing the task corpus.

The long-term adapter contract for consuming WP Codebox is documented in
`docs/sandbox-runtime-adapter-contract.md`. That boundary keeps WP Codebox
generic while `wp-gym` maps runtime execution, observations, and artifacts into
eval actions, observations, step results, traces, rewards, and reports.

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

## Benchmark Readiness Pilot

The benchmark-readiness pilot task set is `task-sets/benchmark-readiness-pilot.json`.
It exists for issue #9 evidence collection, not headline scoring. It runs a small
OpenAI plus Anthropic matrix across two Gutenberg/block scenarios, one
Abilities/API plugin scenario, and one REST/plugin scenario.

Use `docs/benchmark-readiness.md` for the exact dry-run command, live-run command,
artifact collection steps, pilot summary template, and gates that must be met
before the matrix can be marked benchmark-ready.

## WordPress Investigation Task Set

The `wordpress-investigation` task set starts the issue #49 investigation family.
These tasks are non-mutating WordPress debugging requests: the model should inspect
the live site with WP-CLI, keep queries bounded to the requested state, and return
an evidence-backed answer rather than code changes. Hidden graders can read the
final response and runner tool artifacts to check that the answer cites the actual
WordPress state and that WP-CLI was used.

The first task, `wordpress-investigation-homepage-source-diagnosis`, asks why a
fresh site's homepage is showing latest posts instead of a static page. The hidden
criteria check for the current `show_on_front` and `page_on_front` option values,
the diagnosis, the static-homepage remediation, and WP-CLI evidence.

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
- `metadata.eval_artifact.provenance`: benchmark-mode workflow, runner, runtime,
  provider, tool-policy, and task-input provenance for immutable replay.
- `metadata.fingerprints.prompt.sha256`: model-facing task prompt fingerprint.
- `metadata.fingerprints.bundle.sha256`: Data Machine bundle fingerprint.
- `metadata.fingerprints.tool_policy.sha256`: enabled-tools and runner-policy fingerprint.

The versioned eval artifact projection is documented in
`docs/eval-artifact-projection.md` and defined by
`schemas/eval-artifact.schema.json`. Per issue
[#117](https://github.com/Automattic/wp-gym/issues/117), WP Codebox artifacts and
Homeboy sealed artifacts remain runner/runtime evidence while `wp-gym` owns the
canonical scenario, task-set, model, grader, and failure-class row semantics.
Per issue [#140](https://github.com/Automattic/wp-gym/issues/140), benchmark-mode
rows additionally require immutable provenance for workflow code, runtime package
versions, provider plugins, model/provider metadata, agent instructions, tool
policy, scenario/prompt/grader/task-set inputs, and bundle fingerprints.

PR comments are not required for the prototype. Comments are useful for adding a
Homeboy report to a human-authored PR, but here the generated PR is itself the
evidence artifact. The PR body is intentionally stable and complete enough to
share directly.

The workflow uses the minimal Data Machine bundle from `bundles/datamachine-task-runner`
with the slugs from `bundle-validator.json`:

- Agent: `wordpress-task-runner`.
- Pipeline: `wordpress-task-runner-pipeline`.
- Flow: `wordpress-task-runner-flow`.

Workspace-backed developer tasks can expose the runner-owned `run_wp_cli` tool
through their scenario `environment.allowed_tools`. The live-run matrix turns on
terminal actions for those rows, so the agent can run real WP-CLI commands
against the disposable WP Codebox runtime while `wp-gym` still captures the
command output as task evidence.

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
7. Review the `wp-gym-run-registry-<workflow-run-id>` artifact. It contains one
   validated registry entry per recovered completed eval row, the canonical eval
   artifact projections, and a pilot-scope report.
8. Use workflow artifacts only when deeper replay/debugging is needed. Replay
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
