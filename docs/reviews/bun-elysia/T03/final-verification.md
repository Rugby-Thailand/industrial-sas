# T03 source verification and pre-PR evidence

## Current status — integrated `e717abec`, pending fresh verification

Current integration input `e717abecd5aefa2ddbf41eaf148218eb789b3288` merges
released `main` `49529b9e1f70bdea48844bc130727d46ffa0fa30` (PR #74, run
38140638663 `RELEASED`) into documentation head `3f4d8ffc`. Only the five
released diagnostic files changed, byte-identical to `main` and to the audited
release blobs; every T03 module, test, fixture, default, lock, exception and
workflow input is unchanged. See the
[integration refactor decision](integration-refactor.md).

All results below are **historical** and do not approve `e717abec` or the
documentation head that follows it. That exact head needs a fresh independent
initial audit, root's scoped Kiro refactor step, final non-author audits and all
15 gates, then a protected-workflow PR linked to the T03 thread, normal merge and
automatic staging/production verification. Receipts are saved externally first;
these documents stay unchanged during gates. There is no PR, merge, release or
authoritative Bun-adoption claim.

## Historical documentation head `3f4d8ffc`

Documentation head `3f4d8ffc4c12badcb92f46c17056e79d18972d88` (on integrated
`a6be57e5`) passed both final non-author audits (standards
`CLEAR_EXACT_FINAL_SOURCE_AND_DOCUMENTATION`, specification
`CLEAR_EXACT_FINAL_SPEC`) and all 15 gates with actual exit 0, finishing at
2026-10-11T12:40:47.765783Z: 3,241 tests in 259 files, 286 release-contract
tests, 92 anonymous browser tests and all 1,398 tracked hashes unchanged. No PR
or release was made for that head. Receipt:
`/Users/macbook/Development/industrial-sas-delivery-preserved-20261011/T03/integration-a6be57e5-20261011T1210/exact-verification-receipt.json`;
archive `exact-3f4d8ffc-verification.tar.gz` in the same directory (SHA-256
`5436d6c4312e2af563062654bb1cca68c8528273f2a162eb4b98da02ba99faa4`, 97 entries).

## Historical status — integrated `a6be57e5`

T03 is integrated with concurrent `main` `a9fd6a01859fc4109e540686c17fb1efe45d5b11`
as `a6be57e5a112a1948f5ba3ff4adcb6bf3bc9bba4`. The merge is clean, and every
T03 module, test, fixture, lock, exception, workflow and release input is
byte-identical to `399173c3`. See the
[integration refactor decision](integration-refactor.md): no additional code
refactor is justified.

All results below are **historical**. They do not approve `a6be57e5` or the
documentation candidate that follows it. That exact head still needs both
non-author audits and all required gates. The gates must cover the changed
aggregate tests, codegen, discovery, browser checks and production build.
Receipts are saved externally first. These documents stay unchanged during
comparisons. There is no PR, merge, release or authoritative Bun-adoption claim.
A PR or merge also waits for the companion's recorded `main` release
disposition.

## Historical documentation head `399173c3`

Documentation head `399173c374ea339f44d774fa30f3de72e62a4e48` (product basis
`66d143d6`) was cleared by both non-author audits. The external receipts are
`T03/final-audits/documentation-399173c3/`: standards
`CLEAR_SOURCE_AND_DOCUMENTATION_ONLY` and specification
`CLEAR_FINAL_DOCUMENTATION_SPEC`. All 15 gates exited 0 on that exact head,
finishing at 2026-10-11T10:44:08.567159Z (`T03/final-gates-399173c3/`). They
recorded the same 3,173 tests in 254 files, 286 release-contract tests and 92
anonymous browser tests. These receipts are not in the portable archive, which
predates them.

## Historical source verification `66d143d6`

Source implementation `66d143d6a00f971805e1bba303014d828e9ab7e6`, base
`d07f6282bfee73ac8c264f6cab4737487dc52a8e`, passed both non-author Codex
audits and all 15 coordinator gates. At the time, the documentation addition
created a new candidate head that still needed reviewer confirmation and
required gates; `399173c3` later satisfied this, as recorded above.

[Standards audit](final-standards.md): clear, 77 independent inert probes, actual
exit 0. [Specification audit](final-spec.md): clear for opt-in preparation,
81 independent probes, actual exit 0. Both confirmed all 1,354 tracked hashes
unchanged; the specification audit also checked 36 baseline invariant files.
Neither reviewer authored the implementation. Fixture bodies were never executed.

Coordinator checks finished at 2026-10-11T10:38:41.876711Z, all actual exits 0:

- Root and release frozen installs; checksum-verified Bun checker setup.
- `pnpm check`: formatting, Bun type checking, lint and **3,173 tests / 254 files**.
- Retained TS6 check and optimized Next production build.
- Production app, complete app and release dependency audits.
- Workflow/action pin verification, credential-free fresh codegen and test discovery.
- 13 release-contract suites: 286 tests; anonymous production browser: **92 passed**, zero retries.
- Clean-tree check; all tracked inputs unchanged throughout.

The [evidence archive](evidence-66d143d6.tar.gz) contains 56 regular-file entries
(including its manifest): exact command arrays, direct exits, raw outputs,
source maps, both audits and independently executed probes, exact-model
availability/agent exit, scoped Kiro correction checks, and rejected history.
[Entry digests](evidence-manifest.json) identify every source artifact. Archive
SHA256: `82680b58ce950d76e6805c8da1e53c948c144c4b0b2c3560b156eabc047c45e4`.

Historical f92 audits requested changes and the aggregate check failed with
26 test type errors. The first 66d143d6 codegen attempt refused an empty
`CONVEX_DEPLOY_KEY` environment name. The external runner then removed the
whole `CONVEX_` namespace and repeated all 15 gates; no repository safeguard
was altered. These failures remain in the archive, never counted as passes.

Known adoption barriers remain explicit: braces exception paths, selector
provenance, platform/libc and optional-peer differences, the app's published
`resolve` nested test layouts, Linux evidence and the final integrated T02
graph. Existing pnpm installation/audit, locks, exceptions and release controls
remain authoritative. Rollback is a normal revert of these opt-in additions;
no application schema or data migration is involved. Automatic staging and
production verification is required after the protected merge.
