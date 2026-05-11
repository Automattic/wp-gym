# Add A Site Status Endpoint

I need a small self-contained WordPress plugin that adds a public read-only site
status endpoint at `/wp-json/site-tools/v1/status`.

The endpoint should return:

- `ok`, confirming the site is reachable.
- `site_name`, with the current site name.
- `post_count`, with the number of published posts.

Please keep the plugin self-contained and safe to run on a temporary WordPress
site.
