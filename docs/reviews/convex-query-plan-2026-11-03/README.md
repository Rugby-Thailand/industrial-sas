# Convex query plan implementation — 2026-11-03

Implementation starts from `origin/main` at `8cf8be98`. The approved research
plan used the earlier `a2e964e2` checkout; PR #119 had already delivered several
of its changes by the time implementation began. This branch preserves those
changes and closes the remaining demonstrated gaps. Research used two rounds
of independent Kiro CLI and Claude sessions before implementation.

## Scope and evidence

| Workstream               | Delivered behavior                                                                                                                                                                    | Evidence                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — product requirements | Existing product/status existence checks retained; large-history, scope and real concurrency acceptance completed.                                                                    | [24 real backend races](product-race-evidence.md); 10,001 unrelated pallets with transaction limits enabled.                                                                                |
| B — payslips             | Existing payload split retained. Import pages capped at three while legacy inline PDFs remain.                                                                                        | Public staging/publication, legacy traversal, migration and verification for six imports of eight maximum-size PDFs, with ordinary and maximum-length UTF-8 CSV sources.                    |
| C — catalogue recovery   | Summary and list allow three automatic restarts, then explicit Retry. Only completion or a new scope/criteria renews the automatic budget.                                            | Actual catalogue caller tests exercise repeated and sustained invalidations, successful Retry, and actor/warehouse isolation. Shared hook callers retain their default single-reset budget. |
| D — batch details        | Reuse each unit's selected active move for editability; retain mutation early exits.                                                                                                  | 50-unit batch, 1,000 completed moves and 1,000 released placements: 100 move ranges, four active move documents, one held placement. Two-unit red baseline was eight ranges; now four.      |
| E — leave period locks   | One lazy, operation-local period range for ordinary multi-day checks; retain CLOSED/CLOSING and legacy overlap semantics.                                                             | Actual preview, submit, cancellation and restoration handlers; 1,080 expired periods excluded; unsorted restoration, employment precedence and atomic refusal checks.                       |
| F — storage scale        | Building-scoped active move indexes with validated backfill and conservative legacy fallback; bounded inventory hydration; avoid unnecessary geometry reads for condition mismatches. | Limit-enabled 1,500-pallet and 1,200-zone stress fixtures, occupancy parity, move lifecycle and migration tests.                                                                            |
| G — byte-limited pages   | No demonstrated row loss, so existing pagination runtime is retained. Added traversal and real screen navigation regressions.                                                         | [Caller inventory, SplitRequired experiment and limitations](pagination-audit.md).                                                                                                          |

The common Convex fixture now accepts explicit transaction limits through the
object-form `convexTest` API. Existing tests retain their previous default;
scale regressions opt in and seed data in bounded transactions. Instrumented
range/document/JSON-byte counts are local regression evidence, not production
billing or latency measurements.

## Deployment boundaries

The move schema fields and indexes are additive. Legacy active moves trigger
the previous complete per-pallet lookup until their metadata is backfilled;
large legacy inventories may still hit the original transaction limit during
that interval. No warehouse-wide scan or truncated success response replaces
that fallback.

See the [move-index migration and rollback runbook](../../operations/storage-move-building-indexes.md)
and [storage measurements](storage-scale-results.md) for the exact readiness
criteria and tested envelope. The HR reader's narrow capacity fallback is
documented in [period reuse evidence](hr-period-reuse-evidence.md).

The existing [payslip migration runbook](../../operations/hr-payslip-payload-migration.md)
still governs payload migration and rollback. Backend rollback to an inline-only
reader is unsupported after moving source bytes; roll forward instead. This
branch does not remove legacy fields or alter that policy.

No cloud backfill or production I/O comparison was performed. Operator
migrations remain distinct from deploying the additive code. The storage scale
fixtures establish a measured envelope, not a guarantee for every distribution
of 1,200 zones or arbitrarily large inventory.

## Validation

Final local verification passed:

- All **5,144 tests in 381 Vitest files** (`pnpm exec vitest run --maxWorkers=4`).
- Bun/TypeScript 7 and TypeScript 6 checks, ESLint, Prettier and diff checks.
- Navigation contract plus 68 architecture fixtures; test discovery confirms
  381 Vitest files and 17 Playwright specs.
- Credential-free Convex codegen; the generated API and reviewed validator
  snapshot add only the internal move-index migration function.
- Production build and **94 desktop/mobile browser smoke tests**.
- Runtime dependency audit at the repository's configured high-severity gate.
- The real backend **24-round concurrency experiment** documented above.

GitHub's required checks remain the merge gate; local success does not bypass
them. The original workspace's unrelated changes were preserved in place.

## Independent implementation review

Claude Opus 5.5 reviewed the implementation and ran 199 focused tests. It found
no blocking code defects. The parent adjudicated the following observations:

- The reviewer inspected while documentation was still being written. The
  completed move-index runbook now states all completion criteria and requires
  a fresh backfill/audit after any rollback to old writers; stale certified
  retarget metadata is covered by a repair regression.
- The import list now says "No imported batches on this page" in English and
  Thai, avoiding a global-empty claim when a bounded page is empty.
- With corrupt data that shares a placement between multiple active moves,
  annotation precedence can differ between building-index and per-pallet
  traversal. Normal writers create fresh targets and prohibit this state; the
  migration rejects mismatched ownership. No valid-state regression was shown,
  so tie-breaking for corruption is not redesigned in this release.
- Backfill traverses bounded pages of the warehouse's complete move history,
  skipping terminal rows. This can require many operator calls but keeps a
  simple resumable cursor and validates active records within bounded
  transactions. It is not part of the interactive query's cost.

The parent additionally preserved the rare HR refusal ordering case where an
unsorted date set spans more than 1,000 periods: only an oversized combined
range falls back to the previous per-date checks. Normal operations still read
once. New regressions demonstrate CLOSED/CLOSING refusal precedence and no
partial writes.
