# wp-rl

Playground-backed WordPress task runs.

`wp-rl` is a small WordPress task repository. It keeps task manifests, prompts,
Playground blueprints, completion checks, and result publishing glue in one place
while the WordPress sandbox comes from Homeboy Extensions.

## Structure

```text
blueprints/   WordPress Playground starting states
checks/       WordPress completion checks
docs/         Contributor and workflow docs
prompts/      Model-facing task prompts
reports/      Result fixtures and generated local artifacts
scripts/      Local result conversion helpers
tasks/        Task manifests and setup files
```

## First Task Run

Run the smoke task through Homeboy's WordPress Playground runner:

```bash
homeboy bench wp-rl --path . --extension wordpress --iterations 1
```

The task is declared in `homeboy.json` and backed by:

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
