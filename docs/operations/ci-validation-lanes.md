# Validation lanes and advisory workspace impact

Five validation runners become two matrix lanes with fail-fast disabled. Full
validation still runs on PRs, main pushes and dispatch. The stable `check` requires
validate, every Vitest shard, every browser suite and PR dependency review.
CodeQL, security requirements and release behavior are unchanged.

| Previous owner          | New owner  | Preserved commands                                                                                                        |
| ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| style                   | static     | `pnpm format:check`                                                                                                       |
| lint                    | static     | `pnpm lint`, `pnpm check:navigation`                                                                                      |
| types                   | contracts  | `pnpm typecheck`, `pnpm typecheck:ts6`                                                                                    |
| audit                   | contracts  | workflow lint/pins, production audit, app and release exact-chain audits                                                  |
| audit                   | contracts  | `pnpm -C tools/release install --frozen-lockfile`, `node tools/release/check-compatibility.mjs`, `pnpm ci:test-discovery` |
| codegen                 | contracts  | `pnpm ci:codegen`                                                                                                         |
| every validation runner | both lanes | final `pnpm ci:clean-tree`                                                                                                |

Each independent step requires successful setup and `!cancelled()`, so an earlier
failure remains fatal while later checks report their own errors. Both unchanged
typechecks generate Next route types sequentially, followed by anonymous Convex
codegen in the same contracts lane. Codegen retains its private backend,
credential rejection and finally cleanup. Each lane checks the tree last,
including after failed checks. Exact policy and mutation tests enforce these
commands, ordering, execution conditions, artifact and aggregate behavior.

## Report only, always run

Contracts also runs `node scripts/ci/workspace-impact.mjs`. No new runner or
prerequisite is added. The JSON artifact `workspace-impact-report` and job summary
record base/head, complete changed paths and reasons, predicted affected status,
effective workspace execution (always true), analysis duration and dependency
evidence. No job outputs, selection variable, live skip path or aggregate skip
allowance exists. A prediction of false still runs every browser suite. Failed
analysis reports full; inability to write/upload the required report fails its
lane, never permits a false green or omission.

For PRs, the CLI validates the event's full base SHA and the checked-out HEAD SHA.
The checkout is GitHub's test merge commit, so comparing the PR base directly to
HEAD includes the tested merge result. A missing base object triggers only a
bounded depth-one fetch of that SHA. No all-history fetch or shell interpolation
is used. Git supplies complete NUL-delimited `--no-renames --name-status` data;
renames become deletion/addition. Additions, deletions, unknown statuses, invalid
history, unknown dependencies and unreviewed paths predict full. Push, dispatch
and unknown events report full without fetching history or creating Vite servers.

The analyzer uses TypeScript's parser and each of the **three** actual Vite dev
resolvers in middleware mode, with network listeners, HMR, watchers and dependency
optimization disabled. It walks the storage-workspace, barcode and barcode-scanning
harness sources, Playwright workspace config/tests/support, static imports,
exports and literal dynamic imports, with real ordered aliases. Frozen package
imports are external; lockfile/config/toolchain changes predict full. The shared
HR calendar appears in the observed closure. No production bundle builds run.

Explicit non-import input roots include all three harness directories (including
HTML/CSS and middleware), tests/fixtures, public assets, messages and output data.
These cover barcode photo fixtures, reader WASM, the middleware writer WASM
(package lock dependency), storage reference JSON and test support. The private
barcode manifest is disabled in the Playwright config; its config is always an
input. Runtime `/@fs` imports in job-ticket-image-compression are seeded for every
resolver: prepareJobTicketPhoto, the JPEG baseline and barcodeDecoder. Their
computed expressions require the audited caller's exact SHA-256 and literal
mapping; any caller edit requires another audit or predicts full. Other computed
imports, globs, parse failures and unresolved imports predict full.

Only **modified existing integration test implementations outside the observed
closure** can produce a negative prediction. No production directory, docs tree
or root-file extension is exempt. This narrow negative is useful for shadow
comparison, but the graph is not a proof of future skip safety: arbitrary runtime
file access, CSS/HTML references and dev middleware semantics need human review
before any activation. New dependency patterns must default full.

Reproduce a report from a committed checkout with installed dependencies:

```sh
GITHUB_EVENT_NAME=pull_request GITHUB_EVENT_PATH=/absolute/path/event.json node scripts/ci/workspace-impact.mjs
```

The event JSON needs `{"pull_request":{"base":{"sha":"<40-character base SHA>"}}}`.
The CLI writes `test-results/workspace-impact-report.json`. Tests use a local Git
fixture for invalid history, unusual filenames, rename/delete and additions;
resolver tests exercise the real harness configs without network. Saved local
evidence is in `docs/reviews/workspace-impact-2026-11-03.json`; it is not a
historical eligibility estimate. No 7/80 or other skip-rate claim is made.

## Rollout criteria

This removes three checkout/setup executions and reduces initially runnable
quality runners from 13 to 10. The aggregate is dependent, not initially runnable.
Runner waits do not establish account-cap saturation; wall time minus the longest
job is not queue time. Existing ruleset 24799747 protects main; no settings changes
are needed. Per-module Vitest, partial releases and cache trust changes remain
deferred.

Before any separate live-selection proposal: review all runtime/non-import and
base/deleted-path semantics; add dev-mode drift evidence and adversarial fixtures;
collect actual negative predictions paired with successful full workspace runs;
measure analysis/fetch/upload overhead and runner-seconds under comparable hosted
load; demonstrate aggregate/scheduling agreement under failure, cancellation,
missing outputs, shadow/off and event overrides. A time-only shadow period is
insufficient. Observe at least 20 PR runs for lane imbalance/gate regressions and
compare job creation/start/completion times and end-to-end elapsed time. Revert
workflow/policy/tests if serial lanes worsen the critical path. No speedup or
queue reduction is guaranteed.

## Local validation and timing

Final lane timing and validation evidence will be inserted after the clean
committed lane runs. Hosted checkout/setup/upload costs require hosted evidence.
