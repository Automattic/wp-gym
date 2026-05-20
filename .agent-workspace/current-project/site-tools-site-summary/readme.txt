=== Site Tools – Site Summary ===
Contributors: sitetools
Tags: abilities-api, automation, site-summary
Requires at least: 6.4
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Exposes a callable `site-tools/site-summary` ability via the WordPress Abilities API.

== Description ==

This tiny plugin registers a single ability — `site-tools/site-summary` — under a
`site-tools` category. When executed, it returns a compact summary describing
the current site:

* `site_name` — the value of the `blogname` option.
* `published_posts` — the number of posts in the `publish` status for the
  default `post` post type.

The plugin is self-contained, has no settings, and is safe to activate on a
fresh WordPress install. It performs registration on the Abilities API
lifecycle hooks (`wp_abilities_api_categories_init` and `wp_abilities_api_init`)
so other tools can discover and invoke the ability reliably once WordPress has
finished loading.

== Usage ==

After activation, the ability is available to any code that talks to the
Abilities API, for example:

`$result = wp_get_ability( 'site-tools/site-summary' )->execute();`

The returned array shape is:

`array(
    'site_name'       => 'My Site',
    'published_posts' => 12,
);`

== Changelog ==

= 0.1.0 =
* Initial release: register `site-tools` category and `site-tools/site-summary` ability.
