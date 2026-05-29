=== Site Tools – Site Summary ===
Contributors: sitetools
Tags: abilities-api, automation, site-tools
Requires at least: 6.4
Tested up to: 6.6
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Registers a discoverable "site-tools/site-summary" ability via the WordPress Abilities API that returns the site name and published post count.

== Description ==

This tiny plugin wires a single callable ability into the WordPress Abilities API so external automation tools can discover and execute it:

* **Category:** `site-tools` (registered on `wp_abilities_api_categories_init`)
* **Ability:** `site-tools/site-summary` (registered on `wp_abilities_api_init`)
* **Returns:** `{ "site_name": string, "published_posts": integer }`

The plugin is self-contained, has no dependencies beyond the Abilities API, and is safe to activate on a fresh WordPress site — if the Abilities API is unavailable, the hooks simply no-op.

== Changelog ==

= 1.0.0 =
* Initial release.
