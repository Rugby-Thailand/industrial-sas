# T3 architecture pilot — implementation verification

- Branch: `feat/t3-architecture-pilot`
- Implementation commit: `9b30dfedf717d56eae778c1510c3df60f882f63c`
- Comparison base: `c30b1c5f71819d59b91648e69725b283eae7458a`
- Later changes: [Audit fixes](#audit-fixes-2026-11-19)

## Delivered

- Explicit job-scan extraction, save and update response validators, with a
  client outcome adapter that retains refusal details.
- Required durable or ephemeral request-ID policies at all 23 finished-goods
  request sites. Recovery is actor-scoped; storage failure preserves the live
  in-memory request ID and does not disable writes.
- Import guards for job-scan internals, public Convex registrations and
  navigation-core runtime cycles, with executable boundary tests.
- Catalogue response-size assertions and a product detail subscription ownership
  test. The latter proves that the mounted, non-skipped query owner is released;
  it does not measure a network unsubscribe.
- A feature-owned photo acquisition controller with injected ports, cancellation,
  preview cleanup, stale-result protection and caller regression coverage.
- Updated [module map](../architecture/module-map.md), including policy counts,
  ownership and recovery limitations.

## Final save correction

A rejected job-scan save leaves the current batch editable. An identical retry
reuses its payload-keyed request ID; editing the batch mints a different ID and
submits the current values. Success clears the batch and request scope through
the live operation completion owner. The regression case exercises two rejected
attempts, an edited third attempt and success.

The installed Convex client retains sent mutations across reconnects. The test's
synthetic rejection exercises the caller's failure path; it is not a simulation
of transport reconnection. After the audit fixes, job-scan request IDs stay
in memory: neither the form nor its IDs survive a remount.

Codex independently reviewed the save correction and subscription test. Its
suggestions to narrow the reconnect comment and cover an edited retry are
included in the implementation commit.

## Verification

All of these commands passed on the implementation commit:

- `pnpm check:navigation` (including the Node fixtures and inventory gate)
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm typecheck:ts6`
- `pnpm lint`
- `pnpm ci:codegen`
- `pnpm ci:test-discovery`
- `git diff --check c30b1c5f..HEAD`

The final job-scan screen, product subscription and operation identity tests
passed: **3 files, 57 tests**. An earlier focused run including job-scan retention
also passed: **4 files, 68 tests**; that run preceded the final edited-retry
assertions, which are covered by the 57-test run.

The earlier complete-suite run had **459 passing files and 24 failing files**
(5,832 passing and 136 failing tests). That result is not a passing full suite.
All 24 failing files subsequently passed in a serial rerun on the implementation
commit, along with the two subscription/identity files: **26 files, 620 tests**,
in 1,246.31 seconds. The rerun used `pnpm exec vitest run --maxWorkers=1`, with
the existing corpus and timeouts unchanged. This resolves the observed failures
under serial execution; it does not establish that the default parallel run is
free of resource-sensitive failures. The earlier passing files were not rerun
after the final save correction.

The credential-free production build passed using the repository's pinned Bun
runner:

```sh
node scripts/ci/install-bun-checker.mjs --run run --bun --no-env-file next build
```

The build used the same `CI_EXTERNAL_TYPECHECK=1` setting as the smoke CI lane;
both independent type-check commands above passed. Compilation took 12.9 seconds
without a build cache, and all 74 static pages were generated. This is build
verification, not a comparative runtime or bundle performance benchmark. Browser
end-to-end suites were not rerun in this final pass.

## Handoff

Ready for push and CI review. The implementation and verification note are
committed on the pilot branch. Nothing has been pushed or deployed. The original
workspace's unrelated edits remain untouched.

## Audit fixes (2026-11-19)

Independent gpt-6.2-sol and Claude Opus audits scored each round; the fixes
below address their findings.

| Audited head | gpt-6.2-sol | Claude Opus |
| ------------ | ----------: | ----------: |
| `be5ab7a2`   |         6.4 |         7.1 |
| `da5f4a56`   |         7.2 |         8.3 |
| `b6919bf0`   |         8.3 |         8.7 |

- Ephemeral request IDs never touch storage, so the policy changes behavior: a
  remount mints a new ID. Durable stays the default for other callers.
- Job-scan saves are ephemeral. Tickets are not persisted, so a stored
  payload-keyed ID could only replay an old receipt for a new, identical batch,
  and it kept ticket content in localStorage. Identical retries within a mount
  still share an ID; a new batch after success gets its own, even when storage
  cleanup fails.
- A mount keeps its live durable ID; a stored ID is used only when the mount
  has none. Success retires only the keys that mount dispatched, so another
  tab's pending ID survives.
- `useOperation` places the actor after the scope's first segment, matching the
  pre-pilot keys, so IDs pending at deploy time are still found.
- `writeFailure()` builds every `WriteOutcomeError`; `requireWritten()` and
  `written()` delegate to it. The job-scan location form and record editor read
  the refused field and `STALE_REVISION` from it.
- Boundary guards reject `/./` and `//` path segments, template-literal dynamic
  imports and raw builder re-exports from exact owners. `module-boundaries`
  resolves every raw-module import path as a backstop to ESLint's pattern.
- Stored durable IDs expire 31 days after their last dispatch, outlasting the
  server's 30-day receipts. The document stays the pre-pilot flat map, with
  dispatch times under one reserved entry, so tabs on the old bundle keep
  working during the rollout.
- Success retires only IDs this mount dispatched and only while storage still
  holds them; a mount never overwrites another tab's ID for the same key, and
  unreadable documents are left untouched. Ephemeral cleanup stays in memory.
- Convex sources must be TypeScript (only the root `convex/_generated` is
  exempt), so no `.js` entry escapes the guards. `export * as` re-exports of
  raw builders are caught too.
- Package assignment and packing pass their scope without the actor, so
  `useOperation` adds it once, as the pre-pilot screens did.
- The subscription test counts live owners instead of renders, and the
  acquisition controller takes a ports getter.

Unchanged by decision: durable commands still dispatch with an in-memory ID
when storage is blocked or full (`8438ae4b`). Refusing before dispatch remains
limited to the package assignment, whose draft is its durable owner.

### Verification of the audit-fix head

These checks passed on `e0b9fe23`:

- `pnpm typecheck` and `pnpm typecheck:ts6`
- `pnpm lint` (whole repository, no warnings)
- `pnpm check:navigation`
- `pnpm format:check`
- `pnpm ci:test-discovery` (483 Vitest files, 29 Playwright specs)
- `git diff --check c30b1c5f..HEAD`

Vitest with `--maxWorkers=2` covered `src/features/finishedGoods`,
`src/lib/convex`, `src/hooks`, `src/features/storageLayouts` and the
module-boundary, job-scan contract and catalogue integration files: **106 files,
1,377 tests, 2 failures**. Both failures passed when rerun:

- `MoveScreen.test.tsx` passed twice on its own.
- `StorageLayoutNavigation.test.tsx` fails intermittently under machine load.
  It failed one of three runs on unmodified `c30b1c5f`, so the flakiness
  predates this branch.

Unrelated sessions kept the load average between 65 and 138 during this run.
The full parallel suite and the browser suites were not rerun; CI runs them.
