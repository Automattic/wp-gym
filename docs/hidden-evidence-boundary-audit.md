# Hidden Evidence Boundary Audit

Issue: https://github.com/Automattic/wp-gym/issues/260

## Surfaces

WP Gym treats these task-facing surfaces as leak boundaries before a run can count as benchmark-mode evidence:

| Surface | Boundary | Benchmark-mode behavior |
| --- | --- | --- |
| Prompt | Model-facing task prompt and instruction excerpts | Must not include hidden grader, held-out/private fixture, expected answer, or task-policy internals. |
| Tools | Tool names, schemas, policy summaries, and tool outputs visible to the task runner | Must not expose hidden paths, expected outputs, grader file paths, or benchmark policy internals. |
| Workspace | Writable roots, hidden paths, starter workspace, and workspace references | Hidden paths must keep graders, scenarios, checks, and task sets outside writable/readable task workspace roots. |
| Artifacts | Eval artifacts, replay bundles, logs, screenshots, and artifact indexes | Public artifacts may carry hashes and aggregate results, not hidden source paths or answer-bearing bodies. |
| Report body | PR bodies, summaries, registry rows, and promotion reports | Reviewable text may describe pass/fail gates and hashes, not private prompt, fixture, grader, or expected-answer contents. |

## Hidden Evidence Kinds

The shared validator in `scripts/hidden-evidence-boundaries.mjs` requires audit coverage for:

| Kind | Meaning |
| --- | --- |
| `hidden_grader` | Private grader source, grader path, or grader assertions for held-out/private rows. |
| `held_out_variant` | Held-out scenario manifest, prompt, seed contents, fixture, or grader body. |
| `private_fixture` | Private setup data, fixture archive contents, or private pack internals. |
| `expected_answer` | Exact expected output, answer text, rubric string, or answer-bearing assertion content. |
| `task_policy_internal` | Benchmark promotion, scoring, task routing, or tool-policy internals that change agent behavior. |

## Implemented Gates

- `scripts/validate-runner-surface-audit.mjs` validates visible-agent-surface fixtures include hidden evidence boundary coverage for prompt, tools, workspace, artifacts, and report bodies.
- `scripts/validate-run-registry.mjs --benchmark-mode` fails closed when a registry row lacks hidden evidence audit metadata, marks the audit as not benchmark-eligible, reports exposed findings, or includes artifact names/paths that visibly reference hidden evidence.
- `scripts/benchmark-promotion.mjs` adds the `hidden_evidence_boundaries_clean` gate so scenario promotion checks fail when hidden paths are incomplete, private artifacts overlap public artifacts, held-out graders are not private, or held-out expected answers are embedded in the manifest.

## Accepted Exposures

Accepted exposures must be scoped to `pilot_only` or `non_benchmark`. The live runner-surface fixture keeps `github_pr_tool_visible` as pilot-only audit evidence because it is orchestration leakage, not benchmark-grade hidden evidence. Benchmark-mode rows must set `benchmark_mode_eligible=true` and keep `accepted_exposures` empty.

## Regression Fixtures

- `fixtures/runner-surface/visible-agent-surface.fixture.json` proves a clean benchmark-eligible visible surface audit passes.
- `fixtures/runner-surface/live-block-markup-valid-semantic-blocks-openai.json` documents a pilot-only accepted exposure while keeping hidden evidence covered.
- `fixtures/run-registry/invalid/hidden-evidence-exposed.json` proves benchmark-mode validation fails closed when hidden grader and expected-answer exposure is reported or artifact names leak hidden evidence references.
