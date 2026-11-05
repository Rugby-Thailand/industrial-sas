# Derived storage zone occupancy

`convex/lib/zoneOccupancy.ts` and `convex/lib/zoneSurfaces.ts` keep four derived
tables so occupancy and recommendation readers stop reading every held placement,
its pallet, and every zone's layout documents on every execution and re-run:

| Table                           | Row                                                                                                                                       | Read by                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storageZoneOccupancy`          | Per zone: held/unmeasured counts, stored/held footprint areas                                                                             | `buildingOccupancy`, `listStorageBuildings`; recommendations, for zones whose storage condition mismatches (only the unmeasured count matters there) |
| `storageZoneOccupancyEntries`   | Per zone: held placements (index order) as the fields readers use, plus pallet facts with stack facts (version 2)                         | `recommend`, `recommendMove`, `recommendationZone`, `getStorageBuildingInventory`                                                                    |
| `storageZoneSurfaces`           | Per zone: the zone's fields, whether it and its location are usable, its ACTIVE positions with whether each position's location is usable | `recommend`, `recommendMove`, `recommendationZone`                                                                                                   |
| `storageZoneOccupancyReadiness` | Per warehouse: `ready`, `version`, `runId`, the legacy writer and layout generations the rows are in step with                            | all of the above                                                                                                                                     |

### Entries rows (version 2)

- **Placements** are stored as the fields readers use (`HeldPlacement`: identity,
  status, position code, geometry, support ids, `updatedAt`, location-only
  assignment). The zone, and the warehouse and building unless a malformed
  placement names others, come from the row. Version 1 stored whole document
  copies; the projection roughly halves every entries row, every reader of it, and
  every reservation, cancellation or move that rewrites it.
- **Pallet facts** omit the row's warehouse and carry **stack facts**: whether the
  pallet has a RESERVED/IN_TRANSIT move (`activeMove`) and which pallets its held
  placements carry (`stackedPalletIds`). Recommendations validate every pallet-top
  support with them instead of four index ranges per supporting pallet. Move writes
  touch their pallet and placement writes touch the pallet they rest on, so both are
  maintained with the facts. `stackUnknown` marks facts not computed (a mutation
  rebuilding a zone of more than 50 new pallets); readers query those. Mutations
  (`reserve`, `confirmStored`, moves) never use them.
- Readers use only current-version rows. Older rows send that zone to its
  placements, and the next write or the rebuild replaces them.

### Zone surfaces

- The recommendation list reads, per zone that can match the product's storage
  condition, one surface row and one entries row: no zone, position or location
  document. The surface index (`warehouseId`, `buildingActive`, `eligible`,
  `conditionKey`) gives exactly the zones of ACTIVE buildings, usable, with an
  unconditioned, `ANY` or matching condition. Mismatched zones contribute only a
  reason, and reasons are shown only when nothing fits, so they are read (from the
  same index) only then. Floors, buildings and reserved blocks are still read once
  each and checked as before.
- **Maintenance:** the tracked-write flush (`trackSurfaceWrites`) rebuilds the row
  of every zone a mutation wrote (zones, positions, the zones and positions of
  written locations, every zone of a building whose status changed), writing only
  when the row changed. Rows are stamped with the occupancy run; rows of other runs
  (zones deleted by code that does not maintain them) are ignored.
- **Budget and deferral:** a mutation rebuilds at most 60 zones / ~1,200 documents,
  and writes at most 300 locations, of which at most 50 belong to zones it did not
  otherwise rebuild. Beyond that (activating a building of thousands of positions)
  it does not rebuild anything: it marks the readiness stale and schedules a
  restarted backfill. Readers use the layout documents meanwhile (exact).
- **Readiness and rollback guard:** readers use surface rows only while the
  occupancy rows are trusted **and** `layoutGeneration` equals the warehouse's
  `storageCatalogueSignals.generation`. Every tracked layout write (buildings,
  floors, zones, positions) bumps that signal, in this code and in code that predates
  surfaces; this code also advances `layoutGeneration` in the same transaction.
  After a layout write by code that does not maintain surfaces, the two differ,
  recommendations read the layout, and the hourly sweep restarts the backfill.
  Caveat: older code's location-only writes do not bump the signal; no current
  mutation writes locations without also writing a zone, position or building.

## Correctness model

- **Maintenance is transactional.** Every audited tenant mutation already flushes
  `trackFinishedGoodsWrites`; the flush also applies that mutation's placement and
  pallet writes to the affected zones (`refreshZoneOccupancy`). A zone without rows
  is rebuilt from its authoritative ranges on first touch (bounded: at most
  cap+1 rows per status); later writes update its rows incrementally and skip the
  write when nothing changed.
- **Overflowed zones** (more than `MAX_ZONE_OCCUPANCY_ENTRIES` held placements) keep a
  marker row only (`complete: false`): writes do no per-write work for them,
  recommendations read them directly, and building-scoped readers fall back for the
  warehouse. Each hourly sweep walks every overflowed zone of a ready warehouse
  (`recheckOverflow`, ten per page) and re-checks each in its own transaction
  (`recheckZone`), so a zone that drops back under the cap serves building readers
  again after the next sweep.
- **Two readiness scopes.** Zone-scoped readers (recommendations) need `ready`, not
  `stale`, the current `version`, and an unchanged legacy writer generation.
  Building-scoped readers (`buildingOccupancy`, building inventory) additionally need
  no zone row that is overflowed or holds a placement of another building
  (`buildingMismatch`), because they select by the placement's own building. They check
  the zone rows through two indexes, so they recover as soon as the cause is gone. The
  sticky `blocked`/`overflow` readiness flags are still written for older code only.
- **Rollback guard.** Code that predates these rows still bumps
  `finishedGoodsSummaryReadiness.generation` on every write; current code never does.
  The backfill records that value, and readers distrust the rows if it moved, so a
  rollback followed by a roll-forward cannot serve rows that missed writes.
- **Raw writers invalidate.** Staging seeds that insert placements, zones,
  positions or locations with `ctx.db` call `invalidateZoneOccupancy`, which also
  poisons a running backfill (`stale`); only a restarted backfill makes the
  warehouse ready again. The e2e reset deletes all four tables' rows for its
  warehouses.
- Mutations (`reserve`, `confirmStored`, moves, scanning) still validate against
  authoritative placement, layout and stack reads. Derived rows never authorize a
  placement.

## Rollout

1. Deploy. New tables start empty; readers keep the original path. A deploy that
   changes `ZONE_OCCUPANCY_VERSION` (2: projected entries, stack facts, zone
   surfaces) makes every warehouse not ready until the sweep's backfill rebuilds
   it; readers use the original path meanwhile.
2. The hourly `storageLayouts/zoneOccupancyBackfill:sweep` cron starts a chained,
   resumable backfill for every warehouse that is not ready (new, invalidated, or
   after a rollback). To run it immediately for one warehouse:

   ```sh
   npx convex run storageLayouts/zoneOccupancyBackfill:run '{"warehouseId":"<id>","restart":true,"chain":true}'
   ```

   Continue a manual run by passing back both `continueCursor` and `runId`; a
   restart issues a new `runId`, and pages of any older run are refused
   (`superseded: true`) so they cannot declare readiness. Each transaction stops
   rebuilding zones once it has spent about 500 read calls. The optional `budget`
   must be an integer from 1 to 500; it is a stopping threshold between zones,
   not a hard bound on transaction reads. The zone that crosses it still runs
   (a full zone can cost about 3,500 calls), and the next transaction resumes the
   same page. Measure dense-zone headroom before relying on production limits.

   `ready: true, buildingReady: false` means a cross-building placement or an
   overflowed zone keeps building readers on the original path; recommendations
   still use the rows. The backfill rebuilds each zone's surface row too. It captures
   summary and layout generations at the start. Maintained writes can advance the
   recorded generation after refreshing affected data; finish checks it against
   current generations. Explicit invalidation or unmaintained generation drift
   leaves the run stale instead of declaring readiness. A stale completed run
   waits for the hourly sweep, or an explicit restart using the command above.

3. To stop using the rows without a deploy: `storageLayouts/zoneOccupancyBackfill:invalidate`
   (the next sweep rebuilds them).
4. To see why building readers fall back:

   ```sh
   npx convex run storageLayouts/zoneOccupancyBackfill:health '{"warehouseId":"<id>"}'
   ```

   It lists overflowed zones and zones holding another building's placements, and
   `surfacesReady` with the recorded and current layout generations (different:
   a layout write by code that does not maintain surfaces, or a deferred one; the
   sweep rebuilds).

## Recommendation list and zone preview

Put-away and move screens call `recommend`/`recommendMove` with `view: "list"`:
the complete ranked list, each candidate without the fields its whole zone
shares (`occupied`, `unavailable`, `previewSupports`, `zone`, identifiers;
`convex/model/finishedGoods/recommendationView.ts`). The editor then loads
`recommendationZone` for the zone it previews only, so a write in another
zone never re-runs that preview. Both run the same per-zone evaluation
(`zoneRecommendation`), so `{ ...listed, ...zone }` is exactly the original
candidate (parity: `tests/integration/storage-query-scale.integration.test.ts`).
Without `view`, both return the original full payload for tabs loaded before
this change. With zone surfaces, the list reads only zones whose condition can
match the product, so a held placement write in a mismatched zone no longer
re-runs it; a write in a zone it shows still does (that zone's candidates
changed). Layout writes re-run it (it reads the layout generation).

## Maintained catalogue totals

`finishedGoodsWarehouseTotals` (`convex/lib/warehouseTotals.ts`) holds exact
catalogue totals in 8 product-sharded rows, maintained by the same tracked
writes. `finishedGoods/totalsBackfill:run` builds them for a catalogue of any
size, 500 products per transaction in creation order, chaining itself until
done. While it runs, writes apply deltas only to products it has already
counted (it counts the others' current state when it reaches them), and the
catalogue summary keeps using the paged scan. A newer run supersedes an older
one. The hourly `finishedGoods/totalsBackfill:sweep` starts a build where
totals are missing or suspect, and restarts one whose chain stopped for an
hour.

## Release constraint: squash-merge

Both derived stores detect writes by `main`-era code through the legacy
`finishedGoodsSummaryReadiness.generation`, which only that code still bumps.
Intermediate commits of the performance branch also skip that bump but do not
maintain every derived store, so they are **not supported deploy or rollback
targets**. Squash-merge the branch. If code that does not maintain these
stores runs anyway, call `finishedGoods/totalsBackfill:invalidate` and
`storageLayouts/zoneOccupancyBackfill:invalidate` per warehouse; the hourly
sweeps rebuild them.
