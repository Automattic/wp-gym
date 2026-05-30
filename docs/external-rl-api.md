# External RL API

Issue: [#241](https://github.com/Automattic/wp-gym/issues/241)

`wp-gym` exposes a small JavaScript environment API for lab training and eval
loops. The public loop surface is intentionally separate from benchmark
promotion, run registry, GitHub Actions matrices, and reporting internals.

## Install And Import

Install from the repository and import the package entrypoint:

```sh
npm install github:Automattic/wp-gym
```

```js
import { WPGym } from 'wp-gym';
```

When working from a checkout, use the same API through `./src/index.js`:

```js
import { WPGym } from './src/index.js';
```

## Discover The API

```sh
wp-gym api
wp-gym list scenarios
wp-gym list task-sets
wp-gym capabilities block-markup-no-fallback-pricing-section
```

```js
const api = WPGym.api();
const scenarios = await WPGym.listScenarios();
const capabilities = await WPGym.capabilities('block-markup-no-fallback-pricing-section');
```

`WPGym.api()` returns the current API version, method list, supported action
families, schema paths, and versioning policy.

## Loop Contract

```js
const env = await WPGym.make('block-markup-no-fallback-pricing-section');

try {
  const resetObservation = await env.reset({ seed: 'lab-run-1' });
  const stepResult = await env.step({
    type: 'rest',
    method: 'GET',
    path: '/wp-json/',
  });
  const terminalGrade = await env.grade();
  const trace = await env.trace();
} finally {
  await env.close();
}
```

- `reset(options)` returns an `observation.v1` record with scenario state,
  episode id, reset seed, and workspace root.
- `step(action)` accepts one `action.v1` record and returns one
  `step-result.v1` record.
- `grade()` returns the terminal hidden grader result with `success`, `reward`,
  `checks`, `failure_reasons`, and telemetry.
- `trace()` returns a `trace.v1` replay record for the accepted steps.

## Action Families

- `filesystem`: read, write, list, and delete files inside declared writable
  roots for workspace scenarios.
- `wp_cli`: run WP-CLI commands without the leading `wp` in disposable
  WordPress episodes.
- `rest`: send sandbox-relative REST requests and observe status, headers, and
  body.
- `browser`: capture replayable browser evidence locally. Richer `click`,
  `fill`, and `press` traces are represented by the schema, but local replay is
  evidence-only until the runtime exposes a generic interaction primitive.
- Mixed episodes: scenarios may allow multiple action families in one episode.

## Schemas

Canonical contracts live in `schemas/` and are exported as package subpaths:

- `wp-gym/schemas/action.v1.schema.json`
- `wp-gym/schemas/observation.v1.schema.json`
- `wp-gym/schemas/step-result.v1.schema.json`
- `wp-gym/schemas/trace.v1.schema.json`

## Runnable Examples

```sh
node examples/no-model-episode.mjs block-markup-no-fallback-pricing-section
node examples/scripted-loop.mjs block-markup-no-fallback-pricing-section
node examples/model-agent-loop.mjs block-markup-no-fallback-pricing-section
npm run external-consumer:test
```

The examples print reset observations, step results, terminal grades, and traces
as JSON so a lab can capture the same artifacts from a training loop.

`npm run external-consumer:test` is the external-lab proof path. It creates a
throwaway consumer project, installs `wp-gym` from the current checkout through a
package-manager dependency, imports only the public `wp-gym` entrypoint and schema
exports, runs CLI scenario and task-set discovery, executes `reset()` / `step()` /
`grade()` / `trace()`, and validates run-registry fixtures through the public
`wp-gym run-registry validate` command. Set
`WPGYM_KEEP_EXTERNAL_CONSUMER_TMP=1` to keep the temporary consumer directory for
inspection.

The proof uses `WPGym.make(scenarioId, { runtime: 'local' })` so the smoke stays
fast and deterministic while still validating the public action, observation,
grade, and trace contracts. Omit that option to run WordPress-backed scenarios
through the WP Codebox runtime.

## Versioning Policy

The current API version is `wp-gym/js-env/v1`.

Public v1 records remain additive-compatible within v1. Consumers should ignore
unknown telemetry and metadata keys. Breaking action, observation, step result,
trace, or method-shape changes require a new API version string and schema
filenames. Benchmark promotion and reporting internals are governed separately
and are not part of the training-loop API contract.
