# Reward Soundness Review

Issue: [#215](https://github.com/Automattic/wp-gym/issues/215)

Reward soundness review is the promotion checkpoint that confirms grader pass/fail
behavior matches expected WordPress quality before pilot or calibration tasks can be
used for headline benchmark claims.

## Review Artifact

Store review artifacts in `reviews/reward-soundness/*.json`. Each artifact records:

- The task set and issue being reviewed.
- A human reviewer or reference oracle.
- Representative passed outputs.
- Adversarial or failed outputs.
- Reviewer classification for whether the grader outcome matches expected WordPress quality.
- Remaining promotion blockers, especially unresolved reward shortcuts and diagnostic-only contracts.

Each scenario links the artifact from `calibration.reward_soundness_review` so the
promotion command can surface the evidence directly.

## Validation

Run:

```sh
npm run reward-soundness:validate
```

The validator requires every `benchmark-readiness-pilot` task to have review
artifact, and rejects unresolved reviewer/grader mismatches.

## Promotion Gate

`npm run benchmark-promotion:report -- --scenario <id> --check` blocks promotion
unless reward-soundness metadata is reviewed and linked. It also blocks when review
have not been reviewed.

The current pilot review is intentionally blocked from benchmark promotion: the
fixtures reviewed in `reviews/reward-soundness/benchmark-readiness-pilot.json` match
grader outcomes, but known reward shortcuts, diagnostic-only contracts, missing
held-out variants, and missing calibration evidence remain unresolved.
