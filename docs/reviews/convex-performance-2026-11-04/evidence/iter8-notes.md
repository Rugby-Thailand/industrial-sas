# Iteration 8: storage recommendation and inventory readers

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
