# Local scale/read evidence — 2026-11-01

These are instrumented real registered callers in convex-test, on this local
Apple Silicon workspace with Node/pnpm. They are correctness and read-shape
measurements. They do not measure production backend OCC retries, transaction
bytes, p95 latency, subscription reruns or sustainable throughput.

The focused scale run used Vitest's JSON reporter. Indicative whole-test times
include fixture creation and assertions, rather than isolated query latency:

| Real caller regression                      | Fixture / observed read bound                                                                                                                                                      | Whole test time |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------: |
| Product storage-condition edit              | 10,001 unrelated pallets; exactly 2 pallet ranges and 0 returned pallet documents                                                                                                  |          335 ms |
| Current batch detail and lazy revisions     | 10,001 retired replacements; exactly 2 current units read by each of getBatch and the real manager, 0 revision ranges for getBatch; history page reads exactly 20 of 101 revisions |          530 ms |
| Concurrent requirement edit and reservation | Exactly one succeeds; a reserved pallet never acquires incompatible product requirements                                                                                           |           22 ms |
| Warehouse identity allocation               | Eight concurrent real createPallet calls; all succeed, 9 distinct codes including fixture unit, one warehouse counter                                                              |           29 ms |
| Legacy list relation hydration              | 100 batch-created units + 1 legacy unit; exactly 2 active-move ranges for the shown legacy unit                                                                                    |          105 ms |
| Complete legacy traversal                   | 45 batch units + 46 legacy units, one retired legacy excluded; every remaining legacy unit appears exactly once                                                                    |           56 ms |

The first four regressions are in finished-goods and finished-goods-batches
integration tests; the latter two are in legacy-unit-query-regressions. The
warehouse-scan regression was also run against the pre-fix writer and failed
with INTERNAL_FAILURE from the 10,000-row guard, then passed against the indexed
writer. The checked-in regression includes read counters, so a future broad scan
fails even if someone simply raises the old row ceiling.

## Preserved contention/cursor semantics

`nextCode` reads and writes one org/warehouse counter in the same transaction.
The synchronous finishedGoodsSummary hooks update warehouse readiness generation
on relevant changes. Both remain shared write points. This deliberately preserves
identity allocation and sorted-cursor invalidation. The counter concurrency test
establishes serializable outcomes in the local harness, not backend retry rates.
Existing catalogue-pagination tests also verify globally complete traversal,
changed-criteria/cross-warehouse rejection, generation handling and malformed
cursor refusal. These tests were run with this lane.

## Supported envelope and operating limits

- A preparation batch contains at most 50 current units. Current-state queries
  read only missing-retiredAt entries and fail explicitly on overflow. Revision
  history is paged (at most 25 rows) and can grow independently of retired units.
- Product/legacy catalogues keep their existing bounded scan continuations,
  generation checks and independent page cursors. Large histories do not become
  a hidden occupancy sample. The tests above demonstrate correctness at 10,001
  unrelated/retired records; they are not a claim of whole-warehouse throughput.
- Duplicate audits scan at most 50 source rows per call, with bounded exact-key
  probes. Temporary sweeps read at most 100 expired records of one tenant/table.
- Keep production warehouse throughput below a measured operational envelope;
  this local work does not establish a numerical writes/second capacity. Before
  expanding concurrency, measure backend conflict retries, bytes/read limits,
  latency and reactive subscription work at representative tenant sizes. Do not
  debounce generation updates or allocate identity blocks to conceal contention.

No production load, production data, external recovery, deployment or browser
acceptance was performed by this lane. Parent owns integrated browser acceptance.
