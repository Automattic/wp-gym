# Failure Reason Taxonomy

Issue: [#66](https://github.com/Automattic/wp-gym/issues/66)

`wp-gym` graders return human-readable check messages plus stable machine-readable
failure reason IDs. Aggregation should use these IDs with the surrounding failure
class, not raw grader check IDs.

## Contract

- `grade.checks[].id` identifies the grader assertion and may change as graders are
  refactored.
- `grade.checks[].message` remains the reviewer-facing explanation.
- `grade.checks[].failure_reason` is the stable aggregate ID for a failed check.
- Top-level `failure_reasons` is the unique set of failed check reasons.
- Runtime, agent, and grader infrastructure failures use runner-owned error codes;
  hidden task failure IDs stay owned by `wp-gym`.

## Initial Families

- Content and semantic failures: missing target content, missing required content,
  semantic content loss, missing block markup, invalid blocks, raw HTML shortcuts,
  and fallback blocks.
- Site-building failures: layout structure mismatches, missing CTA/navigation/theme
  requirements, missing builder metadata, and missing builder widgets.
- API/plugin failures: wrong API lifecycle, missing registrations/routes,
  mismatched output shape, invented plugin metadata, and speculative packaging
  metadata.
- Migration/media failures: missing attachments, missing files, missing featured
  images, and stale remote media URLs.
- Investigation/site-understanding failures: missing evidence, incorrect diagnosis,
  incomplete inspection, hallucinated entities, and wrong relationships.

## Source Of Truth

The taxonomy and check-ID mapping live in `graders/failure-reasons.php`. New PHP
graders should call `wp_gym_add_failure_reasons_to_checks()` or route through the
shared `wp_gym_grade()` helpers instead of emitting ad hoc IDs.

If a new failure mode is needed, add it to `wp_gym_failure_reason_taxonomy()` first,
then map grader check IDs to it in `wp_gym_failure_reason_check_map()`.
