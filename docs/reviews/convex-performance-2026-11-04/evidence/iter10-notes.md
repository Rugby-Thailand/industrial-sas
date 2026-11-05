# Iteration 10 — maximum delete transaction and legacy roster compatibility

This is the last implementation iteration under the requested ten-iteration cap.
The final independent reviews are still required; no implementation-agent score
is assigned. The final backend source is at `c4ff5087` (later evidence-only
commits have identical backend code).

## Confirmed failure and repair

The public delete mutation accepts 300 selected scans. A real local-engine probe
saved 300 high-diversity scans, then attempted one atomic delete. It failed,
leaving all 300 intact. A second attempt with temporary local-only diagnostic
logging revealed `Too many reads in a single function execution (limit: 4096)`.
That diagnostic logging was removed before committing the fix. The original
error was hidden by the existing public tenant-error wrapper.

After the search write budget was exhausted, orphan collection still read each
released term and its linkage range. The fix defers these checks immediately
when the budget is exhausted. The scheduled transaction rechecks whether the
term is still referenced before removing it; no authorization or transactional
selection checks are bypassed. Source deletion and removal of searchable row
links remain atomic. Remaining postings/unused terms are cleaned asynchronously,
as in the existing maintenance design.

## Real engine, same 300 record IDs

Raw evidence: `iter10-delete-before.json`, `iter10-delete-diagnostic.json`,
`iter10-delete-after.json`, `iter10-delete-followups.json`.

- Before: fails; 300 source rows remain; 7,032 documents read and no committed
  writes. Execution 773.41 ms. The failure is not a successful baseline latency.
- After: succeeds; zero source rows remain; **2,486 / 4,096 read calls used**,
  1,610 remaining; 6,223 documents read, 2,074 documents written, 11,002 index-row
  writes; execution 463.09 ms, RTT 1,049.21 ms. One sample, not a throughput or
  latency-distribution claim.
- After uses the loopback-only measurement wrapper, which invokes the same
  public delete mutation with the normal caller identity, permissions and
  warehouse checks. The wrapper's transaction metrics include nested work.
  Probe availability and anonymous denial have regression coverage. It refuses
  hosted URLs even if local-seed enablement is set.
- The first attempts to invoke an internal version of the wrapper while acting
  as a user were rejected as function-not-found. They did not delete anything;
  they are excluded from the successful measurement. The public, loopback-only
  wrapper preserves identity through the nested authorized mutation.
- Subsequent reindex work: 11 observed successful transactions, no errors,
  **45,897 additional reads and 15,299 writes**. Logs have no per-request chain
  correlation, so these are time-window observations with no other manual
  benchmark writes, not a guaranteed isolated total. This is substantial
  deferred cost, not eliminated cost. The fixture test also requires all
  search rows, postings and orphan terms to disappear after scheduled cleanup.
- Source provenance: the successful after probe ran while the wrapper/roster
  edits were uncommitted at HEAD `5f0a51c7`; its exact backend content was then
  committed as `c4ff5087`. The evidence records this instead of pretending the
  measured HEAD alone identifies that backend.

Official documentation checked 2026-11-05:
[transaction headroom and shared nested limits](https://docs.convex.dev/database/writing-data),
[Convex limits](https://docs.convex.dev/production/state/limits).
`ctx.meta.getTransactionMetrics()` was verified on the actual local backend,
not merely inferred from installed types. Read calls and documents are distinct
limits. These measurements do not estimate cloud cost in currency.

## Legacy roster repair

Opus's iteration 9 audit identified a further compatibility regression: a site
with 60 former employees and 40 currently employed people could return
`LIMIT_EXCEEDED` to an old unpaged client after one incomplete native chunk.
A new test reproduced it. The legacy path now uses the existing bounded,
code-ordered `siteEmployeesInRange` scan before filtering/hydrating rows. It
preserves main's cap on employed staff before UI filters and refuses oversized
rosters before reading monthly cells. Current paged callers retain their
bounded native-page behavior. The 49/50/51 boundary and 50-by-31 save remain
covered. The baseline's previous-month profiler call now omits `pageSize`;
its legitimate refusal must not be compared to a successful paged answer.

## Validation

- New 300-scan test failed before the fix, passed afterwards, and completed all
  deferred cleanup. Its fixture counted 3,014 explicit read calls. This differs
  from the real-engine corpus/metric; it is not a billing measurement.
- New legacy 60-former/40-current regression failed before the fix.
- Five affected HR files: **28 tests passed** (7.63 s).
- Final combined validation: **60 tests in six files passed** (77.25 s): delete
  maximum/probe guard, storage scale/interleavings, building reconcile, roster
  paging/read-cost and registered roster transaction limits.
- Full ESLint and Convex TypeScript checks passed for the final source.
- Broader search corpus at iteration 9: **10 tests in two files passed**
  (921.31 s). Final full real-engine search parity is not claimed: the last
  537-traversal/300-needle full parity corpus is explicitly iteration 8.
- Entire-suite iteration 8 remains **5,704 passed / 2 failed**. Process
  cancellation and mobile-menu focus failures are unresolved intermittent
  validation limitations, even though isolated cases passed.

## Final profile

The full seven-sample iteration 10 profile completed on both local engines
after restoring the same dataset-L snapshot: `iter10.json` / `iter10.md`.
It includes query latency/read/byte measurements, write flows, subscription
fan-out and contention. Both targets have one OCC failure in the distinct-product
creation burst; the same-zone reservation burst intentionally conflicts on the
same space and records seven business refusals on each target. These are not
successful-throughput improvements. Baseline roster and payslip refusals remain
explicit. Setup used ten-row search backfill pages, with the harness timeout
retry; this does not prove production-default backfill time headroom.

## Final reviews and stopping condition

Independent Sol 6.1 and Opus 5.5 (Kiro CLI) reviews both score **7/10** at
`80a57bbd`, with the same backend digest as the final profile. Work stops at the
requested ten-iteration cap; the 9/10 target was not reached and the paired 8/10
screenshot threshold never applied. Opus additionally identifies an unmeasured
read-call risk for low-write deletes with many shared terms; the write-budget
guard does not establish a universal read-call bound. See the
[final report](../final-report.md) and [Opus review](../audits/iter10-opus-kiro.md).
