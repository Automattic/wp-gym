# Add An AI Provider Status Endpoint

I need a small self-contained WordPress plugin that reports whether the site has a
WordPress AI provider integration available.

Please add the plugin files to the provided project so the plugin can be activated
on a fresh WordPress site. The plugin should register a public read-only REST
endpoint at `/wp-json/site-ai/v1/provider-status`.

The endpoint is for an operations dashboard. It should gracefully handle a normal
WordPress site where the AI Client or provider plugins are not installed, without
fatal errors or external network calls. Return a compact payload that identifies
whether AI integration appears available, whether it appears configured, the
provider name when one can be detected, and which detection mode was used.
