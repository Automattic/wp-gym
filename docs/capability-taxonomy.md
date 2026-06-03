# WordPress Capability Taxonomy

Issues: [#15](https://github.com/Automattic/wp-gym/issues/15)

`wp-gym` scenarios use a small global capability contract so task sets and run
reports can explain what WordPress behavior they measure without exposing hidden
grader rubrics.

## Scenario Contract

Every scenario manifest declares one primary capability and optional secondary
capabilities:

```json
{
  "capabilities": {
    "schema_version": 1,
    "primary": "gutenberg_blocks",
    "secondary": ["theme_site_building"],
    "criteria": ["parseable_block_markup", "editable_core_blocks"]
  }
}
```

- `primary` is the capability the task is mainly intended to measure.
- `secondary` records meaningful supporting capabilities, not every incidental API touched.
- `criteria` names visible measurement themes; hidden grader thresholds stay in graders.

## Capability Areas

| Capability | Measures |
| --- | --- |
| `ai_features` | WordPress AI Client/provider usage, model/provider configuration, graceful provider failures. |
| `agent_tooling_automation_surfaces` | Abilities API tools, bounded automation actions, schemas, permission callbacks. |
| `custom_admin_ui` | Settings/admin/editor UI patterns and WordPress-backed data flows. |
| `data_interaction_apis` | REST, settings, metadata, taxonomy, content, and machine-readable site APIs. |
| `cli_operational_tooling` | WP-CLI and scriptable operational surfaces. |
| `theme_site_building` | Block themes, `theme.json`, templates, template parts, patterns, navigation. |
| `gutenberg_blocks` | Block metadata, render callbacks, valid editable block markup, editor packages. |
| `plugin_quality_wordpress_standards` | Hooks, escaping, sanitization, capabilities, i18n, Plugin Check-style hygiene. |

## Task Set Coverage

Task sets declare `capability_coverage` as a derived summary of their scenario
manifests. `npm run validate` checks that the task-set primary and secondary
coverage exactly matches the scenarios it includes.

```json
{
  "capability_coverage": {
    "schema_version": 1,
    "primary": ["agent_tooling_automation_surfaces", "gutenberg_blocks"],
    "secondary": ["plugin_quality_wordpress_standards", "theme_site_building"]
  }
}
```

## Reporting

Use the curriculum report to inspect repo-wide coverage:

```sh
npm run curriculum:report
node scripts/report-api-curriculum-freshness.mjs --json
```

The report includes `global_capability_coverage`, plus API-curriculum freshness
for scenarios that also declare `api_provenance`.

Use the corpus coverage report for the broader issue #242 area map and public-safe
held-out/private status:

```sh
npm run corpus:coverage
node scripts/report-corpus-coverage.mjs --json
```

That report maps requested coverage areas such as media, permissions/security,
performance, and AI/tooling surfaces onto scenario metadata without exposing
private held-out contents.
