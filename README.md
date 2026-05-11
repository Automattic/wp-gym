# WordPress Practice Tasks

This repository contains small WordPress implementation requests for disposable
Playground sites.

Current coverage includes:

- Gutenberg block markup that WordPress can parse as real blocks.
- Small plugins that use current WordPress API surfaces, including the Abilities
  API and REST API.
- A smoke task that proves the Playground task-run wiring and artifact output.

Prompts are written as ordinary user requests. The task harness inspects final
WordPress state, not transcript claims.

Use the Node script in `scripts/` for the local manifest and PHP syntax check:

```sh
node scripts/validate-scenarios.mjs
```

Run the smoke task through Homeboy's WordPress Playground runner:

```sh
homeboy bench wp-rl --path . --extension wordpress --iterations 1 --ignore-baseline --setting-json playground_scenario_manifests=[]
```

Convert a Homeboy result to JSONL and leaderboard output:

```sh
node scripts/bench-to-jsonl.mjs homeboy-ci-results/bench.json reports/generated/results.jsonl
node scripts/leaderboard.mjs reports/generated/results.jsonl reports/generated/leaderboard.md
```
