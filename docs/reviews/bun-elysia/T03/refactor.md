# T03 Kiro refactor — bounded child output and one root reader

Agent: Kiro, claude-opus-5.5, high effort, no delegation. The coordinator launched
the owned process at 2026-10-11T09:54:41.655512Z; it exited 0 at
2026-10-11T10:00:14.267569Z on the uncommitted Codex-corrected tree above
`4474baae87147ef9cd0ffe5bc0c36c5aae622669`. Not an approval: the coordinator
audits this source and owns all repository gates.

## Decision

Two scoped changes are justified; everything else stays as audited.

1. **`runBunAudit` output accumulation (`scripts/ci/bun-audit.mjs`) — defect fix.**
   `stdout += chunk` decoded each Node `Buffer` chunk separately, so a UTF-8
   sequence split across chunks became replacement characters. The red test
   reproduced it (`Expected "{"é":1}"`, received two U+FFFD; 2 failed, exit 1).
   Each chunk also called `Buffer.byteLength` on the whole accumulated string
   (quadratic rescans), and the bound measured decoded rather than raw bytes.
   Now each stream keeps its raw chunks and a running byte count, and is
   decoded once at `close` with `Buffer.concat(...).toString("utf8")`.
   No new helper or export; the result shape is unchanged.
2. **`installed-store.mjs` duplicate reader removed.** `packagePathsIgnoringStore`
   repeated `packagePaths` line for line, apart from skipping the store entry.
   `packagePaths(modules, ignoredEntry = null)` now serves the root read. The
   root's earlier "unknown root entry" loop still rejects every other dot entry
   first. Only differences: the already-validated root directory is checked
   again, and an invalid scoped root alias now reads `invalid alias` instead of
   `invalid package alias`. No test asserts either message, and both fail closed.

Assessed and left unchanged: `lockfile-graph` override selection/provenance,
`semver-range`, `resolution-context` refinement and sharing flag,
`json-input`, `lifecycle-policy`, `installed-graph`. Each is either
security-dense with a single caller path or already minimal. Merging tiny
set-difference lambdas across modules would only add a shared helper. The
installed Next guides (`node_modules/next/dist/docs`) contain no
subprocess/stream guidance for these Node CI scripts and do not affect this
change.

## Invariants preserved

- `rawAuditProblems`, `decide`, `normalizeBunAudit`, graph validation in every
  mode, duplicate-key JSON rejection and all failure messages are unchanged.
- Overflow latch: the first chunk that would exceed 8 MiB on its stream sets
  `outputExceeded`, sends SIGKILL and drops later chunks. The retained output
  is never above the limit, and an exceeded result fails even after exit 0.
  `rawAuditProblems` still re-checks the decoded byte length (fail-closed for
  replays).
- Deadline (120 s SIGKILL), spawn-error capture, owned temporary HOME/XDG
  cleanup on `close`, the `--no-env-file` argument and the four-variable child
  environment are unchanged.
- Installed-store inventory, containment, link accounting and root-binding
  checks are unchanged, as is the strict installed→installed comparison.
  Lock→physical sharing is still limited to bisimilar contexts.
- The frozen `tests/fixtures/bun-lifecycle/reviewed-scripts.json` (sha256
  `4bcb07ab…f8d9ac`) and `source-manifest.json` (`560175e7…ff30a5`) are
  byte-identical before and after.

## Tests added (`bun-audit-adapter`, inert fake executable)

- Split-character tests (stdout and stderr) send bytes 0xC3 and 0xA9 100 ms
  apart and expect `{"é":1}`.
- `bounds raw bytes exactly: multibyte output at the limit is retained` sends
  exactly `AUDIT_OUTPUT_LIMIT` bytes of `é`. It is not exceeded, and the content
  survives intact.
- Mutation check: changing the bound to `>=` failed the at-limit test (1
  failed, exit 1). The source was restored, and its hash matched the edited
  file (`5ca54f55…3c7c`).

## Verification (direct exits; no pipeline exit used)

| Command                                                                                                                                                                                                                                                                                                  | Exit | Observed                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------- |
| Baseline before edit: `pnpm exec vitest run --project integration tests/integration/bun-audit-adapter.integration.test.ts tests/integration/bun-resolved-graph.integration.test.ts tests/integration/bun-lifecycle-policy.integration.test.ts tests/integration/bun-installed-graph.integration.test.ts` | 0    | 4 files, 143 passed                       |
| Red: `pnpm exec vitest run --project integration tests/integration/bun-audit-adapter.integration.test.ts -t "owned Bun audit child"` (new tests, old source)                                                                                                                                             | 1    | 2 failed (split stdout/stderr), 5 passed  |
| Final: same four-suite command                                                                                                                                                                                                                                                                           | 0    | 4 files, 146 passed (143 + 3 new)         |
| Child suite, `--reporter=verbose`                                                                                                                                                                                                                                                                        | 0    | 7 passed, 45 skipped                      |
| `pnpm exec eslint --max-warnings=0 scripts/ci/bun-audit.mjs scripts/ci/installed-store.mjs tests/integration/bun-audit-adapter.integration.test.ts`                                                                                                                                                      | 0    | no output                                 |
| `pnpm exec prettier --check scripts/ci/bun-audit.mjs scripts/ci/installed-store.mjs tests/integration/bun-audit-adapter.integration.test.ts docs/reviews/bun-elysia/T03/refactor.md docs/reviews/bun-elysia/T03/handoff.md`                                                                              | 0    | all matched files use Prettier code style |

Source sha256 after refactor (changed files only; the other scoped modules and
tests are byte-identical to the pre-refactor tree):

    5ca54f555a91e36c647266ad616dad907c5e1e925b1d0722ddd553f7b6e93c7c  scripts/ci/bun-audit.mjs
    215d9e052b45facc686e2779f8e3cce67f2b291475c881efe418046da5d343c4  scripts/ci/installed-store.mjs
    86e7dcafe1b5a8cf25978195b39e19ef5433ae21e70b74039714f99f15540508  tests/integration/bun-audit-adapter.integration.test.ts

Pre-refactor: `bun-audit.mjs` `4f53d266…7a7970`, `installed-store.mjs`
`dce7e73b…45011d`, adapter test `aa827064…3afc8`.

## Barriers unchanged (no adopt/pass or performance claim)

pnpm remains the authoritative installer and audit gate. The following
barriers are unchanged. Complete braces paths: 3 app and 37 release chains,
more than the exact exceptions cover. Selector provenance is missing for 7 app
and 27 release edges. Platform/libc metadata is dropped, and actual
optional-peer resolution differs. The app's physical
`debug → supports-color` version mismatch stays fail-closed. Release
expected 280 → physical 268 contexts share only semantically. The final T02
Elysia graph and Linux remain unvalidated. No benchmark, install, network
call, lifecycle execution, commit or PR was performed.
