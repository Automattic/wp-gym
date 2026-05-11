# WordPress Practice Tasks

This repository contains small WordPress implementation requests for disposable
Playground sites.

The prompt files should read like normal requests from WordPress users or
developers. They describe the desired outcome, not the internal quality checks or
the exact implementation path.

Detailed WordPress expectations live outside the prompt files, in manifests and
PHP checkers. That keeps the request realistic while still letting automation
inspect the final WordPress state.

Current task areas include:

- Natural site-building requests with hidden WordPress-native quality criteria.
- Realistic page-building requests that a site owner might ask for.
- Developer requests for small plugins that expose WordPress data to other tools.
- A smoke task that keeps the Playground automation wired up.

Prompts are written as ordinary user or developer requests. WordPress quality
criteria, such as parseable content, fallback blocks, or required APIs, live in
task metadata and PHP checks, so review happens against final WordPress state
instead of chat transcripts.

Use `npm run validate` for the local manifest and PHP syntax check.

Stable task set manifests live in `task-sets/`. The first live side-by-side run
uses `task-sets/first-live-run.json`.

The smoke workflow in `.github/workflows/playground-smoke.yml` exercises the
Playground path and uploads the artifacts emitted by Homeboy Extensions for
maintainers.
