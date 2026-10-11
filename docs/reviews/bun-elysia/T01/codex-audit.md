# T01 independent Codex audits and corrections

Base: `77ae110b7f346af747ed4094dba8854801133d08`. Two independent read-only agents reviewed standards and specification. They ran no tests or comparisons concurrently with the implementation.

- P2 standards: empty PATH components skipped the current directory, potentially approving a different checker than the shell selected. Resolved by cwd-aware shell selection, with leading/trailing/consecutive empty-component regression cases and subprocess rejection.
- P1 specification: Git status could not establish an unchanged measured candidate. Resolved by before/after content fingerprints of all tracked and unignored files outside benchmark output, generated route types, installed TS6 input declarations, locks, configuration and harness. The candidate is checked after correctness probes and after timing; the Bun binary is rehashed. Completion is written only after every assertion. Final runs require external exit capture and independent reproduction on a committed candidate.
- P2 specification: whole-command generated errors were recorded without enforcement. Resolved by requiring guard survival and TS2322 rejection in all four scopes after type generation.
- P2 both audits: 20 verification logs were ignored by `*.log`. Original bytes and hashes are preserved outside the worktree under `industrial-sas-delivery-preserved-20261011/T01/original-verification-logs/`; portable contents now use tracked `.txt` files. Handoff links updated.
- Supplied JSON formatting failure: originals preserved outside the worktree under `T01/pre-format-json/`; JSON values compared equal after formatting. Exact original/formatted hashes are in [formatting-preservation.json](formatting-preservation.json).
- Scope decision: `scripts/ci/workflow-lib.mjs` owns mandatory workflow commands and order, so the focused validator change is necessary. Existing release protections and Node/pnpm behavior remain intact.

The historical pilot and implementation comparison remain provisional. The failed first comparison remains preserved outside the worktree under `T01/failed-first-comparison/`; it is excluded from accepted results. Neither historical run approves the final candidate.

Remaining: scoped Kiro Opus 5.5 high refactor, independent final comparison, exact-candidate full checks, Linux protected CI, PR review, merge and automatic staging/production release verification. No application or external-service latency improvement is claimed.

## Final refactor inspection

Both independent Codex auditors inspected the full candidate and scoped refactor on 2026-10-11. No remaining concrete standards/specification defect. All five source/test hashes match [refactor.md](refactor.md). The stale-success-marker concern was withdrawn after confirming completion.json is removed before artifact writes; the provisional timing language and preservation-location portability correction are resolved. Inspection does not replace the pending exact-candidate gates, independent committed-source comparison or Linux/release verification.

The correction regression initially lacked the required NODE_ENV in its minimal subprocess environment; both checker paths caught TS2769. NODE_ENV:test was restored, after which both checks passed.
