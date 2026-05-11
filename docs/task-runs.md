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
manual dispatch. It uploads:

- The Homeboy result JSON.
- JSONL rows for downstream aggregation.
- A Markdown leaderboard for quick review.

This path intentionally uses Homeboy Extensions directly. Data Machine can be a
future model or agent provider, but the core task-run path does not require it.
