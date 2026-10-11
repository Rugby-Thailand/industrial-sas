# T01 independent comparison acceptance — defined before reproduction

This is a tooling experiment; application locale/viewport/navigation conditions do not apply to a standalone project checker. Application measurements remain Phase 2.

Freeze the exact committed candidate SHA, package/lock/tsconfig/.bun-version and checker/harness contents, pinned versions, local machine, telemetry/environment flags relevant to the commands, warm dependency store/filesystem and generated-route state. Record SHA-256 of all project input contents before and after; the deliberate edit subject must be restored. No overlapping builds, tests or benchmarks. Run ten observations per full/cached/edited profile, serially in forward and reversed order, with raw commands/exits/stdout/stderr and distributions.

Correctness acceptance: both checkers pass the exact candidate, select identical current project inputs, reject errors in src/tests/convex/generated route types and reject a genuine edit under a primed TS6 incremental cache. Source/lock/config changes during comparison invalidate it. Required gates must preserve TS6 API consumers and the independent Next build checker.

Timing acceptance: reproduce lower median whole-command elapsed time for Bun in both fresh/full and primed-cache comparisons, with no median regression in the edited-file checker comparison. Report all ranges, paired observations and cache definitions; if distributions or conditions make attribution uncertain, label it inconclusive and make no retained performance claim. Do not infer application, provider, build, browser or CI improvements. Adoption correctness is a separate T01 gate; measured claims require reproduced evidence.

The independent reviewer owns a separate worktree at the audited candidate. It must not alter candidate source, execute remote deployment/provider calls or modify any frozen evidence worktree. Preserve original candidate evidence separately before rerunning the harness. Record findings and source fingerprint equality even if the harness fails after writing results. Root creates the PR only after this comparison and required final gates pass.
