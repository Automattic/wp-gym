# Block Markup Grader Audit Packet

Issue: [#75](https://github.com/Automattic/wp-gym/issues/75)

This packet covers the current `graders/block-markup/*` family. These graders are
demo/pilot diagnostics until every listed shortcut has executable negative
coverage, baseline result sets, and a replay-grade runner contract.

## WordPress Evidence

- `has_blocks()` is the first gate for editable Gutenberg block comments rather
  than rendered HTML.
- `parse_blocks()` is the source of truth for nested block structure and block
  names.
- `core/html` and freeform blocks are treated as fallback markup, not acceptable
  editable structure.
- Shortcode-like markup is rejected because it can satisfy rendered output while
  hiding the implementation outside editable block structure.

Useful source checks:

```bash
grep -R "function has_blocks" wp-includes
grep -R "function parse_blocks" wp-includes
grep -R "core/html" wp-includes wp-content/plugins wp-content/themes
grep -R "function do_shortcode" wp-includes
```

## Fixtures

Run all executable calibration fixtures with:

```bash
npm run reward-fixtures:validate
```

| Scenario | Positive fixture | Negative fixture | Shortcut covered | Expected failure reason |
| --- | --- | --- | --- | --- |
| `block-markup-no-fallback-pricing-section` | `no-fallback-pricing-meaningful-content` | `no-fallback-pricing-empty-skeleton` | `empty_block_skeleton` | `missing_required_plan_content` |
| `block-markup-no-fallback-pricing-section` | `no-fallback-pricing-meaningful-content` | `no-fallback-pricing-keyword-block-stuffing` | `keyword_and_block_count_stuffing` | `missing_required_plan_content` |
| `block-markup-valid-semantic-blocks` | `valid-semantic-blocks-meaningful-content` | `valid-semantic-blocks-keyword-stuffing` | `keyword_stuffing` | `missing_block_markup`, `missing_required_blocks` |
| `block-markup-nested-layout-blocks` | `nested-layout-blocks-meaningful-content` | `nested-layout-blocks-block-count-stuffing` | `block_count_stuffing` | `layout_structure_mismatch` |

## Remaining Reward-Hacking Risks

- `block-markup-valid-semantic-blocks` still has an unresolved
  `shallow_block_validity` shortcut. The grader checks required block types and
  heading text, but does not verify meaningful list/button content.
- `block-markup-nested-layout-blocks` still has an unresolved
  `shallow_required_text` shortcut. The grader verifies `group > columns > column`
  structure with heading and paragraph blocks, but not the semantic quality of the
  text inside those blocks.
- The fixture runner uses a small local `parse_blocks()` approximation for fast
  calibration. Before benchmark eligibility, replay the same fixtures against a
  real WordPress runtime to prove parity with core `parse_blocks()` and
  `has_blocks()` behavior.
- Scenario metadata still marks these tasks as `demo`, `uncalibrated`, and not
  headline-score eligible. That should remain true until baseline result sets and
  all shortcut fixtures pass in CI.
