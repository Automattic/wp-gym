# Run Registry and Artifact Index

Issue: [#136](https://github.com/Automattic/wp-gym/issues/136)

`wp-gym` owns a durable run registry entry for every completed eval run that is
eligible for lab comparison, calibration, or benchmark review. The registry is
not a replacement for the canonical eval artifact row from issue #117. It is the
discoverable index that lets downstream tools enumerate runs and locate the full
artifact bundle for each row.

The versioned JSON schema lives at `schemas/run-registry-entry.v1.schema.json`.
Fixtures live in `fixtures/run-registry/` and are validated by
`npm run run-registry:validate`.

## Registry Boundary

The canonical eval artifact row answers: what happened in this attempt?

The run registry answers: where can maintainers find this attempt later, and how
can it be compared safely?

Each registry entry indexes a canonical eval artifact row by:

- Task set ID, version, source path, source hash, benchmark status, headline-score eligibility, and compatibility group.
- Scenario ID, version, source path, source hash, prompt hash, and task family.
- Provider, model, actor, runtime, run ID, workflow URL, and outcome.
- Grade identity: grader hash, result hash, success, reward, and failure class.
- Calibration row type: no-op, scripted, cheap-model, frontier-model, repeated-attempt, human/reference, or excluded.
- Benchmark eligibility: pilot, calibrating, benchmark-ready, headline-score eligibility, compatibility group, and exclusion reasons.
- Immutable benchmark provenance: workflow and runner SHAs, runtime package-lock hash,
  provider/model snapshot, tool-policy hashes, scenario/prompt/grader/task-set hashes,
  and bundle hash.

## Artifact Index

Every registry entry embeds an `artifact_index` with stable references to the
files needed to inspect or replay the run:

- `eval_artifact`: canonical `wp-gym` eval artifact row.
- `grade`: terminal grade result or the canonical row that contains it.
- `replay`: replay bundle or replay trace bundle.
- Optional transcript, rendered output, screenshot, log, runtime bundle, and nested artifact index entries.

Benchmark-mode validation requires local, hashable artifact references. Remote
artifact URLs are useful as supplemental pointers, but they are not sufficient for
benchmark evidence because the validator cannot prove their contents. Local
artifact references must declare a SHA-256 hash, and stale hashes fail validation.

Benchmark-mode registry rows must also include top-level `provenance`. Mutable refs
such as `main`, `trunk`, `HEAD`, `refs/heads/*`, or `latest` are rejected even when
a separate SHA is present; the recorded `ref` itself must be an immutable commit SHA
or digest. Reports expose immutable workflow, tool-policy, and bundle fingerprints
with each accepted row so external labs can audit reruns before opening the full
eval artifact.

## Completed Run Flow

```text
runner finishes attempt
        |
        v
canonical eval artifact row
        |
        v
artifact bundle + hashes
        |
        v
run registry entry
        |
        v
labs enumerate by task_set / scenario / provider / model / outcome
        |
        v
maintainer opens eval_artifact, replay bundle, grade artifact, logs, screenshots
```

Labs should store registry entries in a durable location for the run collection
they own, then expose the directory or JSONL stream to comparison tooling. A
completed run becomes discoverable when its registry entry validates and points to
the full annotated artifact bundle.

## Emitting Entries

Use the repo-native emitter after downloading live workflow artifacts, or against
local canonical eval fixtures while shaping the workflow path:

```bash
npm run run-registry:emit -- \
  --input artifacts/<workflow-run-id> \
  --output artifacts/<workflow-run-id>/wp-gym-run-registry
```

The emitter scans JSON files for a canonical `metadata.eval_artifact`, top-level
canonical eval artifact, or Homeboy `homeboy.sealed_eval_artifact` replay row.
For each recovered row it writes:

- `eval-artifacts/<run>.json`: the canonical `wp-gym` eval artifact projection.
- `entries/<run>.json`: the durable run registry entry.

Benchmark-mode emission is fail-closed for live artifact compatibility:

```bash
npm run run-registry:emit -- \
  --input artifacts/<workflow-run-id> \
  --output artifacts/<workflow-run-id>/wp-gym-run-registry \
  --benchmark-mode
```

Pilot emission may surface live artifact compatibility gaps while still writing
non-headline registry entries. Benchmark evidence must clear both live artifact
validation and registry validation.

The live Data Machine workflow emits this registry automatically after the matrix
finishes. The `emit-run-registry` job downloads the `wp-gym-transcript-*-results`
artifacts produced by Homeboy Extensions, scans each `run-results.json` for
`scenarios[].metadata.eval_artifact` or `scenarios[].metadata.sealed_eval_artifact`,
writes one registry entry per recovered completed row, validates the entries, and
uploads `wp-gym-run-registry-<workflow-run-id>` with:

- `entries/`: validated run registry entries.
- `eval-artifacts/`: canonical `wp-gym` eval artifact projections.
- `report.json` and `report.md`: pilot-scope aggregate report output.
- `live-run-results/`: downloaded Homeboy result artifacts used as input.
- `live-replay-bundles/`: downloaded replay bundles when the runner emitted them.

Registry reports group calibration rows by both provider/model and model tier.
`calibration.model_tier` is the preferred explicit tier when present. When older
entries omit it, the report falls back to the row type for control rows and model
name heuristics for repeated-attempt rows. Large-N calibration reviews should use
the model-tier and task-family/model-tier sections to compare no-op, scripted,
cheap-model, frontier-model, repeated-attempt, and human/reference distributions
without mixing those rows into headline benchmark reports.

The emitter's `--require-entry` flag is used in the workflow so a live run cannot
silently pass registry emission when no eval row was recovered.

## Aggregating Reports

Use the report command to turn validated registry entries into JSON and Markdown:

```bash
npm run run-registry:report -- \
  --registry artifacts/<workflow-run-id>/wp-gym-run-registry/entries \
  --json artifacts/<workflow-run-id>/wp-gym-report.json \
  --markdown artifacts/<workflow-run-id>/wp-gym-report.md \
  --scope pilot
```

Add `--regrade` when the artifact bundle is retained locally and the report must
prove deterministic replay/regrade at corpus scale:

```bash
npm run run-registry:report -- \
  --registry artifacts/<workflow-run-id>/wp-gym-run-registry/entries \
  --json artifacts/<workflow-run-id>/wp-gym-regrade-report.json \
  --markdown artifacts/<workflow-run-id>/wp-gym-regrade-report.md \
  --scope all \
  --regrade
```

The replay/regrade section reports attempted rows, deterministic rows, success
rate, drift rate, missing artifact count, failure classes, and raw gap codes so
maintainers can separate nondeterministic rows from incomplete retained evidence.

Supported scopes:

- `pilot`: diagnostic rows and non-headline evidence.
- `benchmark`: rows with `benchmark.eligible=true`.
- `headline`: benchmark rows that are also headline-score eligible.
- `all`: every valid row.

Headline reports should use benchmark mode:

```bash
npm run run-registry:report -- \
  --registry runs/registry/entries \
  --json reports/headline.json \
  --markdown reports/headline.md \
  --scope headline \
  --benchmark-mode
```

## Validation

Run:

```bash
npm run run-registry:validate
```

The validator compiles `run-registry-entry.v1.schema.json` and checks:

- Required registry, run, scenario, task-set, runner, runtime, grade, calibration, benchmark, eval artifact, and artifact-index fields.
- Presence of grade identity.
- Presence of a replay bundle entry.
- Local artifact existence and SHA-256 agreement.
- Scenario and task-set source hashes against the referenced manifests.
- Canonical eval artifact scenario/task-set agreement with the registry entry.
- Benchmark-mode provenance presence, immutable refs, SHA/digest shape, and
  agreement between provenance fingerprints and registry provider/model,
  scenario/task-set, grader, prompt, bundle, and tool-policy fields.

Fixtures cover a valid canonical eval artifact row plus invalid cases for missing
grade identity, missing replay bundle, missing artifact hash, incompatible
scenario/task-set hashes, and mutable provenance refs.

The live workflow shape is covered locally by:

```bash
npm run run-registry:emit:test
```

That test builds a fixture `run-results.json` with
`scenarios[].metadata.sealed_eval_artifact`, runs the same emitter path used by the
workflow, then validates the emitted registry entry.
