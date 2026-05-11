# Task Runs

`wp-rl` uses Homeboy Extensions WordPress Playground workloads as the default
execution substrate. The repository supplies task data and completion checks;
Homeboy supplies the disposable WordPress runtime, result envelope, and
CI-friendly artifacts.

## Task Contract

Each task should add:

- A task manifest with task metadata and expected artifacts.
- A prompt with the model-facing request.
- A Playground blueprint when the task needs a custom WordPress starting state.
- A PHP completion check wired from `homeboy.json`.
- A `homeboy.json` `playground_workloads` entry that wires setup and completion checks.

Completion checks return the shared Homeboy result shape:

```json
{
  "success": true,
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
homeboy bench wp-rl --path . --extension wordpress --iterations 1
```

The Homeboy output can be converted into downstream artifacts:

```bash
node scripts/bench-to-jsonl.mjs homeboy-ci-results/bench.json reports/generated/results.jsonl
node scripts/leaderboard.mjs reports/generated/results.jsonl reports/generated/leaderboard.md
```

## CI Run

The GitHub Actions smoke workflow runs the same smoke task on pull requests and
manual dispatch. It uploads:

- The Homeboy result JSON.
- JSONL rows for downstream aggregation.
- A Markdown leaderboard for quick review.

This path intentionally uses Homeboy Extensions directly. Data Machine can be a
future model or agent provider, but the core task harness does not require it.
