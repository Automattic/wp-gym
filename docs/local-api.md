# Local WPGym API

Issue: [#79](https://github.com/Automattic/wp-gym/issues/79)

`wp-gym` exposes a small Gym-like JavaScript API for local experiments against the
same scenario manifests, action schemas, observation schemas, and hidden graders
used by CI runners.

```js
import { WPGym } from './src/index.js';

const env = await WPGym.make('block-markup-no-fallback-pricing-section');
const obs = await env.reset();
const result = await env.step({
  type: 'wp_cli',
  command: "post create --post_type=page --post_title='Simple Pricing Page' --post_content='<blocks>'",
});
const grade = await env.grade();
const trace = await env.trace();
await env.close();
```

## Contract

- `WPGym.make(scenarioId, options)` loads one scenario manifest from `scenarios/`.
- `env.reset()` creates an isolated local episode and returns an observation.
- `env.step(action)` validates the action against `schemas/action.v1.schema.json`,
  applies it through the local adapter, and returns a canonical step result.
- `env.grade()` runs the scenario's hidden PHP grader against the current episode
  state and returns the grader's `success`, `reward`, `grade.checks`, and
  `failure_reasons` envelope. Scenarios that declare zero-weight behavioral
  fingerprint probes also receive probe output under
  `telemetry.behavioral_fingerprints`.
- `env.trace()` returns a canonical replay trace using `schemas/trace.v1.schema.json`.
- `env.close()` removes temporary episode files.

The local adapter is intentionally thin. It currently supports:

- `wp_cli` actions for WordPress scenarios by replaying them through WP Codebox
  recipes against a disposable WordPress runtime.
- `filesystem` actions inside scenario `environment.writable_roots` for workspace
  scenarios.

`env.runtimePlan()` exports a generic `wp-gym/runtime-plan/v1` record for replay
and debugging. Normal local execution uses WP Codebox's native runtime episode
API directly; CI orchestration can call the same `wp-gym` API or CLI without
becoming part of the library contract.

## Demo Command

Run one existing scenario locally from `reset()` through `step()` to `grade()`:

```sh
node bin/wp-gym.mjs demo block-markup-no-fallback-pricing-section
```

The command prints the reset observation, step result, hidden grade, and replay
trace as JSON.
