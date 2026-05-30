# WordPress API Curriculum Loop

Issue: [#152](https://github.com/Automattic/wp-gym/issues/152)

`wp-gym` should keep teaching and measuring current WordPress API practice. The
API curriculum loop turns source changes into reviewed scenario candidates,
keeps generated ideas out of benchmark-ready task sets, and makes stale coverage
visible before model scores rely on outdated API assumptions.

## Source Inputs

Review these sources when refreshing the API curriculum:

| Source lane | Examples | Refresh signal |
| --- | --- | --- |
| WordPress Core | REST API, Script Modules, Interactivity API, Abilities API, hooks, metadata APIs. | Trunk changes, dev notes, release field guide, new or changed public functions/classes/hooks. |
| Gutenberg | Block editor packages, block registration, data stores, Interactivity API usage, editor UI patterns. | Package/API changes, merged feature work, deprecations, docs updates. |
| WP-CLI | Command authoring, structured output, operational commands. | New commands, changed synopsis, command cookbook changes. |
| Developer docs | Code reference, block editor handbook, plugin/theme handbooks. | New pages, revised examples, deprecated recommendations. |
| Canonical plugins | WooCommerce, Jetpack, AI Client/provider plugins, Playground-facing plugins. | Public extension APIs, hooks, REST/CLI surfaces, deprecations. |
| Modern API repositories | `php-ai-client`, AI providers, Abilities API examples, Script Modules examples. | New package releases, changed contracts, new recommended integration patterns. |

## Capability Mapping

Map every scenario to the global taxonomy in
[`docs/capability-taxonomy.md`](capability-taxonomy.md). API curriculum
candidates also mirror their primary area in `api_provenance.capability_area` so
source freshness can be reported separately:

| Capability area | Use for |
| --- | --- |
| `ai_features` | AI Client/provider abstractions, prompt-backed plugin features, model/provider configuration. |
| `agent_tooling_automation_surfaces` | Abilities API tools, bounded automation actions, schemas, permission callbacks. |
| `custom_admin_ui` | Settings screens, dashboards, editor/admin data flows. |
| `data_interaction_apis` | REST endpoints, settings persistence, machine-readable status data. |
| `cli_operational_tooling` | WP-CLI commands and structured operational surfaces. |
| `theme_site_building` | Block themes, `theme.json`, templates, patterns, navigation. |
| `gutenberg_blocks` | Block metadata, render callbacks, valid editable block markup, editor packages. |
| `plugin_quality_wordpress_standards` | Hooks, escaping, sanitization, capabilities, Plugin Check-style hygiene. |

The current public corpus includes at least one source-backed scenario for every
global capability area. `modern-wordpress-api-ai-provider-status` covers the
`ai_features` lane as a public pilot and only publishes a planned held-out/private
variant reference; provider fixtures, prompts, grader thresholds, and replay
artifacts stay in the private held-out pack.

## API Scenario Metadata

All scenarios declare `capabilities`; API scenarios additionally record source
provenance and freshness in `api_provenance`:

```json
{
  "api_provenance": {
    "capability_area": "agent_tooling_automation_surfaces",
    "api_surface": "WordPress Abilities API",
    "source_inputs": [
      {
        "id": "wordpress-core-abilities-api",
        "type": "wordpress_core_source",
        "url": "https://github.com/WordPress/wordpress-develop/blob/trunk/src/wp-includes/abilities-api.php",
        "ref": "trunk",
        "checked_at": "2026-05-28",
        "evidence": "Registration lifecycle and registry functions used by the hidden grader."
      }
    ],
    "freshness": {
      "status": "fresh",
      "last_reviewed": "2026-05-28",
      "next_review_due": "2026-06-27",
      "cadence_days": 30
    },
    "curriculum": {
      "lifecycle_status": "pilot",
      "candidate_from_source_change": "Why this source/API belongs in the curriculum.",
      "promotion_next_step": "The next calibration, fixture, or review gate."
    }
  }
}
```

`npm run validate` requires `api_provenance` for scenarios tagged `modern-api`.
Other families may add the metadata as their API assumptions become source-backed.

## Update Loop

1. **Detect source movement.** Review the source lanes above on the scenario's
   cadence, during WordPress release milestones, or when a public API changes.
2. **Map the capability.** Choose one primary `capability_area` and record the
   source input URLs, refs, checked date, and concrete evidence.
3. **Draft a candidate scenario.** Write a natural prompt, hidden grader plan,
   expected artifacts, known shortcuts, replay contract level, and calibration
   blockers. Keep generated/proposed candidates outside benchmark task sets.
4. **Review the grader.** Add source-backed hidden checks and failure reasons,
   then add positive and adversarial fixtures for known shortcuts where possible.
5. **Pilot first.** Add the scenario only to pilot/demo task sets while
   `calibration.status` remains `pilot` or `calibrating`.
6. **Calibrate.** Collect no-op, scripted, cheap-model, frontier-model,
   repeated-attempt, and human/reference rows. Record result-set IDs and pass-rate
   metadata in `calibration`.
7. **Promote or retire.** Promote only after benchmark gates pass. Mark stale or
   retired coverage when source recommendations change faster than the grader can
   be updated.

## Freshness Reporting

Run the report before refreshing a task set or starting a calibration run:

```sh
npm run curriculum:report
node scripts/report-api-curriculum-freshness.mjs --json
```

The report groups API scenarios by capability area, shows stale or due-soon
review dates, lists `modern-api` scenarios missing provenance, and highlights
capability areas with no API provenance coverage yet.

Use these statuses consistently:

| Status | Meaning |
| --- | --- |
| `fresh` | Source inputs were reviewed within cadence and still match the grader. |
| `watch` | Source inputs are current, but active upstream work may change the grader. |
| `stale` | The review date has passed or source assumptions are known to be outdated. |
| `retired` | The API surface should no longer drive active benchmark coverage. |

## Example: Abilities API Candidate

The current `modern-wordpress-api-abilities-site-summary` pilot demonstrates the
loop:

| Loop step | Scenario state |
| --- | --- |
| Source input | WordPress Core `wp-includes/abilities-api.php` and `class-wp-ability.php` on `trunk`. |
| Capability area | `agent_tooling_automation_surfaces`. |
| Candidate prompt | Ask for a provider-friendly site summary ability. |
| Hidden grader | Check lifecycle hooks, category registration, ability registration, exact output shape, and supported plugin metadata. |
| Freshness | Reviewed 2026-05-28, due again 2026-06-27. |
| Lifecycle | `pilot`, blocked by missing baseline results, uncalibrated difficulty, and workspace diagnostic contract level. |
| Next step | Collect baseline rows and expand shortcut fixtures before moving to `calibrating`. |

This example keeps a current API in the curriculum while preserving the benchmark
gate: source-backed pilot coverage is useful evidence, but it does not become a
headline benchmark row until calibration and replay gates pass.
