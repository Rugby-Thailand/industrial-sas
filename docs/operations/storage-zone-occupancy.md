# Derived storage zone occupancy

`convex/lib/zoneOccupancy.ts` keeps three derived tables so occupancy readers stop
reading every held placement and its pallet on every execution and re-run:

| Table                           | Row                                                                    | Read by                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storageZoneOccupancy`          | Per zone: held/unmeasured counts, stored/held footprint areas          | `buildingOccupancy`, `listStorageBuildings`; recommendations, for zones whose storage condition mismatches (only the unmeasured count matters there) |
| `storageZoneOccupancyEntries`   | Per zone: exact copies of held placements (index order) + pallet facts | `recommend`, `recommendMove`, `recommendationZone`, `getStorageBuildingInventory`                                                                    |
| `storageZoneOccupancyReadiness` | Per warehouse: `ready`, `blocked`, `version`                           | all of the above                                                                                                                                     |

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

   Continue a manual run by passing back both `continueCursor` and `runId`; a
   restart issues a new `runId`, and pages of any older run are refused
   (`superseded: true`) so they cannot declare readiness. Each transaction stops
   rebuilding zones once it has read about 4,000 documents (`budget`), and the next
   one resumes the same page, so dense zones cannot push a page past the
   transaction limits.

   `ready: true, buildingReady: false` means a cross-building placement or an
   overflowed zone keeps building readers on the original path; recommendations
   still use the rows.

3. To stop using the rows without a deploy: `storageLayouts/zoneOccupancyBackfill:invalidate`
   (the next sweep rebuilds them).
4. To see why building readers fall back:

   ```sh
   npx convex run storageLayouts/zoneOccupancyBackfill:health '{"warehouseId":"<id>"}'
   ```

   It lists overflowed zones and zones holding another building's placements.

Measured on the local large-tenant fixture (`docs/reviews/convex-performance-2026-11-04/evidence/iter2.md`):
`recommend` 2,886 → 686 docs, `getStorageBuildingInventory` 1,829 → 34,
`buildingOccupancy` 917 → 20; one placement write re-reads 6,092 → 1,692 docs
across open subscriptions.

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
this change. The list still reads every active zone it ranks, so a held
placement write in any of them re-runs it.

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
