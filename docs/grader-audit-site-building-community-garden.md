# Site-Building Community Garden Grader Audit

Issues: [#75](https://github.com/Automattic/wp-gym/issues/75), [#70](https://github.com/Automattic/wp-gym/issues/70), [#67](https://github.com/Automattic/wp-gym/issues/67), [#66](https://github.com/Automattic/wp-gym/issues/66)

Scenario: `site-building-community-garden`

Grader: `graders/site-building/community-garden.php`

## Reward Contract

The reward checks final WordPress state, not visual taste. Reward-bearing checks are:

- The active theme is a block theme via `wp_is_block_theme()`.
- The active stylesheet directory contains `theme.json`.
- A static homepage is set with `page_on_front` and resolves to a `WP_Post`.
- Required garden topics appear in page/post content.
- Required action areas appear as editable heading/button sections, not only as loose keywords.
- Parsed block names are registered with `WP_Block_Type_Registry`.
- The submission avoids fallback blocks, `core/html`, and shortcode-like markup.
- Navigation exists through a primary menu or `wp_navigation` post.
- At least one template part exists through `wp_template_part` content.

Style and design probes are telemetry only. The scenario's `design_style_fingerprint` probe has `reward_weight: 0` and must remain outside `success`, `reward`, and `failure_reasons` until a separate benchmark policy explicitly promotes a visual criterion.

## WordPress Surfaces

The grader is intentionally state-based and should be checked against these WordPress APIs/subsystems:

- `wp_is_block_theme()` for block-theme detection.
- `theme.json` discovery through the active stylesheet directory.
- `get_option( 'page_on_front' )` and `get_post()` for static homepage state.
- `get_posts()` over `page`, `post`, `wp_template_part`, and `wp_navigation` content.
- `parse_blocks()` and `WP_Block_Type_Registry::get_instance()->is_registered()` for editable block structure.
- `has_nav_menu( 'primary' )` and `wp_navigation` posts for navigation state.

Useful source inspection commands:

- `grep -R "function wp_is_block_theme" wp-includes wp-admin`
- `grep -R "class WP_Block_Type_Registry" wp-includes`
- `grep -R "function parse_blocks" wp-includes`
- `grep -R "page_on_front" wp-includes wp-admin`

## Calibration Fixtures

Fixtures live under `fixtures/reward-hacking/site-building/` and run through `npm run reward-fixtures:validate`.

| Fixture | Type | Expected | Shortcut covered |
| --- | --- | --- | --- |
| `site-building-community-garden-positive-control` | Positive control | Pass | N/A |
| `site-building-community-garden-topic-keyword-stuffing` | Adversarial negative | Fail with `missing_required_content` | `topic_keyword_stuffing` |
| `site-building-community-garden-minimal-page-shell` | Adversarial negative | Fail with `missing_navigation` and `missing_template_part` | `minimal_page_shell` |
| `site-building-community-garden-raw-html-shortcut` | Adversarial negative | Fail with `raw_html_or_fallback_block` and `missing_required_content` | `raw_html_shortcut` |

## Known Limitations

- The fixture harness is a lightweight PHP shim, not a full WordPress runtime. It is useful for reward-shape regression tests, but final promotion still needs live WordPress replay evidence.
- The grader checks for editable content sections using heading/button block text. This catches cheap keyword stuffing, but it does not prove that the rendered page is visually good.
- The grader does not score typography, palette, layout novelty, or motif diversity. Those belong in behavioral telemetry until issue #67 defines a non-reward fingerprint artifact.
- The grader can still over-reward a plain but structurally valid page. That is acceptable for the current `wordpress_state_diagnostic` contract and should remain a benchmark blocker until baseline runs calibrate difficulty.
