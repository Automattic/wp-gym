# Artifact Redaction And Sharing Policy

Issue: [#143](https://github.com/Automattic/wp-gym/issues/143)

`wp-gym` artifacts are evidence, not a data dump. Public benchmark reports should
contain enough information to understand and reproduce a result without exposing
secrets, cookies, nonces, private URLs, local paths, provider credentials, or user
data that is not part of the benchmark task.

## Sensitivity Classes

| Artifact class | Common sensitivity | Default sharing level |
| --- | --- | --- |
| Transcript/tool calls | Prompts, tool arguments, local paths, user content, provider metadata | `private_lab` |
| Screenshots | User-entered content, admin chrome, private URLs | `private_lab` |
| DOM/HTML snapshots | Nonces, private URLs, user emails, hidden form fields | `private_lab` |
| Logs/events | Cookies, auth headers, tokens, local paths, internal URLs | `private_lab` |
| REST responses | Nonces, emails, user IDs, private post data, auth state | `private_lab` |
| WordPress state snapshots | Posts, users, options, plugin settings, site URLs | `private_lab` |
| Filesystem diffs | Source changes and generated files; possible local paths or secrets | `public_report` after scan |
| Provider metadata | API keys, request headers, model/account IDs, token usage | `sealed_hash_only` |
| Replay bundles | Full traces plus artifacts needed to reproduce grading | `private_lab` |

Use these sharing levels in artifact references:

| Level | Meaning |
| --- | --- |
| `public_report` | Safe to link from public benchmark summaries and generated PRs. |
| `private_lab` | Share only with maintainers or lab systems that need replay/debugging access. |
| `local_only` | Keep on the runner host; do not upload or attach to PR/report output. |
| `sealed_hash_only` | Publish only hash, kind, and provenance metadata; keep raw bytes private. |

## Required Redactions

Before an artifact can be `public_report`, redact or replace these values:

- Secrets and provider credentials: API keys, OAuth tokens, PATs, private keys,
  webhook secrets, client secrets, and bearer/basic auth values.
- Cookies and auth headers: `Cookie`, `Set-Cookie`, `Authorization`, WordPress
  login cookies, and session identifiers.
- Nonces: `_wpnonce`, `wp_nonce`, `X-WP-Nonce`, REST nonce fields, and nonce query
  parameters.
- Local paths: absolute host paths such as `/Users/name/...`, `/home/name/...`, or
  Windows user paths.
- Internal URLs: `localhost`, loopback addresses, `.local`, `.test`, and
  `.internal` service URLs.
- User data: emails, profile fields, private post content, private media URLs, and
  account identifiers unless the scenario explicitly makes them public fixture
  content.

Use bracketed replacement values so validators and reviewers can distinguish
intentional redaction from missing data:

```json
{
  "authorization": "[REDACTED:authorization]",
  "cookie": "[REDACTED:cookie]",
  "x-wp-nonce": "[REDACTED:nonce]",
  "local_path": "[REDACTED:local_path]"
}
```

## Replay Rules

Redaction must preserve replay semantics:

- Redact values that are not needed to rerun the grader, such as auth headers in
  event logs, cookies in transcripts, local host paths, and display-only URLs.
- Keep replay-critical files local and hashable when benchmark mode needs to prove
  the row: result JSON, replay trace/bundle, event log, WordPress state, rendered
  site evidence, and scenario-declared expected artifacts.
- If raw bytes are needed for private debugging but unsafe for reports, publish a
  `sealed_hash_only` reference with `sha256` and keep the raw artifact in the lab
  store.
- Do not redact grader inputs in a way that changes terminal grader output. If a
  sensitive field affects grading, seal/hash the raw artifact and create a separate
  sanitized summary for reports.

## Artifact Reference Metadata

Artifact references may declare sensitivity and sharing metadata:

```json
{
  "kind": "jsonl",
  "path_or_url": "artifacts/events.jsonl",
  "sha256": "96a7abacc05eebad137e1adcc45c773f3d471c21aa695a5bf68e94b14c211300",
  "sensitivity": ["cookie", "nonce", "local_path"],
  "sharing_level": "public_report",
  "redaction_status": "redacted",
  "redaction": {
    "status": "redacted",
    "strategy": "field_redaction",
    "sharing_level": "public_report"
  }
}
```

Provider metadata and other raw sensitive artifacts should use a hash-only
reference:

```json
{
  "kind": "provider_metadata",
  "path_or_url": "sealed://provider-metadata/request-headers",
  "sha256": "1c11955749941291ade1145e7ccc0ade545b72cc6a9a6cfcc2273f6f6ee2986c",
  "sensitivity": ["provider_metadata", "credential"],
  "sharing_level": "sealed_hash_only",
  "redaction_status": "sealed_hash_only"
}
```

## Validation

Benchmark-mode artifact validation scans local referenced artifacts up to 2 MiB
for obvious sensitive markers: secret-like JSON keys, bearer/basic auth values,
provider keys, GitHub/Slack tokens, WordPress cookies, nonce query parameters,
absolute local paths, and local/internal URLs.

The scan is intentionally conservative. Passing validation means no obvious marker
was found; it does not replace code review for new artifact classes or runner
integrations.
