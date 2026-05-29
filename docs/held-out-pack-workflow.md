# Private Held-Out Pack Workflow

Issues: [#165](https://github.com/Automattic/wp-gym/issues/165),
[#204](https://github.com/Automattic/wp-gym/issues/204),
[#212](https://github.com/Automattic/wp-gym/issues/212)

Private held-out packs let `wp-gym` run headline benchmark rows without putting
private prompts, fixtures, expected strings, screenshots, replay bundles, or
hidden grader assertions in the public repository. The public repo owns the
contract, schema, validator, and reporting boundary. Private labs own storage and
access control.

## Boundary

Public `wp-gym` may contain:

- The held-out pack manifest schema: `schemas/held-out-pack-manifest.v1.schema.json`.
- Public-safe pack indexes that expose IDs, versions, compatibility groups,
  variant families, sealed hashes, and aggregate report policy.
- Validators that can run against a private pack path supplied by a maintainer or
  lab system.
- Aggregate benchmark reports with outcomes, confidence intervals, compatibility
  metadata, and sealed artifact hashes.

Public `wp-gym` must not contain:

- Private prompts or paraphrases.
- Private reset data, expected strings, IDs, URLs, screenshots, or fixtures.
- Hidden grader code, exact assertions, thresholds, or negative cases.
- Raw replay bundles, transcripts, WordPress state snapshots, or result artifacts
  that reveal the task content.
- Private infrastructure URLs or credentials.

```text
public wp-gym repo                 private lab / private pack
------------------                 --------------------------
schema + validator        reads    pack manifest + sealed hashes
public-safe index    ----------->  private prompts / graders / fixtures
aggregate report     <-----------  outcomes + confidence intervals
sealed hashes only               raw replay/debug artifacts
```

## Manifest Shape

A held-out pack manifest is a JSON document with:

- `pack`: non-sensitive ID, version, label, compatibility group, creation time,
  and optional public reference.
- `boundary`: storage class, public-safe fields, withheld fields, artifact access,
  and public report policy.
- `promotion_policy`: required benchmark gates. The public contract currently
  requires benchmark replay, aggregate-only public reports, version identity, and
  hash-locked artifacts.
- `entries`: one row per private scenario variant, each with held-out split
  metadata, `benchmark_replay` task contract level, version identity hashes, and
  artifact references.

Private artifact references identify sealed bytes by `sha256`. When a private lab
validates the pack locally, those references may also include `path_or_url` values
relative to the private manifest. Public-safe indexes omit those paths and publish
only sealed hashes.

## Validation

Validate the public-safe fixture index:

```sh
npm run held-out-packs:validate
```

Validate a private pack manifest without committing private contents:

```sh
node scripts/validate-held-out-packs.mjs --input /path/to/private-pack/manifest.json --require-local-artifacts
```

Resolve a private pack without printing private prompts, grader paths, fixture paths,
or private filesystem roots:

```sh
node scripts/resolve-held-out-pack.mjs --input /path/to/private-pack/manifest.json --dry-run
```

The validator checks:

- Manifest schema compatibility.
- Every entry uses `split_membership=held_out_private` and
  `task_contract_level=benchmark_replay`.
- Required sealed artifacts exist in the manifest: scenario manifest, prompt,
  grader, setup, expected artifacts, and replay contract.
- Held-out artifacts do not use `public_report` sharing.
- With `--require-local-artifacts`, every artifact has a local path and matching
  SHA-256 digest.
- Any resolved private artifact path inside public repo `scenarios/`, `prompts/`,
  `fixtures/`, or `graders/` fails validation.

## Promotion Rules

A held-out pack can support headline benchmark claims only when:

- The task set has `benchmark_status=benchmark_ready`, `benchmark=true`,
  `headline_score_eligible=true`, `aggregate_score=true`, and
  `score_scope=benchmark`.
- The task set declares `split_policy.requires_held_out_private=true`.
- Every headline scenario resolves from the pack with
  `split_membership=held_out_private`.
- Every headline scenario has `calibration.status=benchmark_ready`,
  `calibration.benchmark_scope=benchmark`, `calibration.headline_score_eligible=true`,
  and `calibration.held_out_private_variants_ready=true`.
- Scenario and task-set benchmark metadata include version identity hashes.
- Public reports expose only aggregate outcomes, confidence intervals,
  compatibility metadata, non-sensitive IDs, and sealed hashes.

## Execution

Private execution is opt-in. Supply a private manifest path through
`WP_GYM_HELD_OUT_PACK` or `HELD_OUT_PACK_MANIFEST`:

```sh
WP_GYM_HELD_OUT_PACK=/path/to/private-pack/manifest.json \
  TASK_IDS=private-entry-id \
  node scripts/resolve-live-run-matrix.mjs --check
```

Without `GITHUB_OUTPUT`, held-out matrix output is a dry run: it validates and
resolves rows while replacing private prompt and grader fields with redaction
sentinels. With `GITHUB_OUTPUT`, the matrix writer emits runner inputs to the
workflow output file so the private lab can execute the task without printing the
raw prompt or grader path to stdout.

After a held-out live run, project the result into the run registry and aggregate
public-safe reports the same way as public runs:

```sh
node scripts/emit-run-registry.mjs --input /path/to/eval-artifacts --output /path/to/registry --require-entry
node scripts/aggregate-run-registry.mjs --registry /path/to/registry/entries --scope headline --json /path/to/public-report.json
```

Held-out registry rows may use `sealed://...` source paths for private task-set
and scenario manifests. Validators accept those sealed sources when the row keeps
the corresponding SHA-256 identity and `held_out.sealed_hashes` metadata. Public
reports include pack IDs, entry IDs, aggregate outcomes, confidence intervals,
compatibility metadata, and sealed hashes only.

## Local Behavior

Public validation remains useful without private access: it proves the schema,
public-safe index, and benchmark gates are coherent. Private validation is an
operator action: the maintainer supplies a private manifest path and uses
`--require-local-artifacts` to hash-check the restricted bytes in place.

No loader in the public repo assumes a private repo name, artifact host, secret
manager, CI provider, or Automattic-only infrastructure. Private labs can map the
manifest to their own storage as long as they preserve the public-safe schema and
hash/provenance policy.

## Public Fixture Coverage

`npm run held-out-packs:test` creates a synthetic private pack in a temporary
directory for the four `benchmark-readiness-pilot` scenario families, then
verifies the full public-safe path:

- public-safe pack index membership for every pilot scenario family;
- local private pack validation with `--require-local-artifacts` semantics;
- dry-run resolution without leaking prompt text or private filesystem paths;
- CI-style `GITHUB_OUTPUT` matrix resolution for live execution;
- run-registry projection with sealed held-out metadata;
- aggregate public report output that preserves sealed hashes without private
  materials.
