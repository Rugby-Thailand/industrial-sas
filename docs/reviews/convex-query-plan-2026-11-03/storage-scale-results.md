# Storage scale measurements and implementation

Measured 2026-11-03 in `convex-test` 0.0.54 / Convex 1.46.0, using the real registered handlers and tenant/authorization wrappers. The harness executes the handler in one transaction through `t.run`, with `transactionLimits: true`; it is not a production benchmark or latency measurement. Tests seed data in bounded separate transactions. The initial failures were reproduced before changing the handlers; limits-disabled runs supplied the complete baseline counters.

| Fixture                                                          | Before: ranges + point reads | After: ranges + point reads | After returned documents read | After approximate JSON bytes read | Result                                                                 |
| ---------------------------------------------------------------- | ---------------------------: | --------------------------: | ----------------------------: | --------------------------------: | ---------------------------------------------------------------------- |
| 1,500 held pallets, one product, no moves                        |        3,009 + 1,504 = 4,513 |          15 + 1,504 = 1,519 |                         3,010 |                           1.69 MB | Baseline fails limits; optimized returns all 1,500                     |
| 1,500 held pallets, 1,500 distinct products                      |     Not separately baselined |          15 + 3,003 = 3,018 |                         4,509 |                           2.33 MB | Optimized returns all 1,500                                            |
| 1,200 active SIMPLE zones, 1,099 incompatible and 101 compatible |        3,609 + 1,206 = 4,815 |       2,510 + 1,206 = 3,716 |                         2,413 |                           1.23 MB | Baseline fails limits; optimized returns all 101 compatible candidates |

Counts include authentication and permission reads. Inventory move range reads fell from 3,000 to 6 (two readiness probes and four building/status ranges). Recommendation position reads fell from 1,200 to 101; both placement status reads remain for every active zone to preserve the precedence of `LOCATION_GEOMETRY_UNKNOWN` over `STORAGE_CONDITION_MISMATCH`. Bytes are UTF-8 JSON approximations measured by `tests/fixtures/query-read-stats.ts`, including small empty-array overhead; they are not Convex wire/storage byte counters. Byte instrumentation was added after the baseline runs, so no baseline byte reduction is claimed.

## Correctness checks

- Full 1,500-pallet output with shared and distinct products and limits enabled; no truncation and bounded concurrent hydration.
- Mixed indexed/legacy active moves, same-building deduplication, cross-building source and target holds, and exact inventory equality before, during and after one-row migration pages.
- Migration dry-run/idempotency, stale metadata repair, and malformed foreign placement handling that removes certification and retains fallback.
- Location-only inventory remains separate from geometric placements; it still blocks recommendations ahead of condition mismatch. Both ordering cases of multiple rejection reasons are covered.
- Exact matches sort ahead of ANY/unknown conditions; inactive locations and archived parents remain excluded.
- Existing geometric occupancy, floor/rack/stack and move lifecycle suites remain green. Actual reserve/retarget tests assert metadata is derived from the corresponding placements.
- Additive optional schema fields, org-first index fields and the internal function contract are covered. The only API contract addition is the internal backfill function.

## Envelope and remaining limits

The 1,200-zone measurement is a mixed-condition workload, not a guarantee for 1,200 arbitrary compatible rack/support zones. Compatible zones still require their original positions, placements, block geometry and support validation; a large all-compatible warehouse can still exhaust transaction limits. No candidates are silently dropped and no approximate ranking is introduced. A future change for that workload needs measured requirements and a paginated/explicitly incomplete search contract or a carefully maintained read model; that is not silently substituted here.

The conservative legacy-move fallback still has the baseline inventory fan-out until the warehouse's active legacy moves are indexed. Malformed certified metadata can only be detected by validating its source records; the bounded migration audit repairs it. Production writers derive metadata atomically, and rollback/re-enable instructions require a fresh audit. See [the migration runbook](../../operations/storage-move-building-indexes.md).

No production traffic, deployment, active-move counts or latency distribution was measured. Compare equivalent deployment traffic before and after rollout before claiming production impact.
