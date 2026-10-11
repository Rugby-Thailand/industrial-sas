# T03 integration refactor decisions

## Current — released `main` `49529b9e` integrated as `e717abec`

Date: 2026-10-11. Agent: Kiro, `claude-opus-5.5`, high effort. Scope: documentation only. Status: **pending fresh verification**.

**Assessment: no additional code refactor is justified by this integration.** The merge adds only the five released PR #74 diagnostic files. No T03 module, test, fixture, default, lock, exception, workflow or release input changed. This pre-audit assessment does not replace the required Kiro refactor step: root runs it separately after the fresh independent initial audit of the final documentation head, and a narrow "no refactor justified" result is acceptable there.

| Item                     | SHA                                        | Role                                                                                       |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Previous T03 head        | `3f4d8ffc4c12badcb92f46c17056e79d18972d88` | Documentation head on `a6be57e5`; both final audits and 15 gates clear; now **historical** |
| Released `main`          | `49529b9e1f70bdea48844bc130727d46ffa0fa30` | PR #74 diagnostics; run 38140638663 `RELEASED`                                             |
| Integrated merge (input) | `e717abecd5aefa2ddbf41eaf148218eb789b3288` | Parents `3f4d8ffc` and `49529b9e`; clean worktree when this review began                   |

Read-only git and SHA-256 checks in this worktree:

| Check                                                                                                                                                  | Result                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Path overlap, `a9fd6a0..3f4d8ffc` (40 T03-side paths) vs `a9fd6a0..49529b9e` (5 `main` paths)                                                          | None; merge base `a9fd6a0`                                                                                                                      |
| `3f4d8ffc` vs `e717abec`                                                                                                                               | Only the 5 `main` paths differ (3 modified, 2 added); tracked files 1,398 → 1,400                                                               |
| `main` paths, `49529b9e` vs `e717abec`                                                                                                                 | Byte-identical; SHA-256 equals every `verifiedMergedBlobs` entry in the released-base receipt (for example `smoke-diagnostics.mjs` `b5d82fae…`) |
| `scripts/ci`, `tests/fixtures`, `tests/integration/bun-*`, `package.json`, pnpm lock/workspace, `tools/`, `.github`, `.npmrc`, `.bun-version`, `docs/` | Unchanged between `3f4d8ffc` and `e717abec`                                                                                                     |
| References from `scripts/ci` or T03 tests to the new diagnostics                                                                                       | None                                                                                                                                            |

The new files are release-smoke diagnostics and their tests. They change the aggregate test inventory and the release-contract and browser-safety suites, so the historical `3f4d8ffc` counts cannot be reused. No Next code or configuration changed, so no framework guide applies.

Required next steps, in order, on the final exact documentation head:

1. Fresh independent initial audit, standards and specification axes.
2. Root's scoped Kiro refactor step (no-refactor result acceptable if justified).
3. Final exact-head non-author audits and all 15 gates.
4. PR through the protected workflow, linked to the T03 thread; normal merge; automatic staging and production verification.

Receipts are saved externally first; these documents are not edited during gates or measurements. Rollback is an opt-in revert of the T03 additions through the ordinary protected PR and release workflow. Existing pnpm install, audit, exceptions, locks and release controls remain authoritative.

Evidence (external, absolute):

- `/Users/macbook/Development/industrial-sas-delivery-preserved-20261011/T03/integration-released-49529b9e-20261011/released-base-verification.json` (released base, merged blob hashes, run outcome).
- `/Users/macbook/Development/industrial-sas-delivery-preserved-20261011/T03/integration-a6be57e5-20261011T1210/exact-verification-receipt.json` (historical `3f4d8ffc` audits and gates).
- `/Users/macbook/Development/industrial-sas-delivery-preserved-20261011/acceleration-handoff-20261011.md` (ownership and release disposition).

Edited scope: this file, `handoff.md` and `final-verification.md` in this directory, and `docs/plans/{bun-elysia-delivery-plan,performance-next-steps}-2026-10-11.md`. No other file changed; no install, build, test, browser, provider, network, commit or release action ran.

## Historical decision — `a6be57e5`

The section below is preserved unchanged as historical evidence; its holds and pending items are superseded by the current section above.

Date: 2026-10-11. Agent: Kiro, `claude-opus-5.5`, high effort. Scope: documentation only.

**Decision: no additional code refactor is justified.** The merge of concurrent `main` changed no T03 module, test, fixture, lock, workflow, exception or release input. Inventing a refactor would only invalidate the audited source without addressing an integration defect.

### Inputs

| Item                     | SHA                                        | Role                                                                     |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------------------------ |
| Original base            | `d07f6282bfee73ac8c264f6cab4737487dc52a8e` | Base for both T03 and concurrent `main`                                  |
| Reviewed source          | `66d143d6a00f971805e1bba303014d828e9ab7e6` | Last T03 code change                                                     |
| Previous documentation   | `399173c374ea339f44d774fa30f3de72e62a4e48` | Audits and 15 gates clear; now **historical**                            |
| Concurrent `main`        | `a9fd6a01859fc4109e540686c17fb1efe45d5b11` | PR #73, AI usage layout and daily estimates                              |
| Integrated merge (input) | `a6be57e5a112a1948f5ba3ff4adcb6bf3bc9bba4` | Parents `399173c3` and `a9fd6a01`; clean worktree when this review began |

The AGENTS.md rules and the installed Next 16.3.8 documentation index (`node_modules/next/dist/docs/`) were read. This review changes no Next code or configuration, so no further framework guide applies.

### Integration effects

The checks below are read-only git and SHA-256 comparisons made in this worktree.

| Check                                                                                                                                                      | Result                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Path overlap, `d07f628..399173c3` (39 T03 paths) vs `d07f628..a9fd6a0` (65 `main` paths)                                                                   | None                                                                                                                                          |
| T03 paths, `399173c3` vs `a6be57e5`                                                                                                                        | Byte-identical; stable patch IDs of both sides match across the merge (`3e1a52d3…`, `7e01ee2b…`)                                              |
| `main` paths, `a9fd6a0` vs `a6be57e5`                                                                                                                      | Byte-identical; no merge-resolution edit                                                                                                      |
| `scripts/ci`, `tests/integration/bun-*`, `tests/fixtures`, `tools/`, `.github`, both pnpm locks and workspaces, `.npmrc`, `.bun-version`, T03 review files | Unchanged between `399173c3` and `a6be57e5`                                                                                                   |
| Corrected module hashes                                                                                                                                    | Match the T04 review and correction receipt (for example `lockfile-graph.mjs` `090212d1…`, `installed-store.mjs` `9d6ad42b…`)                 |
| Portable archive `evidence-66d143d6.tar.gz`                                                                                                                | Unchanged; SHA-256 `82680b58ce950d76e6805c8da1e53c948c144c4b0b2c3560b156eabc047c45e4`                                                         |
| Root `package.json`                                                                                                                                        | One added script, `preview:ai-usage`; dependency, override and trust fields unchanged; SHA-256 `8ba12341…` → `feb3238e…`                      |
| Tracked files                                                                                                                                              | 1,354 at `66d143d6`, 1,359 at `399173c3`, 1,397 at `a6be57e5` (39 added, 1 deleted, 25 modified by `main`)                                    |
| `main` test changes                                                                                                                                        | 10 test files added or changed (AI usage, shell controls); the aggregate test inventory differs from the historical 3,173 tests and 254 files |

Why the `package.json` change does not affect T03 behavior:

- `scopeReport` compares only `dependencies`, `devDependencies` and `optionalDependencies` with the candidate manifest. It also requires `trustedDependencies: []` there and checks overrides against `pnpm-workspace.yaml`. Scripts are not compared.
- `inventoryScripts` reads materialized dependency manifests in the installed store. It classifies exact event names only (`preinstall`, `install`, `postinstall`, `preprepare`, `prepare`, `postprepare`), so a root `preview:*` script is neither an install nor a prepare event.
- Both locks are unchanged, so the real graphs, braces paths, lifecycle review and the refused `resolve@2.0.0-next.7` layouts are unaffected by the merge.

`source-manifest.json` still records the `d07f628` base hash `8ba12341…` for `package.json`. No code reads that manifest. It remains historical implementation evidence and must not be used to validate `a6be57e5` or later inputs.

The new `preview:ai-usage` command remains in `main`'s scope. T06 should inventory it with the other Vite preview entry point; T03 does not change it.

### Consequences

- The `399173c3` audits and 15 gates (3,173 tests in 254 files, 286 release-contract tests, 92 anonymous browser tests) are historical. They do not approve `a6be57e5` or the documentation candidate that follows it.
- The merge changes aggregate tests, Convex code (`convex/aiUsage/reports.ts`), messages, UI and the production build. Codegen, test discovery, browser checks and the full gate set therefore need fresh exact-head results.
- After this documentation is final, the next exact head needs both non-author audits (standards and specification) and all required gates before any PR. Audit and gate receipts are saved externally first. These documents are not edited during comparisons or sampling.
- A T03 PR or merge stays held until the companion records the `main` release disposition. Root performs no release mutation.

### Edited scope

Only the following five files were edited:

- `docs/reviews/bun-elysia/T03/integration-refactor.md` (new)
- `docs/reviews/bun-elysia/T03/handoff.md`
- `docs/reviews/bun-elysia/T03/final-verification.md`
- `docs/plans/bun-elysia-delivery-plan-2026-10-11.md`
- `docs/plans/performance-next-steps-2026-10-11.md`

No product, test, fixture, policy, exception, lock, default, workflow or release file changed. No install, build, test, browser, provider or network action ran, and no commit was made.
