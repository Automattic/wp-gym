# Add A Site Summary Automation Hook

I’m wiring a WordPress site into an automation tool and need a tiny plugin that
exposes a callable site summary action named `site-tools/site-summary`.

The summary should include:

- The current site name.
- The number of published posts.
- A sensible `site-tools` grouping so the action is easy to find later.

Please keep the plugin self-contained and safe to run on a temporary WordPress
site.
