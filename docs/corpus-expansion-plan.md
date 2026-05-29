# Corpus Expansion Plan

Issue: [#68](https://github.com/Automattic/wp-gym/issues/68)

`wp-gym` should grow by task family, not by one-off prompts. Each family needs a
repeatable scenario shape, hidden graders that inspect final WordPress state or
workspace artifacts, and stable task sets that separate experimental scenarios from
benchmark-ready comparisons.

## Current Coverage

| Family | Current scenarios | Coverage today | Next gap |
| --- | --- | --- | --- |
| `block-markup` / editable block layout | `block-markup-valid-semantic-blocks`, `block-markup-no-fallback-pricing-section`, `block-markup-nested-layout-blocks` | Gutenberg block validity, semantic blocks, fallback avoidance, shortcode/raw HTML detection. | Add more page patterns and nested block constraints before promoting any task set as calibrated. |
| `site-building` | `site-building-community-garden` | Natural site-owner request with homepage, navigation, block-theme, editable content, and rendered-site evidence. | Add more site genres, multi-page requirements, theme constraints, and design fingerprint probes. |
| `modern-wordpress-api` / plugin API | `modern-wordpress-api-abilities-site-summary`, `modern-wordpress-api-rest-route-status` | Workspace-backed plugin tasks covering Abilities API and REST route contracts. | Add more API surfaces, permission models, activation/lifecycle checks, and negative cases. |
| `smoke` | `smoke-homepage` | Minimal automation wiring check. | Keep as infrastructure smoke only; do not use for model quality comparisons. |

## Planned Families

| Family | Tracking issue | Target milestone shape | Hidden grader needs |
| --- | --- | --- | --- |
| `wordpress-investigation` | [#49](https://github.com/Automattic/wp-gym/issues/49) | Single-site lookup, multisite navigation, cross-site search, operational diagnosis, and content provenance tasks. | WP-CLI or runtime command evidence, scoped multisite assertions, bounded-query checks, expected object IDs/URLs/snippets, and stable evidence/failure reason IDs. |
| `content-migration` / `media-import` | [#83](https://github.com/Automattic/wp-gym/issues/83) | Import/export tasks with posts, pages, attachments, featured images, inline image blocks, and stale remote URL traps. | Independent checks for content records, attachment posts, physical files, featured image meta, local media URLs, and allowed import surfaces. |
| `site-understanding` / `entity-relationship` | [#84](https://github.com/Automattic/wp-gym/issues/84) | Evidence-grounded questions over seeded content, taxonomies, menus, metadata, blocks, and optional custom post types. | Structured expected entities/relationships, evidence requirements, hallucination detection, missing-evidence failures, and source object references. |
| `visual-builder` / `elementor` | [#85](https://github.com/Automattic/wp-gym/issues/85) | Optional/plugin-specific visual-builder tasks that modify existing builder-managed pages without replacing them with raw HTML. | Builder-state checks, rendered screenshot/DOM evidence, preservation of builder metadata, bypass detection, and documented Playground/licensing limits. |
| `admin-editor-performance` / diagnosis | [#68](https://github.com/Automattic/wp-gym/issues/68) | Admin/editor diagnosis tasks that explain slow or broken WordPress behavior from runtime evidence. | Timings, request counts, logs, WP state, reproducible observation artifacts, and separation of diagnosis quality from infrastructure failure. |

## Task Set Milestones

Use stable `task-sets/` manifests for repeatable comparisons:

| Milestone | Shape | Promotion criteria |
| --- | --- | --- |
| Prototype | Existing first-live-run mix of site-building, block layout, and modern API tasks. | Automation runs end-to-end and generated PRs expose hidden-grade results. |
| Family pilots | At least one runnable scenario per planned family, marked pilot or demo as appropriate. | Each scenario has a prompt, manifest, grader, expected artifacts, stable failure reasons, and at least one local/CI validation path. |
| Balanced diagnostic set | Multiple scenarios per family with comparable difficulty bands. | Baseline results exist across supported models, graders distinguish task failure from runtime/grader failure, and known shortcuts are documented. |
| Benchmark-ready set | Versioned task set with calibrated difficulty and no headline blockers. | Repeated runs are stable enough for model comparison, failure reasons aggregate cleanly, and scenario contracts are frozen except for bug fixes. |

## Scenario Acceptance Criteria

Before adding a scenario to a repeatable task set, require:

- A model-facing prompt that reads like a normal WordPress user or developer request.
- A scenario manifest with family tags, environment policy, hidden paths, expected artifacts, reward spec, rules, and calibration status.
- Split metadata that declares whether the scenario is `public`, `calibration`,
  `validation`, or `held_out_private`, plus variant-family lineage and public vs
  private artifact policy.
- A hidden grader that returns the standard `success`, `reward`, `grade.checks`, and `failure_reasons` shape.
- Stable `failure_reason` IDs that distinguish task-quality failures from runtime, agent, or grader failures.
- Final-state checks against WordPress data, workspace files, rendered output, command evidence, or artifacts rather than transcript-only assertions.
- Expected artifacts that are available to generated PRs and replay/debugging workflows.
- A documented shortcut list for behavior the grader should catch or the family still cannot evaluate.
- Inclusion in an experimental task set first, with promotion to benchmark-ready only after baseline runs and calibration.

## Split And Variant Policy

Use `docs/contamination-controls.md` as the source of truth for public,
calibration, validation, and held-out/private lanes. Existing public scenarios are
training-visible and may publish full graders. Benchmark-claim variants should be
separate `held_out_private` manifests in a restricted benchmark pack, linked by
`split.variant_family` and optional `split.parent_scenario_id` without exposing
private prompts, fixtures, or grader details.

## Target Counts

For the next corpus milestone, aim for small but balanced pilots:

- Keep the existing `block-markup`, `site-building`, and `modern-wordpress-api` families active with at least three runnable scenarios each.
- Add at least one runnable pilot scenario for `wordpress-investigation`, `content-migration`, `site-understanding`, and `visual-builder` before combining them into balanced comparison sets.
- Treat `admin-editor-performance` as a planned diagnostic family until the required observation artifacts and grading primitives are proven in a pilot.
