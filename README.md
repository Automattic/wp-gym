# WP Gym

WP Gym contains small WordPress implementation requests for disposable Playground
sites. It is a WordPress Playground environment for training and evaluating
agents on real WordPress tasks.

The current prototype runs the same WordPress task side by side across multiple
models, lets each model edit an isolated project workspace, and opens a separate
runner-owned pull request for each model's output. Those generated PRs are the
primary review surface: their bodies identify the task and model, link to the
workflow run, show the hidden grading result, list failed checks, summarize tool
usage, and point to replay artifacts.

The prompt files should read like normal requests from WordPress users or
developers. They describe the desired outcome, not the internal quality checks or
the exact implementation path.

Detailed WordPress expectations live outside the prompt files, in manifests and
PHP checkers. That keeps the request realistic while still letting automation
inspect the final WordPress state.

The corpus expansion plan in
[`docs/corpus-expansion-plan.md`](docs/corpus-expansion-plan.md) maps current and
planned task families, target milestones, and acceptance criteria for adding new
scenarios.

Current task areas include:

- Natural site-building requests with hidden WordPress-native quality criteria.
- Realistic page-building requests that a site owner might ask for.
- Visual-builder diagnostics for Elementor-style page state and builder-compatible edits.
- Content migration requests that import local media attachments into WordPress.
- Site-understanding requests that organize WordPress entities and relationships.
- Developer requests for small plugins that expose WordPress data to other tools.
- A smoke task that keeps the Playground automation wired up.

Prompts are written as ordinary user or developer requests. WordPress quality
criteria, such as parseable content, fallback blocks, or required APIs, live in
task metadata and PHP checks, so review happens against final WordPress state
instead of chat transcripts.

Use `npm run validate` for the local manifest and PHP syntax check.

The `wp-gym` adapter boundary for consuming WP Codebox is documented in
`docs/sandbox-runtime-adapter-contract.md`. WP Codebox remains the generic
isolated WordPress runtime substrate; `wp-gym` owns scenario, trace, grader,
reward, and eval artifact semantics.

Ownership boundaries across `wp-gym`, WP Codebox, Homeboy, Data Machine, and Data
Machine Code are documented in `docs/ownership-boundaries.md`.

Canonical episode schemas for action, observation, step result, and trace records
live in `schemas/` and are documented in `docs/episode-contract.md` for issue
#80. Use `npm run episode-schemas:validate` to compile and smoke-test those
contracts.

Stable task set manifests live in `task-sets/`. The first live side-by-side run
uses `task-sets/first-live-run.json`.

Visual-builder tasks live in their own task set at `task-sets/visual-builder.json`.
The first Elementor-oriented scenario validates Elementor-compatible WordPress
post metadata and rendered page state without requiring the full Elementor
runtime in Playground.

The smoke workflow in `.github/workflows/playground-smoke.yml` exercises the
portable `wp-gym` path and uploads artifacts for maintainers.

Manual side-by-side Data Machine runs are documented in `docs/task-runs.md` and
live in `.github/workflows/datamachine-live-run.yml`.

The benchmark-readiness pilot runbook and evidence plan for issue #9 is in
`docs/benchmark-readiness.md`. It documents the small OpenAI plus Anthropic
matrix, safe dry-run checks, live-run command shape, expected artifacts, and the
remaining gates before results can be called benchmark-ready.

Benchmark versioning, promotion, compatibility, deprecation, and retention policy
is documented in `docs/benchmark-versioning.md`.

Held-out variant and contamination-control policy is documented in
`docs/contamination-controls.md`. Public scenarios are training-visible; headline
benchmark claims require held-out/private split metadata and readiness gates.

The hidden grader handoff from WP Codebox artifacts into `wp-gym` PHP graders is
documented in `docs/grader-handoff.md`.

Use `wp-gym replay-regrade --input <eval-artifact-json-or-dir> --benchmark-mode`
to validate sealed eval artifact references, rehydrate local WordPress state
evidence, rerun the terminal PHP grader, and fail nonzero when the replayed grade
does not match the stored success, reward, score, checks, messages, or evidence
references. Benchmark mode reports missing replay-critical evidence as an error.

The local Gym-like `WPGym.make()` / `reset()` / `step()` / `grade()` API is
documented in `docs/local-api.md`; WordPress scenarios use WP Codebox's native
runtime episode API.
