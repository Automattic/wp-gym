# WP Gym

WP Gym contains small WordPress implementation requests for disposable Playground
sites. It is a WordPress Playground environment for training and evaluating
agents on real WordPress tasks.

The current repository is an evaluation harness and task corpus, not yet a
Gymnasium-style `reset`/`step` Python package or a benchmark-ready RL suite.
Scenario manifests declare the episode contract that the runner consumes: reset
fixture, observation channels, allowed tools, writable roots, hidden paths,
completion policy, truncation budgets, reward spec, calibration status, and
expected artifacts. Those fields are validated locally and documented by
`schemas/scenario.schema.json`.

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

Current task areas include:

- Natural site-building requests with hidden WordPress-native quality criteria.
- Realistic page-building requests that a site owner might ask for.
- Developer requests for small plugins that expose WordPress data to other tools.
- A smoke task that keeps the Playground automation wired up.

Prompts are written as ordinary user or developer requests. WordPress quality
criteria, such as parseable content, fallback blocks, or required APIs, live in
task metadata and PHP checks, so review happens against final WordPress state
instead of chat transcripts.

Use `npm test` for the no-model gate: manifest/schema checks, live matrix
semantics, episode fixture validation, workspace policy fixtures, executable
reward-hacking fixtures, and PHP-backed grader fixture execution. Use
`npm run matrix:live-run -- --check` to verify that the live Data Machine
task/provider matrix resolves from scenario metadata without making model calls.

Stable task set manifests live in `task-sets/`. The first live side-by-side run
uses `task-sets/first-live-run.json`, which is currently a mixed pilot run and
not a headline benchmark. Scenario `calibration.status` must be promoted with
baseline results and adversarial fixtures before a task is benchmark-ready.
`BENCHMARK_MODE=1` intentionally rejects the current task set so pilot/demo rows
cannot be accidentally reported as benchmark scores.

The smoke workflow in `.github/workflows/playground-smoke.yml` exercises the
Playground path and uploads the artifacts emitted by Homeboy Extensions for
maintainers.

Manual side-by-side Data Machine runs are documented in `docs/task-runs.md` and
live in `.github/workflows/datamachine-live-run.yml`.
