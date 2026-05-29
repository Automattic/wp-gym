# Remote Archive Triage

Issue: [#166](https://github.com/Automattic/wp-gym/issues/166)

Remote loops can run on lab machines without GitHub write access. Those machines
own raw execution and reviewer archives; a trusted local checkout owns triage,
patch application, commits, pushes, and pull requests.

## Public Archive Boundary

The public `wp-gym` tooling treats remote sync as a local archive handoff:

```text
remote loop/lab
  writes runs/<cycle-id>/
  archives runs/<cycle-id>.tar.gz
        |
        | copied by operator-owned transport
        v
local trusted checkout
  stores .remote-artifacts/continuous/<cycle-id>.tar.gz
  runs wp-gym remote-archive triage
  applies selected patches locally
```

The repo does not prescribe SSH hosts, private keys, cloud buckets, or deployment
credentials. Labs can use `scp`, `rsync`, artifact downloads, object storage, or
any other approved transport as long as the local input is a cycle directory or
`.tar.gz` archive.

## Expected Cycle Layout

A cycle archive should preserve paths like:

```text
runs/<cycle-id>/
  validations/
    npm-test.rc
    reward-fixtures.rc
    benchmark-mode.status
  reviews/
    reports/<reviewer>.md
    reports/<reviewer>.rc
    reports/<reviewer>.status
    logs/<reviewer>.log
    patches/<reviewer>.patch
```

The triage command is intentionally tolerant. It recursively scans the archive
for validation `.rc` / `.status` files, reviewer reports, reviewer statuses, logs,
and patch files under `reviews/`.

## Triage Command

Run against a downloaded archive or extracted directory:

```bash
wp-gym remote-archive triage \
  --input .remote-artifacts/continuous/20260514T153555Z.tar.gz \
  --json reports/remote-archive-20260514T153555Z.json \
  --markdown reports/remote-archive-20260514T153555Z.md
```

The command reports:

- Validation status from `.rc` and `.status` files.
- Reviewer report completion and reviewer failures.
- Candidate patch counts, nonempty patch counts, duplicate patch groups, and coarse patch areas.
- Data quality gaps such as missing validation status, failed reviewer status, missing reports, empty patches, duplicate patches, and stale archives.
- JSON and Markdown outputs suitable for issue comments.

The command exits nonzero when any error-severity data quality gap is present.
Warnings such as duplicate candidate patches are included in the report while the
command still exits successfully.

## Local Triage Workflow

1. Download or copy remote archives into `.remote-artifacts/continuous/`.
2. Run `wp-gym remote-archive triage --input <archive> --json <file> --markdown <file>`.
3. Read duplicate groups first to avoid reviewing the same patch proposal multiple times.
4. Prioritize nonempty candidate patch areas with passing validation and complete reviewer reports.
5. Apply selected patches in the local trusted checkout, then run the relevant `npm` validation commands before pushing.

This keeps remote labs useful without turning them into trusted writers.
