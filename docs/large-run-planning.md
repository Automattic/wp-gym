# Large-Run Planning

Issue: [#261](https://github.com/Automattic/wp-gym/issues/261)

Large wp-gym runs should be planned like production batch jobs. The harness records
cost, token usage, wall time, queue time, retry counts, concurrency, and failure
classes in run registry entries when the runner or provider exposes them.

## Registry Metadata

Registry rows may include `operations`:

- `operations.cost.estimated_usd`, `billed_usd`, `currency`, and `pricing_source`.
- `operations.usage.input_tokens`, `output_tokens`, and `total_tokens`.
- `operations.timing.queue_ms`, `wall_ms`, `runner_ms`, and `provider_ms`.
- `operations.concurrency.requested`, `effective`, and `matrix_max`.
- `operations.retry.policy`, `retry_count`, `max_attempts`, `disposition`, and `previous_failure_class`.

The aggregate report rolls these fields up by provider/model, model tier, task,
task family, task family/model tier, result set, and failure class.

## Cost And Time Estimate

Before launching a large matrix, estimate:

```text
episodes = scenarios * models * attempts
estimated_cost_usd = episodes * mean_cost_per_episode_usd
estimated_wall_hours = episodes * mean_wall_ms / 3,600,000 / effective_concurrency
estimated_provider_tokens = episodes * mean_total_tokens
```

Use the latest pilot report as the source for `mean_cost_per_episode_usd`,
`mean_wall_ms`, and `mean_total_tokens`. Prefer task-family/model-tier rows over
global means when a matrix mixes cheap and frontier models.

## Retry Policy

Failure classes separate benchmark outcomes from infrastructure noise:

- `task_failure`: terminal task outcome. Count it in benchmark/calibration results.
- `provider_failure`: provider API timeout, rate limit, quota, auth, or upstream 5xx.
- `runtime_failure`: WordPress, browser, sandbox, filesystem, or replay environment failure.
- `runner_failure`: orchestration, artifact upload/download, workflow, or harness failure.
- `grader_failure`: grader crashed or produced an invalid grade.
- `agent_failure`: agent contract failure that is not a task-scoring failure.

Provider, runtime, and runner failures must carry retry metadata. Recommended default:

- Retry `provider_failure`, `runtime_failure`, and `runner_failure` up to 3 attempts
  with exponential backoff and jitter.
- Mark infra rows `retryable` until attempts are exhausted; mark the final row
  `exhausted` if it still fails.
- Keep `task_failure` as `task_terminal`; do not hide it behind infra retries.
- Use `manual_review` for ambiguous `agent_failure` and `grader_failure` rows.

## Budget Controls

Large live runs should set explicit controls before fanout:

- Maximum matrix rows and maximum attempts per row.
- Effective concurrency cap per provider/model tier.
- Cost ceiling in USD for the whole matrix and per task family.
- Token ceiling per episode for runaway prompts or transcripts.
- Queue-time ceiling that cancels stale jobs before provider calls begin.
- Fail-fast threshold for repeated provider/runtime/runner failures.

## Reporting Checklist

Before using a run as large-scale evidence, attach or publish:

- Registry `entries/` and aggregate `report.json` / `report.md`.
- Cost and token totals by task family/model tier.
- Throughput rows with wall time, queue time, and effective concurrency.
- Failure-class summary showing task failures separately from provider/runtime/runner failures.
- Retry counts and retry dispositions for every provider/runtime/runner failure.
