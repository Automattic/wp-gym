# Create A Site Status REST Endpoint

Create and activate a small WordPress plugin that exposes a public read-only REST
API endpoint for site status.

Requirements:

- Register a `GET` route at namespace `site-tools/v1` and route `/status` on
  `rest_api_init`.
- Include an explicit `permission_callback` that allows public read access.
- The route callback returns a `WP_REST_Response` or response-compatible array.
- The response data includes `ok`, `site_name`, and `post_count` keys.
- `ok` must be `true`.
- `site_name` must match `get_bloginfo( 'name' )`.
- `post_count` must be the number of published posts returned by
  `wp_count_posts( 'post' )->publish`.
- Keep the plugin self-contained and safe to run on a temporary WordPress site.
