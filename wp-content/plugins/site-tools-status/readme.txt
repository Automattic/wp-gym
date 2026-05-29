=== Site Tools Status ===
Contributors: sitetools
Tags: rest-api, status, uptime, monitoring
Requires at least: 5.5
Tested up to: 6.5
Requires PHP: 7.2
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Adds a public, read-only site status endpoint for uptime checks and dashboards.

== Description ==

Site Tools Status registers a single REST route:

* `GET /wp-json/site-tools/v1/status`

The endpoint requires no authentication and returns a compact JSON payload:

`
{
  "ok": true,
  "site_name": "Example Site",
  "published_posts": 42
}
`

Only non-sensitive information already visible to public visitors is exposed,
which makes it safe to poll from external uptime services and lightweight
admin dashboards.

== Installation ==

1. Upload the `site-tools-status` directory to `/wp-content/plugins/`.
2. Activate the plugin through the **Plugins** screen in WordPress.
3. Hit `/wp-json/site-tools/v1/status` to verify it returns a JSON payload.

== Changelog ==

= 1.0.0 =
* Initial release: public `site-tools/v1/status` endpoint.
