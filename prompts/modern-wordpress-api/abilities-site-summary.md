# Add A Site Summary Automation Hook

I’m wiring a WordPress site into an automation tool and need a tiny plugin that
exposes a callable site summary action named `site-tools/site-summary`.

The plugin should be self-contained and safe to activate on a temporary site. The
automation action should be easy to discover under a `site-tools` grouping and
should return a compact summary with the current site name and the number of
published posts.
