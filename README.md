# WordPress Practice Tasks

This repository contains small WordPress implementation requests for disposable
Playground sites.

Current coverage includes:

- Natural site-building requests with hidden WordPress-native quality criteria.
- Realistic page-building requests that a site owner might ask for.
- Developer requests for small plugins that expose WordPress data to other tools.
- A smoke task that keeps the Playground automation wired up.

Prompts are written as ordinary user or developer requests. WordPress quality
criteria live in task metadata and PHP checks, so review happens against final
WordPress state instead of chat transcripts.

Use `npm run validate` for the local manifest and PHP syntax check.

The smoke workflow in `.github/workflows/playground-smoke.yml` exercises the
Playground path and uploads the artifacts emitted by Homeboy Extensions for
maintainers.
