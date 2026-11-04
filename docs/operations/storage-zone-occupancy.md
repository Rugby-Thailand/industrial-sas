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
  `trackFinishedGoodsWrites`; the flush now also applies that mutation's placement,
  pallet and zone writes to the affected zones (`refreshZoneOccupancy`). A zone
  without rows is rebuilt from its authoritative ranges on first touch; later
  writes update its rows incrementally. Zones above `MAX_ZONE_OCCUPANCY_ENTRIES`
  keep only the summary (`complete: false`); readers read those zones directly.
- **Readers opt in per warehouse.** Readers use derived rows only when the
  readiness row is `ready`, not `blocked` and at the current `version`;
  otherwise they use the original placement ranges unchanged.
- **Cross-building placements block readiness.** Building readers select by the
  placement's `buildingId`; derived rows group by the zone's building. Any held
  placement whose building differs from its zone's sets `blocked`, and readers
  fall back until a restarted backfill finds none.
- **Raw writers invalidate.** Staging seeds that insert placements with `ctx.db`
  call `invalidateZoneOccupancy`; the e2e reset deletes the readiness row.
- Mutations (`reserve`, `confirmStored`, moves, scanning) still validate against
  authoritative placement reads. Derived rows never authorize a placement.

## Rollout

1. Deploy. New tables start empty; readers keep the original path.
2. Per warehouse, run the resumable backfill until `ready` is true:

   ```sh
   npx convex run storageLayouts/zoneOccupancyBackfill:run '{"warehouseId":"<id>","restart":true}'
   npx convex run storageLayouts/zoneOccupancyBackfill:run '{"warehouseId":"<id>","cursor":"<continueCursor>"}'
   ```

   `isDone: true, ready: false` means a cross-building placement blocked
   readiness; repair it (see `storage-move-building-indexes.md`) and restart.

3. To roll back reads without a deploy: `storageLayouts/zoneOccupancyBackfill:invalidate`.
   Rolling back code is safe: older readers ignore the derived tables.

Measured on the local large-tenant fixture (`docs/reviews/convex-performance-2026-11-04/evidence/iter2.md`):
`recommend` 2,886 → 686 docs, `getStorageBuildingInventory` 1,829 → 34,
`buildingOccupancy` 917 → 20; one placement write re-reads 6,092 → 1,692 docs
across open subscriptions.
