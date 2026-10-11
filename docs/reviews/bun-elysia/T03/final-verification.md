# T03 source verification and pre-PR evidence

## Current status — PR #75 protected CodeQL failed, correction pending

[PR #75](https://github.com/Rugby-Thailand/industrial-sas/pull/75) head
`778d249e45358dd6e2c96dede583cc1eaab61686` passed both final non-author audits
(`CLEAR_EXACT_FINAL_SOURCE_AND_DOCUMENTATION`, `CLEAR_EXACT_FINAL_SPEC`) and all
15 local gates with exit 0, finishing at 2026-10-11T13:16:10.060107Z: 3,301
tests in 260 files, 346 release-contract tests in 14 files, 92 anonymous
browser tests and 1,400 tracked hashes unchanged
(`T03/final-gates-778d249e/results.json`). Protected CodeQL check run
114479367959 then failed with alert 15: `js/polynomial-redos`, security
severity high, at `tests/fixtures/bun-lifecycle/marker-probe.mjs` line 81.
Alert, check and annotation receipts are in external `T03/codeql15-correction/`.
The alert is not dismissed, and no workflow, protection, default, lock or
exception changed.

**Cause.** The inert probe's loopback registry decoded every request target and
routed tarballs with `/^\/([^/]+)\/-\/[^/]+-\d[^/]*\.tgz$/`. The overlapping
`[^/]+-\d` and `[^/]*` make a non-matching target such as `/./-/.-0` followed by
repeated `.-0` quadratic. The same handler also served any version or file name
under a known directory, served `/__proto__`, `/constructor` and similar
inherited names (plain-object lookup), accepted percent-encoded aliases, and
threw `URIError` on malformed encodings.

**Correction (exact Kiro Opus 5.5 high, uncommitted).** The exported
`createRegistryHandler(packages, port)` builds a `Map` of exactly four raw
request targets: `/esbuild`, `/t03-untrusted-marker` and each one's
`/<name>/-/<name>-0.0.0-t03.1.tgz`. It does no decoding or pattern matching;
every other target returns 404. A missing or only-inherited synthetic package
throws. Canonical manifest and tarball bodies are byte-identical to the old
handler's, so the canonical tarball URL (which Bun's default trust depends on)
is unchanged. The CLI now runs `main()` only as the entry point, so tests
import the handler without building tarballs, starting a server or spawning
Bun. Usage, exit 2 and temporary-directory cleanup are unchanged. At the
implementation stage the Bun trust probe was not rerun, and its frozen
observations were the only runtime evidence (preserved as history; see the
subsequent proof below). Source hashes are now
`0fb1eb11ed3185851aea3b3c9eb848a64b29bce5207cb0e0ce8d0dbbdb389e9f` (probe; was
`a6e3a366…` in the historical `source-manifest.json`, which stays unchanged)
and `a0e0b933b44ebd9aee1193cb6ac36ab3e612da10074b365fe62b824867c3e814`
(lifecycle integration test).

**Scoped red/green** (raw files in external
`T03/codeql15-correction/kiro-red-green/`):

| Check                                                                                                                                                    | Exit | Result                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Old `startRegistry` source from `778d249e` in a VM with a stub `createServer` (2 s VM timeout per call, 90 s child SIGKILL deadline), 27 crafted targets | 1    | 13 deviations: wrong version/file name served, four prototype names served, two malformed encodings threw, two encoded aliases served, adversarial 4,000/8,000 repetitions took 70/271 ms, 50,000 hit the VM timeout |
| Same probe on the corrected handler                                                                                                                      | 0    | 0 deviations; adversarial 50,000 repetitions 0.06 ms; four canonical bodies byte-identical to the old handler                                                                                                        |
| New `inert marker probe loopback registry routing` block with the old routing logic substituted into the exported handler                                | 1    | 13 failed, 41 passed (54); the adversarial case took 42 s. Probe restored and hash rechecked                                                                                                                         |
| `vitest run --project integration tests/integration/bun-lifecycle-policy.integration.test.ts`                                                            | 0    | 54 passed (28 existing, 26 new)                                                                                                                                                                                      |
| CLI with no arguments, extra arguments and a relative path                                                                                               | 2    | Usage message; no stdout and no new temporary directory                                                                                                                                                              |
| Corrected `startRegistry` source in a VM with a stub `createServer` (60 s deadline)                                                                      | 0    | Binds port 0 on `127.0.0.1`, attaches one request handler using the listening port; canonical tarball URL unchanged; adversarial target 404                                                                          |
| Scoped `prettier --check` (five changed files) and `eslint --max-warnings=0` (two source files)                                                          | 0    | Clean                                                                                                                                                                                                                |

The new tests cover both canonical manifests and tarballs, unknown packages,
wrong name, version and directory, prototype names, malformed and encoded
targets, dot segments, query strings, trailing slash, absolute-form, empty and
root targets, the alert's adversarial target and incomplete package input. No
real dependency script, install, network, browser, provider, full build or full
test suite ran.

**Subsequent fresh pinned-Bun proof (root, after implementation).** Root then
ran the current probe once with the pinned checker binary: Bun
`1.4.3+c6da4a4d3`, binary SHA-256
`28c7dd0a06916aba284d570ef44a2d70e9c538eaf2ba58dfe0910525563b3f79`, probe
SHA-256 `0fb1eb11ed3185851aea3b3c9eb848a64b29bce5207cb0e0ce8d0dbbdb389e9f`,
native Darwin arm64; its preflight scope records loopback-only synthetic
tarballs and an isolated temporary HOME and cache. The parent exited 0 with
empty stderr, no timeout and all 1,400
frozen inputs unchanged before and after. All eight synthetic cases match the
committed `marker-probe-darwin-arm64.stdout` in case ID, trusted dependencies,
dotenv and ignore-scripts flags, install arguments, markers, listed untrusted
packages and runtime dotenv value; all 24 child receipts (install, untrusted
listing and runtime dotenv per case) exited 0 with no signal, timeout or spawn
error. Install-log and listing text were not compared. The independent
specification reviewer verified these receipts by hash and field comparison
without executing lifecycle scripts. Receipts, under
`/Users/macbook/Development/industrial-sas-delivery-preserved-20261011/T03/codeql15-correction/`:
`current-bun-marker-proof/{preflight,session,exit,comparison}.json`,
`stdout.json` (SHA-256 `68d9d6e2…89e01a`), `stderr.txt` and `run.py`; reviewer
`initial-audits/spec-current-bun-evidence.results.json`. Unchanged probe
semantics are therefore shown only for these eight synthetic cases on native
Darwin arm64 with that binary. Linux, the full dependency graph, native
installs, runtime adoption and browser or application performance remain
unproved; no timing sample was taken.

**Initial correction audits and refactor step.** Both independent non-author
initial audits reviewed the frozen five-path working source at `778d249e`
(input map SHA-256 `75c8918c…111fab`): Standards clear with no findings
(`initial-audits/standards.md`); Specification source clear, with one P3
documentation correction (`initial-audits/spec.md`). The original regression
red/green above remains historical. The separate scoped Kiro Opus 5.5 high
refactor step found no justified code refactor, left the handler, fixture and
tests byte-unchanged so the fresh proof's probe hash still applies, and made
this P3 correction in the three delivery documents
(`post-audit-refactor/refactor-rationale.md`).

**Not claimed.** The `778d249e` audits and gates, the initial audits and the
refactor step do not approve a committed head, and protected CodeQL is not
cleared until new protected CI passes on that head. Pending: root's freeze and
commit, fresh final non-author audits and all 15 gates on that exact committed
head, new protected CI on [PR #75](https://github.com/Rugby-Thailand/industrial-sas/pull/75),
normal merge and automatic staging/production release. There is no T03 merge,
release, Bun adoption or performance claim. Rollback: revert through a new
protected-workflow pull request and normal merge, so `Planner quality` gates
the automatic release; never by direct push or manual deploy.

## Historical status — integrated `e717abec`, pending fresh verification

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
