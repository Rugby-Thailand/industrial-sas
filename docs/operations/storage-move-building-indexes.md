# Building-scoped active move indexes

The building inventory query now reads active moves by both source building and target building. `sourceBuildingId`, `targetBuildingId`, and `buildingIndexVersion: 1` are derived together from the actual source and target placements. They are optional for compatibility with existing records. There is no client argument or public API change.

`reserveMove` is the only production move insertion path. It sets all three fields atomically. Destination replacement updates them from the existing source and newly validated destination. Pickup, completion, cancellation, return and recovery leave the building identities intact; changing `status` atomically changes membership in the active index ranges. Layout edits already prohibit moving occupied geometry. Migration changes only these projection fields, preserving business revisions and audit timestamps.

## Deploy and backfill

1. Deploy the additive schema/indexes and updated writers together, and wait for all indexes to finish building. Keep the existing pallet/status indexes. Do not deploy a reader-only change or restore an old writer while leaving the new reader running.
2. For each organization/warehouse, run the internal function below with `dryRun: true`. Follow `continueCursor` until `isDone: true`, retaining each page's report. Each call scans at most 50 moves; reduce `batchSize` if necessary. The cursor is scoped to the organization/warehouse and must not be reused for another warehouse.

   ```sh
   pnpm exec convex run finishedGoods/moveBuildingMigration:backfillBuildingIndexes \
     '{"orgId":"<organization-id>","warehouseId":"<warehouse-id>","batchSize":50,"dryRun":true}'
   ```

3. Review any `invalidMoveIds` and repair the underlying references through the established data-repair process. The migration verifies both placements' tenant, warehouse and pallet identities, and both buildings' tenant and warehouse. It does not invent or delete placements. In write mode it clears stale certification on malformed records so inventory uses the conservative fallback.
4. Run a new pass from an omitted/null cursor with `dryRun: false`, passing each returned `continueCursor` into the next call. This validates and repairs stale metadata as well as filling missing metadata. It is safe to retry any page or restart from the beginning: correctly indexed rows are unchanged. New reservations and replacement destinations are already indexed by the deployed writer.
5. Run a fresh complete dry-run pass. Completion requires **every page** to report `pending: 0` and `invalidMoveIds: []`, and the final page to report `isDone: true` and `hasLegacyActiveMoves: false`. `isDone` alone only means that pagination ended. A prior invalid row is not cleared merely because a later page is clean. If active moves changed during the pass, repeat verification before declaring completion.
6. Verify both buildings for a cross-building RESERVED move and an IN_TRANSIT move, including source and target holds, and compare the query's document/range reads against the scale report.

These are operator instructions, not a record of a production migration. No deployment or production backfill was performed during implementation.

## Fallback and rollback

Inventory first probes the two tenant/warehouse/status ranges whose `buildingIndexVersion` is absent, using `first()` rather than collecting move history. If either contains a legacy active move, inventory retains the prior per-pallet lookup for that building. This preserves all holds throughout rollout. **That fallback retains the previous scale limit**: a large building may continue failing until its warehouse's active legacy moves are indexed. It never silently drops those holds or returns truncated inventory.

Once both legacy ranges are empty, the reader uses four building/status ranges (source and target, RESERVED and IN_TRANSIT). New correctly indexed moves in unrelated buildings do not enter those ranges or the empty legacy ranges, preserving narrow subscriptions. Same-building moves may appear in both roles; mapping by placement ID deduplicates them. Terminal historical moves do not prevent readiness.

Rollback the reader/writer code together, retaining the optional fields and additive indexes. The old reader uses the existing pallet indexes and ignores the new fields. Before re-enabling the optimized reader after any period of old writers, run backfill and verification again: an old retarget writer could leave apparently complete but stale building metadata. Do not remove the original indexes or the fallback in this rollout.
