# wp-rl
Playground-backed WordPress RL and model evaluation scenarios

## Gutenberg Block-Markup Scenarios

The first scenarios live in `scenarios/block-markup/`. Each manifest points to a
model prompt in `prompts/block-markup/` and a Playground PHP grader in
`graders/block-markup/`.

The scenarios grade final WordPress state, not transcript claims. A model should
create or update the page title named in the prompt. The grader then finds that
page, parses `post_content` with WordPress block APIs, and returns the normalized
Homeboy reward payload:

```json
{
  "success": true,
  "reward": 1,
  "done": true,
  "grade": {
    "score": 1,
    "max_score": 1,
    "checks": []
  }
}
```

Run the local manifest/PHP syntax smoke check with:

```sh
node scripts/validate-scenarios.mjs
```
