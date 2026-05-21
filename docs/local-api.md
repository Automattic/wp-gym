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
  `failure_reasons` envelope.
- `env.trace()` returns a canonical replay trace using `schemas/trace.v1.schema.json`.
- `env.close()` removes temporary episode files.

The local adapter is intentionally thin. It currently supports:

- `wp_cli` actions for local in-memory post state, enough to run block-markup
  scenarios from reset through grade.
- `filesystem` actions inside scenario `environment.writable_roots` for workspace
  scenarios.

Sandbox Runtime, Homeboy Extensions, and CI remain the full WordPress execution
substrate. The local API is the stable contract for experiments and future RL
loops; reusable orchestration still belongs in the runner layer.

## Demo Command

Run one existing scenario locally from `reset()` through `step()` to `grade()`:

```sh
node bin/wp-gym.mjs demo block-markup-no-fallback-pricing-section
```

The command prints the reset observation, step result, hidden grade, and replay
trace as JSON.
