=== Site Tools - Site Summary ===
Contributors: sitetools
Tags: abilities, automation, site-summary
Requires at least: 6.5
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Exposes a callable "site-tools/site-summary" ability that returns a compact
summary of the current WordPress site for automation tools.

== Description ==

This is a tiny, self-contained plugin that registers a single ability with
the WordPress Abilities API under the `site-tools` grouping:

* `site-tools/site-summary` — returns an object with:
  * `name` — the current site name (blogname).
  * `published_posts` — the number of posts in the `publish` status.

It has no admin UI, adds no database tables, and is safe to activate on a
fresh WordPress site.

== Usage ==

After activation, automation tools that speak the WordPress Abilities API
can discover and call the ability by its id:

    $result = wp_get_ability( 'site-tools/site-summary' )->execute();

The returned array looks like:

    array(
        'name'            => 'My Site',
        'published_posts' => 12,
    );
