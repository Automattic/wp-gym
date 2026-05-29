# Held-Out Variants And Contamination Controls

Issue: [#138](https://github.com/Automattic/wp-gym/issues/138)

`wp-gym` separates public iteration tasks from benchmark-claim tasks. Public tasks
are useful for building agents, debugging graders, and calibrating task shape, but
they are training-visible material. Headline benchmark claims require held-out
private variants that are not exposed through public prompts, fixtures, expected
strings, or grader assertions.

## Split Lanes

| Lane | Purpose | Public material | Benchmark claim policy |
| --- | --- | --- | --- |
| `public` | Open iteration, examples, demos, and starter tasks. | Prompt, manifest, grader, fixtures, expected artifacts, and docs may be public. | Never headline-eligible by itself. Public results are diagnostics only. |
| `calibration` | Baseline runs, reward-hacking checks, model rows, and difficulty tuning. | Result summaries, row types, evidence links, and non-sensitive fixtures may be public. | Blocks benchmark mode until calibration and held-out readiness gates pass. |
| `validation` | Release-candidate checks for frozen task contracts. | Contract summaries and pass/fail evidence may be public when they do not reveal private variants. | May support promotion, but does not replace held-out private evaluation. |
| `held_out_private` | Benchmark rows used for headline claims. | Only non-sensitive identifiers, family names, readiness state, and aggregate summaries. | Required for benchmark-eligible rows and aggregate/headline scores. |

## Scenario Metadata

Every scenario manifest records a `split` object:

```json
{
  "split": {
    "membership": "public",
    "variant_family": "block-markup-cookout-page",
    "variant_seed": "neighborhood-cookout-public-v1",
    "parent_scenario_id": null,
    "artifact_policy": {
      "public_artifacts": ["prompt", "scenario_manifest", "grader"],
      "private_artifacts": ["held_out_prompt", "held_out_manifest", "held_out_grader"],
      "grader_exposure": "full_public"
    }
  }
}
```

- `membership` declares whether the scenario is public, calibration,
  validation, or held-out/private.
- `variant_family` groups public, calibration, validation, and held-out variants
  that test the same capability without sharing exact nouns, prompts, fixtures,
  or assertions.
- `variant_seed` is a stable non-secret identifier. It is not a random seed that
  can regenerate private materials.
- `parent_scenario_id` links derived variants to a parent public scenario when a
  private manifest can safely expose that relationship.
- `artifact_policy` names which artifact classes may be public and which must be
  withheld.

## Public Artifact Policy

Public lanes may expose:

- User-facing prompts for training and iteration.
- Scenario metadata, capability labels, split metadata, and task-set membership.
- Full public graders and reward-hacking fixtures when the task is explicitly
  training-visible.
- Calibration result summaries and local validation fixtures.

Public lanes must not expose private benchmark variant contents. A public
scenario may include a `held_out_private_variant` pointer that names only the
private family/reference and readiness state, as shown in
`scenarios/block-markup/valid-semantic-blocks.json`.

## Contamination-Sensitive Material

Held-out/private lanes keep these materials outside the public repository and
agent-visible workspaces:

- Private prompts and paraphrases.
- Seed data, expected strings, IDs, URLs, fixtures, and screenshots.
- Hidden grader code, thresholds, exact assertions, and negative cases.
- Replay bundles or result artifacts that reveal the private task contents.

Private rows may publish aggregate outcomes, confidence intervals, benchmark
eligibility status, and non-sensitive lineage identifiers after validation.

## Variant Rules

Held-out variants should preserve the same capability target while changing the
surface cues a model could memorize:

- Paraphrase the task request and change content nouns, labels, IDs, routes,
  titles, and media names.
- Use independent fixtures and expected artifacts.
- Keep private grader assertions semantically equivalent, not string-identical,
  to public graders.
- Avoid reusing public negative fixtures as private expected failures.
- Store private variants in a restricted benchmark pack or private repo, not in
  public `scenarios/`, `prompts/`, `fixtures/`, or `graders/` paths.

## Provider And Iteration Policy

Models and providers may have seen public tasks through training, public PRs, or
agent iteration. Treat public and calibration scores as development evidence.
Before a result can be a headline benchmark claim:

- The task-set `split_policy.requires_held_out_private` must be true.
- Each benchmark row must resolve to a scenario with
  `split.membership=held_out_private`.
- Scenario calibration must have `held_out_private_variants_ready=true`.
- Scenario calibration must have no open benchmark blockers and must use
  `task_contract_level=benchmark_replay`.
- Result artifacts must avoid leaking private prompt, fixture, and grader
  contents into public PR bodies or downloadable public artifacts.

The validation scripts enforce the public contract. Private-pack storage and
access control are private-lab concerns; the public-safe manifest boundary is
defined in [`held-out-pack-workflow.md`](held-out-pack-workflow.md).
