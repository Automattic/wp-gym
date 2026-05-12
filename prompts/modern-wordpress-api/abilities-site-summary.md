# Add A Site Summary Automation Hook

I’m wiring a WordPress site into an automation tool and need a tiny plugin that
exposes a callable site summary action named `site-tools/site-summary`.

Please add the plugin files to the provided project so the plugin can be
activated on a fresh WordPress site.

The plugin should be self-contained and safe to activate on a fresh site. The
automation action should be easy to discover under a `site-tools` grouping and
should return a compact summary with the current site name and the number of
published posts.

The target runtime includes the WordPress Abilities API. Register the ability
category during `wp_abilities_api_categories_init`, and register the callable
ability during `wp_abilities_api_init`, so other tools can discover and execute
it reliably after WordPress finishes loading.
