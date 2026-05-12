=== Site Tools: Site Summary ===
Contributors: sitetools
Tags: abilities, automation, site-summary
Requires at least: 6.6
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Registers a `site-tools/site-summary` ability via the WordPress Abilities API.

== Description ==

This tiny plugin wires a single callable action into the WordPress Abilities
API so external automation tools can discover and execute it:

* Category: `site-tools`
* Ability:  `site-tools/site-summary`

The ability takes no input and returns an object:

    {
      "site_name":       "Example Blog",
      "published_posts": 12
    }

It is safe to activate on a fresh site; if the Abilities API is not present
the plugin simply does nothing.

== Changelog ==

= 0.1.0 =
* Initial release. Registers the `site-tools` category and the
  `site-tools/site-summary` ability.
