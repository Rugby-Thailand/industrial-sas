# T3 architecture pilot — implementation verification

Branch: `feat/t3-architecture-pilot`  
Implementation commit: `9b30dfedf717d56eae778c1510c3df60f882f63c`  
Comparison base: `c30b1c5f71819d59b91648e69725b283eae7458a`

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
of transport reconnection. Durable request IDs do not persist the job-scan form
itself or provide atomic cross-tab locking.

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
