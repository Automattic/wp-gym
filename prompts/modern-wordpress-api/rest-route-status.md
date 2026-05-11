# Add A Site Status Endpoint

I need a small self-contained WordPress plugin that adds a public read-only site
status endpoint at `/wp-json/site-tools/v1/status`.

This is for a simple uptime/dashboard integration, so the endpoint should be safe
for public read-only access and return a compact status payload with whether the
site is OK, the current site name, and the number of published posts.
