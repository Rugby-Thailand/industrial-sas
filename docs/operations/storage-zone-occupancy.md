# Derived storage zone occupancy

`convex/lib/zoneOccupancy.ts` keeps three derived tables so occupancy readers stop
reading every held placement and its pallet on every execution and re-run:

| Table                           | Row                                                                    | Read by                                                     |
| ------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| `storageZoneOccupancy`          | Per zone: held/unmeasured counts, stored/held footprint areas          | `buildingOccupancy`, `listStorageBuildings`                 |
| `storageZoneOccupancyEntries`   | Per zone: exact copies of held placements (index order) + pallet facts | `recommend`, `recommendMove`, `getStorageBuildingInventory` |
| `storageZoneOccupancyReadiness` | Per warehouse: `ready`, `blocked`, `version`                           | all of the above                                            |

## Correctness model

- **Maintenance is transactional.** Every audited tenant mutation already flushes
  `trackFinishedGoodsWrites`; the flush also applies that mutation's placement and
  pallet writes to the affected zones (`refreshZoneOccupancy`). A zone without rows
  is rebuilt from its authoritative ranges on first touch (bounded: at most
  cap+1 rows per status); later writes update its rows incrementally and skip the
  write when nothing changed.
- **Overflowed zones** (more than `MAX_ZONE_OCCUPANCY_ENTRIES` held placements) keep a
  marker row only: writes do no per-write work for them, recommendations read them
  directly, and building-scoped readers fall back for the warehouse (`overflow`).
- **Two readiness scopes.** Zone-scoped readers (recommendations) need `ready`, not
  `stale`, the current `version`, and an unchanged legacy writer generation.
  Building-scoped readers (`buildingOccupancy`, building inventory) additionally need
  no `blocked` (a held placement names a building other than its zone's) and no
  `overflow`, because they select by the placement's own building.
- **Rollback guard.** Code that predates these rows still bumps
  `finishedGoodsSummaryReadiness.generation` on every write; current code never does.
  The backfill records that value, and readers distrust the rows if it moved, so a
  rollback followed by a roll-forward cannot serve rows that missed writes.
- **Raw writers invalidate.** Staging seeds that insert placements with `ctx.db` call
  `invalidateZoneOccupancy`, which also poisons a running backfill (`stale`); only a
  restarted backfill makes the warehouse ready again. The e2e reset deletes all
  three tables' rows for its warehouses.
- Mutations (`reserve`, `confirmStored`, moves, scanning) still validate against
  authoritative placement reads. Derived rows never authorize a placement.

## Rollout

1. Deploy. New tables start empty; readers keep the original path.
2. The hourly `storageLayouts/zoneOccupancyBackfill:sweep` cron starts a chained,
   resumable backfill for every warehouse that is not ready (new, invalidated, or
   after a rollback). To run it immediately for one warehouse:

   ```sh
   npx convex run storageLayouts/zoneOccupancyBackfill:run '{"warehouseId":"<id>","restart":true,"chain":true}'
   ```

   `ready: true, buildingReady: false` means a cross-building placement or an
   overflowed zone keeps building readers on the original path; recommendations
   still use the rows.

3. To stop using the rows without a deploy: `storageLayouts/zoneOccupancyBackfill:invalidate`
   (the next sweep rebuilds them).

Measured on the local large-tenant fixture (`docs/reviews/convex-performance-2026-11-04/evidence/iter2.md`):
`recommend` 2,886 → 686 docs, `getStorageBuildingInventory` 1,829 → 34,
`buildingOccupancy` 917 → 20; one placement write re-reads 6,092 → 1,692 docs
across open subscriptions.
