# T03 source verification and pre-PR evidence

Source implementation `66d143d6a00f971805e1bba303014d828e9ab7e6`, base
`d07f6282bfee73ac8c264f6cab4737487dc52a8e`, passed both non-author Codex
audits and all 15 coordinator gates. This documentation addition creates a
new candidate head: reviewers must confirm it and required gates must pass
on that exact head before a PR. There is no PR, merge, release or authoritative
Bun-adoption claim yet.

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
