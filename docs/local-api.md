# Local WPGym API

Issues: [#79](https://github.com/Automattic/wp-gym/issues/79),
[#162](https://github.com/Automattic/wp-gym/issues/162),
[#201](https://github.com/Automattic/wp-gym/issues/201),
[#241](https://github.com/Automattic/wp-gym/issues/241)

`wp-gym` exposes a small Gym-like JavaScript API for local experiments against the
same scenario manifests, action schemas, observation schemas, and hidden graders
used by CI runners.

## Discovery

External runners should discover tasks before constructing an environment:

```js
import { WPGym } from './src/index.js';

const scenarios = await WPGym.listScenarios();
const taskSets = await WPGym.listTaskSets();
const scenario = await WPGym.describeScenario('block-markup-no-fallback-pricing-section');
const capabilities = await WPGym.capabilities('block-markup-no-fallback-pricing-section');
const api = WPGym.api();
```

The same discovery surface is available from the CLI:

```sh
node bin/wp-gym.mjs list scenarios
node bin/wp-gym.mjs list task-sets
node bin/wp-gym.mjs show scenario block-markup-no-fallback-pricing-section
node bin/wp-gym.mjs capabilities block-markup-no-fallback-pricing-section
```

Discovery output includes scenario ids, task-set ids, split metadata,
environment mode, allowed action types, replayability, observation types, and the
schema files a runner should validate against.

```js
import { WPGym } from './src/index.js';

const env = await WPGym.make('block-markup-no-fallback-pricing-section');
const obs = await env.reset({ seed: 1234 });
const result = await env.step({
  type: 'wp_cli',
  command: "post create --post_type=page --post_title='Simple Pricing Page' --post_content='<blocks>'",
});
const grade = await env.grade();
const trace = await env.trace();
await env.close();
```

## Contract

- `WPGym.listScenarios(options)` returns public scenario summaries from
  `scenarios/`.
- `WPGym.api()` returns the public API version, methods, action families,
  contracts, schema paths, and versioning policy for external labs.
- `WPGym.apiVersion()` returns the current public API version string.
- `WPGym.listTaskSets(options)` returns task-set summaries from `task-sets/`.
- `WPGym.describeScenario(scenarioId, options)` returns a single scenario's
  public runner metadata, including prompt/grader file references and
  capabilities.
- `WPGym.describeTaskSet(taskSetId, options)` returns one task set and its task
  entries.
- `WPGym.capabilities(scenarioId, options)` returns allowed action types,
  replayable action types, evidence-only action types, observation types, and
  schema file references.
- `WPGym.make(scenarioId, options)` loads one scenario manifest from `scenarios/`.
- `env.reset(options)` creates an isolated local episode and returns an
  observation. Pass `{ seed }` when a model loop needs deterministic reset
  metadata and a stable seeded `episode_id` for trace comparison.
- `env.step(action)` validates the action against `schemas/action.v1.schema.json`,
  applies it through the local adapter, and returns a canonical step result.
- `env.grade()` runs the scenario's hidden PHP grader against the current episode
  state and returns the grader's `success`, `reward`, `grade.checks`, and
  `failure_reasons` envelope. Scenarios that declare zero-weight behavioral
  fingerprint probes also receive probe output under
  `telemetry.behavioral_fingerprints`.
- `env.trace()` returns a canonical replay trace using `schemas/trace.v1.schema.json`.
- `env.close()` removes temporary episode files.

Seeded resets do not make every underlying WordPress/runtime behavior
deterministic yet, but they do provide a stable contract surface for RL loops:

```js
const first = await env.reset({ seed: 1234 });
const second = await env.reset({ seed: 1234 });

console.assert(first.state.episode_id === second.state.episode_id);
console.assert(first.state.reset_seed === '1234');

const trace = await env.trace();
console.assert(trace.metadata.reset_seed === '1234');
```

The local adapter is intentionally thin. It currently supports:

- `wp_cli` actions for WordPress scenarios by replaying them through WP Codebox
  recipes against a disposable WordPress runtime.
- `filesystem` actions inside scenario `environment.writable_roots` for workspace
  scenarios. Workspace-mode starter files are mounted into WP Codebox at
  `/workspace`, filesystem actions execute inside the Codebox runtime, and final
  changed-file and patch artifacts come from the Codebox artifact bundle.
- `rest` actions against the disposable WordPress runtime through WP Codebox HTTP
  response observation.
- `browser` `navigate`, `click`, `fill`, `press`, and `capture` actions through
  WP Codebox `wordpress.browser-actions`, including replay steps, HTML,
  screenshot, console, and network artifact references when requested.
- `editor` action envelopes as audit evidence only. Local execution rejects them
  until WP Codebox exposes a generic editor replay primitive.

Replay/regrade treats replayable browser `navigate`, `click`, `fill`, `press`,
and `capture` traces as deterministic candidates through the same Codebox browser
action path. Evidence-only browser traces and editor traces remain audit-only
unless the local deterministic replay path can reproduce the action and its
observation artifacts exactly.

A Python or Gymnasium wrapper is intentionally deferred. The supported external
surface for this slice is the Node API plus JSON CLI output; a Python wrapper can
be a thin consumer later once the JSON contract settles.

`env.runtimePlan()` exports a generic `wp-gym/runtime-plan/v1` record for replay
and debugging. Workspace scenarios include a model-visible `/workspace` mount
whose mode is derived from `environment.writable_roots`; hidden graders, prompts,
scenario manifests, checks, task sets, scripts, and docs remain outside that
starter workspace. Normal local execution uses WP Codebox's native runtime
episode API directly; CI orchestration can call the same `wp-gym` API or CLI
without becoming part of the library contract.

## Demo Command

Run one existing scenario locally from `reset()` through `step()` to `grade()`:

```sh
node bin/wp-gym.mjs demo block-markup-no-fallback-pricing-section
```

The command prints the reset observation, step result, hidden grade, and replay
trace as JSON.

The same no-model flow is available as a small example:

```sh
node examples/no-model-episode.mjs block-markup-no-fallback-pricing-section
```

Additional runnable loop examples are available for external labs:

```sh
node examples/scripted-loop.mjs block-markup-no-fallback-pricing-section
node examples/model-agent-loop.mjs block-markup-no-fallback-pricing-section
```

See `docs/external-rl-api.md` for the lab-facing API contract, action-family
summary, package schema exports, and versioning policy.
