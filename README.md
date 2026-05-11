# wp-rl

Playground-backed WordPress reinforcement-learning and model evaluation scenarios.

`wp-rl` is a small scenario repository. It keeps scenario manifests, prompts,
Playground blueprints, graders, and result publishing glue in one place while the
actual WordPress sandbox comes from Homeboy Extensions.

## Structure

```text
blueprints/   WordPress Playground starting states
docs/         Contributor and workflow docs
graders/      PHP graders that run inside Playground
prompts/      Model-facing task prompts
reports/      Result fixtures and generated local artifacts
scenarios/    Scenario manifests and metadata
scripts/      Local result conversion helpers
```

## First Eval Path

Run the smoke scenario through Homeboy's WordPress Playground bench runner:

```bash
homeboy bench wp-rl --path . --extension wordpress --scenario smoke-homepage --iterations 1
```

The scenario is declared in `homeboy.json` and backed by:

- `scenarios/smoke-homepage/manifest.json`
- `blueprints/smoke-homepage.json`
- `prompts/smoke-homepage.md`
- `graders/smoke-homepage.php`

GitHub Actions runs the same scenario on pull requests and uploads the Homeboy
bench result, JSONL rows, and Markdown leaderboard when available.

## Local Artifact Conversion

Convert a Homeboy bench result to JSONL and leaderboard output:

```bash
node scripts/bench-to-jsonl.mjs homeboy-ci-results/bench.json reports/generated/results.jsonl
node scripts/leaderboard.mjs reports/generated/results.jsonl reports/generated/leaderboard.md
```

Use `npm test` to validate the artifact helpers against the checked-in smoke
fixture without booting Playground.
