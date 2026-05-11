# wp-rl

Playground-backed WordPress task runs.

`wp-rl` is a small WordPress task repository. It keeps task manifests, ordinary
user-request prompts, Playground starting states, WordPress completion checks,
and result publishing glue in one place while the sandbox comes from Homeboy
Extensions.

## Structure

```text
blueprints/   WordPress Playground starting states
checks/       Smoke task completion checks
docs/         Contributor and workflow docs
graders/      Block-markup task completion checks
prompts/      Model-facing user requests
reports/      Result fixtures and generated local artifacts
scenarios/    Block-markup task manifests
scripts/      Local validation and result conversion helpers
tasks/        Smoke task manifest and setup files
```

## Block-Markup Tasks

The block-markup tasks live in `scenarios/block-markup/`. Each manifest points to
a user request in `prompts/block-markup/` and a Playground PHP checker.

The task harness inspects final WordPress state, not transcript claims. An agent
should create or update the page title named in the prompt. The checker then
finds that page and parses `post_content` with WordPress block APIs.

Run the local manifest/PHP syntax check with:

```sh
node scripts/validate-scenarios.mjs
```

## Smoke Task Run

Run the smoke task through Homeboy's WordPress Playground runner:

```bash
homeboy bench wp-rl --path . --extension wordpress --iterations 1
```

The smoke task is declared in `homeboy.json` and backed by:

- `blueprints/smoke-homepage.json`
- `tasks/smoke-homepage/manifest.json`
- `prompts/smoke-homepage.md`
- `checks/smoke-homepage.php`

GitHub Actions runs the same task on pull requests and uploads the Homeboy
result, JSONL rows, and Markdown leaderboard when available.

## Local Artifact Conversion

Convert a Homeboy result to JSONL and leaderboard output:

```bash
node scripts/bench-to-jsonl.mjs homeboy-ci-results/bench.json reports/generated/results.jsonl
node scripts/leaderboard.mjs reports/generated/results.jsonl reports/generated/leaderboard.md
```

Use `npm run verify` to validate the artifact helpers against the checked-in
smoke fixture without booting Playground.
