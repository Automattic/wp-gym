# Eval Workflow

`wp-rl` uses Homeboy Extensions WordPress Playground workloads as the default
execution substrate. The repository supplies scenario data and graders; Homeboy
supplies the disposable WordPress runtime, result envelope, reward normalization,
and CI-friendly artifacts.

## Scenario Contract

Each scenario should add:

- `scenarios/<id>/manifest.json` with scenario metadata and expected artifacts.
- `prompts/<id>.md` with the model-facing objective.
- `blueprints/<id>.json` when the scenario needs a custom Playground state.
- `graders/<id>.php` returning the Homeboy reward payload.
- A `homeboy.json` `playground_workloads` entry that wires setup steps and the grader.

Graders return the shared reward shape consumed by Homeboy:

```json
{
  "success": true,
  "reward": 1,
  "done": true,
  "grade": {
    "max_score": 1,
    "score": 1,
    "checks": [
      { "id": "expected_state", "passed": true, "score": 1, "max_score": 1 }
    ]
  }
}
```

## Local Run

```bash
homeboy bench wp-rl --path . --extension wordpress --scenario smoke-homepage --iterations 1
```

The Homeboy bench output can be converted into downstream artifacts:

```bash
node scripts/bench-to-jsonl.mjs homeboy-ci-results/bench.json reports/generated/results.jsonl
node scripts/leaderboard.mjs reports/generated/results.jsonl reports/generated/leaderboard.md
```

## CI Run

`.github/workflows/eval-smoke.yml` runs the same smoke scenario on pull requests
and manual dispatch. It uploads:

- The Homeboy bench result JSON.
- JSONL rows for downstream aggregation.
- A Markdown leaderboard for quick review.

This path intentionally uses Homeboy Extensions directly. Data Machine can be a
future model/agent provider, but the core eval harness does not require it.
