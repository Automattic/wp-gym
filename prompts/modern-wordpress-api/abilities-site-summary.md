# Create A Site Summary Ability

Create and activate a small WordPress plugin that exposes site summary data
through the WordPress Abilities API.

Requirements:

- Register the ability category `site-tools` on `wp_abilities_api_categories_init`.
- Register the ability `site-tools/site-summary` on `wp_abilities_api_init`.
- Use `permission_callback`, `input_schema`, `output_schema`, and
  `execute_callback` in the ability definition.
- The execute callback returns an array with `site_name` and `post_count` keys.
- `site_name` must match `get_bloginfo( 'name' )`.
- `post_count` must be the number of published posts returned by
  `wp_count_posts( 'post' )->publish`.
- Keep the plugin self-contained and safe to run on a temporary WordPress site.
