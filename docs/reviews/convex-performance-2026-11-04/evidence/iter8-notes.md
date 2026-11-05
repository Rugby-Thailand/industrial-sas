# Iteration 8: changes, trade-offs and what to verify

Code: `perf/convex-backend-audit`, range `60dd3979..HEAD` (iteration 7 was audited at
`60dd3979`). Measurements: `iter8.md`/`.json` (dataset-L, base = `main@80dc0a93` in the
same run), `iter8-xl.md`/`.json` (dataset-XL) and `iter8-search-parity.json`
(real-engine parity versus main). The "(was N)" column of `iter8.md` compares against
iteration 7. Storage readers were implemented by a separate Claude Opus 5.5 agent, the
search-index guard by another; both were reviewed and partly reworked by the parent.

## Changes

| Commit(s) | Change | Findings |
| --- | --- | --- |
| `5193bd93`, `df5d74a4`, `5c898dc4`, `3308eee9` | Zone surface rows (`storageZoneSurfaces`) read by storage condition; entries rows v2 projected to the fields readers use, with stack facts; backfill pages budgeted in read calls (500) so dense zones fit the 4,096-read limit. Details below. | Opus 1, 5; Sol 1, 5, 7 |
| `4154f491`, `c458e593`, `cfe3f6ae`, `f08608f1` | Search indexes: layout marker (fall back at once after a layout write that bypassed the index), `sourceHash` per search row, minute-by-minute reconcile of rows written by code that does not maintain the index; reconcile progress kept off the readiness row; LOCAL-DRAFT seed invalidates. | Opus 2, Opus 9 |
| `93439178` | Unused search terms collected (delete/edit releases them). | Sol 2 |
| `0c00f619` | Totals: invalidation poisons an unfinished build; a build that saw the legacy generation move starts over. | Sol 3 |
| `8e710e76`, `9a7e6ddf` | Every overflowed zone re-checked each sweep (paged); `run.buildingReady` reports the zone-row check; resume tokens stay one page. | Sol 5, Opus 9 |
| `339c72fb` | Site employee scans (period preview, review scoping) stop once more than the limit are employed; same answer. | Sol 8, Opus 3 |
| `116293ee` | Roster without a page size: `LIMIT_EXCEEDED` whenever incomplete (as main above 50 employees); rows sent once. | Opus 7 |
| `ff036202`, `c3737c08`, `6aee6883`, `42b5b082` | Terminal checks in every traversal; parity labels no longer claim index attribution; pooled burst RTT; new measurements (picker hit, switched zone preview, previous-month roster, 50-scan delete, same-zone reservation burst); a UI test waits for the search postings of a 50-ticket save. | Sol 9, Opus "measure" |

## Decisions and trade-offs

- **Search exactness after a rollback.** Readers trust the index unless the layout
  marker shows a layout write that bypassed it (then the exact fallback, one extra read).
  Job scans and locations written by code that does not maintain the index (a rollback to
  `main`) are repaired by the minute-by-minute reconcile: they can be missing from results
  for about two minutes; `invalidate` makes readers fall back at once. The agent's first
  version made every search also merge every scan written since the watermark (and fall
  back to history after any burst of more than 99 saves, the picker to its keyset scan
  after any new location); that charged every search in a busy warehouse to guard a rare
  operator event, so it was removed. Reconcile progress lives on `searchIndexReconcile`,
  which readers never read, so advancing it re-runs no search.
- **Deletes and saves carry search postings.** A 50-scan delete reads 3,766 documents and
  writes 1,253 (base 160 / 53); a 50-scan save writes 1,253 (base 53). Each is one
  transaction well inside the limits; it is the write side of the search win.
- **Same-zone reservation burst.** Eight distinct pallets reserved into the warehouse's
  densest compatible zone: seven are refused `SPACE_OCCUPIED` on both targets (their
  recommended positions overlap), so the burst shows equal conflict handling, not
  throughput. A throughput burst would need non-overlapping hand-picked positions.
- **Unchanged, by design:** gapless pallet-code sequence contention; recommendation list
  completeness (the picker counts, filters and pages every candidate); whole-building
  inventory (the building screen totals across floors); the three whole-warehouse legacy
  endpoints (retiring them is an owner decision, not taken).

## Found while profiling

The first iteration-8 profile showed recommendations at 2,455 docs and inventory at 1,830:
the real backend's occupancy backfill had failed ("Too many index ranges read … 4096") and
the profiler had taken the error for "this target predates the store". Fixed in
`3308eee9` (read-call budget; a dense-zone test under the deployed limits that fails on
the old budget; the profiler now fails on a store that does not build).

## Storage readers (agent notes)

Code: `perf/convex-backend-audit` from `93439178`. Addresses Opus 1 and 5, Sol 1, 5
and 7 of iteration 7. Not yet profiled on the real backend: every number below is
a `convex-test` measurement on the `warehouseWorld` fixture of
`tests/integration/storage-query-scale.integration.test.ts` (4 active buildings,
24 compatible and 4 cold areas, 160 stored pallets, the dry probe pallet), taken
with the same instrumentation on `93439178` (before) and on this code (after).
Bytes are UTF-8 JSON sizes, not Convex wire sizes.

## Changes

| Change                                                                                                                                                                                                                                                                             | Findings         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Zone surface rows (`storageZoneSurfaces`, `convex/lib/zoneSurfaces.ts`): per zone, its fields, usability and ACTIVE positions with each position's location usability; maintained by the tracked-write flush, rebuilt by the occupancy backfill, guarded by the layout generation. | Opus 1, Sol 1    |
| Recommendation list reads surface rows by storage condition: only zones that can match the product; mismatched zones only when nothing fits (for the reasons). `recommendationZone` reads its zone's surface row.                                                                  | Opus 1, Sol 1    |
| Entries rows version 2: placements stored as the fields readers use; pallet facts without the row's warehouse.                                                                                                                                                                     | Opus 5, Sol 5, 7 |
| Stack facts on pallet facts (`activeMove`, `stackedPalletIds`), maintained by move and placement writes; recommendations validate pallet-top supports without per-pallet move and stack index ranges.                                                                              | Opus 1, Sol 1    |
| One read of each readiness input per recommendation (was three readiness and two legacy-generation reads).                                                                                                                                                                         | Opus 1           |

## Test measurements (same fixture, before = `93439178`)

| Reader                                 | Before docs / ranges / KB read | After docs / ranges / KB read |        Returned |
| -------------------------------------- | -----------------------------: | ----------------------------: | --------------: |
| `recommend` list (dry probe)           |              302 / 495 / 287.7 |               74 / 44 / 124.3 | 101.8 KB (same) |
| `recommend` list, nothing fits         |              302 / 495 / 287.7 |              106 / 49 / 161.1 |  64.5 KB (same) |
| `recommendationZone` (rack zone)       |                 43 / 22 / 21.8 |                19 / 15 / 10.1 |   4.0 KB (same) |
| `getStorageBuildingInventory`          |                 26 / 25 / 52.2 |                26 / 25 / 30.7 |  19.4 KB (same) |
| Entries rows, all zones (stored bytes) |                       185.2 KB |                       98.8 KB |                 |
| A reservation's entries-row write      |                         8.6 KB |                        4.5 KB |                 |

Re-runs (`rerunsOn` over the list's read set): a reservation in a cold area re-ran
the dry list before (`storageZoneOccupancy`), and does not now; a reservation in an
area the probe can use re-runs it before and after (its candidates changed). The
open zone preview still re-runs only for writes to its zone.

The fixture's placement documents are smaller than real ones (short QR values),
so the real entries-row reduction should be larger than the 47% measured here.
Index ranges were not profiled on the real backend; on the fixture the list
issues 44 against 495, mostly the per-pallet move and stack queries of stack
validation that the stack facts replace.

## Behaviour that differs, by design

- None in any payload: list, zone previews, full payload, reasons, order, counts
  and inventory are identical (parity tests compare both paths on one snapshot).
- The list now re-runs on any tracked layout write in the warehouse (it reads the
  layout generation), where before it re-ran only for layout writes in zones of
  active buildings. Layout writes are rare.
- A layout mutation over the maintenance budget (e.g. activating a building with
  thousands of positions) marks the warehouse's occupancy readiness stale and
  schedules a rebuild: every occupancy reader uses its original path until the
  rebuild finishes.

## What to verify on the real backend

- `recommend`/`recommendMove` list: docs, bytes and exec time, and the number of
  zones whose condition matches the probe (that, not the warehouse, now bounds it).
- `recommendationZone`, `getStorageBuildingInventory`, and `reserve`/`cancel`
  write bytes.
- Fan-out: a reservation in an area of another condition should not re-run the
  list.
- The backfill after deploy: `health` should report `surfacesReady: true`.

## Rollout

Deploy (squash-merge, as before). `ZONE_OCCUPANCY_VERSION` 2 makes every warehouse
not ready; the hourly sweep rebuilds (or run the backfill per warehouse, see
`docs/operations/storage-zone-occupancy.md`). Readers use the original paths
meanwhile. After any deploy of code that does not maintain these rows, call
`storageLayouts/zoneOccupancyBackfill:invalidate`.
