# Corpus Coverage Report

Issue: [#242](https://github.com/Automattic/wp-gym/issues/242)

This public-safe report summarizes scenario breadth and held-out/private readiness
without exposing private prompts, fixtures, graders, expected answers, screenshots,
or replay bundles. Generate the current report with:

```sh
npm run corpus:coverage
node scripts/report-corpus-coverage.mjs --json
```

## Requested Area Coverage

| Requested area | Public coverage state | Representative public scenarios | Held-out/private state |
| --- | --- | --- | --- |
| Gutenberg blocks | Covered | `block-markup-valid-semantic-blocks`, `block-markup-no-fallback-pricing-section`, `block-markup-nested-layout-blocks` | Existing indexed or planned private variants. |
| Themes/site editing | Covered | `site-building-community-garden`, block-markup layout scenarios, `visual-builder-elementor-hero-refresh` | Site-building and visual-builder rows remain demo/diagnostic, so they are not benchmark candidates yet. |
| Plugin APIs | Covered | `modern-wordpress-api-rest-route-status`, `modern-wordpress-api-abilities-site-summary`, `admin-settings-notice-settings-page`, `modern-wordpress-api-ai-provider-status` | Existing indexed or planned private variants. |
| REST/Abilities | Covered | `modern-wordpress-api-rest-route-status`, `modern-wordpress-api-abilities-site-summary` | Indexed held-out entries exist for the current benchmark-readiness pilot API families. |
| Admin UI | Covered | `admin-settings-notice-settings-page`, `visual-builder-elementor-hero-refresh` | Admin settings has sealed/indexed or planned private coverage; visual-builder remains demo/non-eligible until a full runtime contract exists. |
| Data APIs | Covered | REST, Settings API, media import, site-understanding, and WP-CLI investigation scenarios | Benchmark-replay families have indexed or planned private variants; diagnostic families document non-eligibility. |
| CLI operations | Covered | `wordpress-investigation-homepage-source-diagnosis` | Diagnostic-only, not benchmark-candidate until replayable evidence contracts improve. |
| Media | Covered | `content-migration-media-attachment-import` | Planned private import-package variant; private media fixtures stay outside this repo. |
| Permissions/security | Covered | REST permission callbacks, Abilities permission callbacks, admin capability gates, sanitization/escaping checks | Covered through visible rule/criteria metadata; private grader thresholds remain withheld. |
| Performance | Gap | None | Planned diagnostic family only; no scenario should claim performance coverage until timing/request-count observation artifacts and graders exist. |
| AI/tooling surfaces | Covered | `modern-wordpress-api-ai-provider-status`, `modern-wordpress-api-abilities-site-summary` | AI provider public pilot uses a planned sealed provider-fixture variant; provider names, prompts, grader thresholds, and replay artifacts stay private. |

## Held-Out Eligibility Policy

The coverage reporter treats a family as accounted for when one of these public-safe
states is present:

- `indexed`: a public-safe held-out pack index includes sealed metadata for the parent scenario.
- `planned`: the scenario manifest declares a planned private variant pointer without private contents.
- `not_applicable`: the scenario is demo or diagnostic-only and is not benchmark-candidate material yet.

Any benchmark-replay family without one of those states is reported as a held-out
gap by `npm run corpus:coverage -- --check`.

## Remaining Gaps

- Add a performance/admin-editor diagnostic family only after the harness can capture reliable timing, request-count, log, and runtime evidence artifacts.
- Promote planned private variants to sealed held-out pack entries after the private materials are authored and hash-locked.
- Collect baseline, cheap-model, repeated-attempt, and reward-shortcut evidence before claiming benchmark readiness for any public pilot family.
