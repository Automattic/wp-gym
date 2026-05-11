# wp-rl
Playground-backed WordPress task scenarios

## Gutenberg Block-Markup Tasks

The first task scenarios live in `scenarios/block-markup/`. Each manifest points to a
user request in `prompts/block-markup/` and a Playground PHP checker.

The task harness inspects final WordPress state, not transcript claims. An agent
should create or update the page title named in the prompt. The checker then
finds that page and parses `post_content` with WordPress block APIs.

Run the local manifest/PHP syntax check with:

```sh
node scripts/validate-scenarios.mjs
```
