/**
 * The derived-state writer for finished-goods and storage-layout mutations.
 *
 * Source writes (products, batches, units, placements, moves, layout rows,
 * locations, job scans) pass through two trackers. `flush` then updates
 * everything derived from them in the same transaction, in this order:
 *
 * 1. `trackFinishedGoodsWrites`: unit contributions and product summaries,
 *    warehouse totals, zone occupancy, zone surfaces, the storage catalogue
 *    signal and the finished-goods change shards.
 * 2. `trackSearchIndexWrites`: job-scan, building-name and location search
 *    rows. It runs second because it follows the layout generation the first
 *    flush advanced; overflow is scheduled for re-indexing.
 *
 * Every tenant mutation that writes a `PROJECTED_SOURCE_TABLES` table
 * declares `writer: inventoryWriter`. Without it `mutationWithOrg` refuses
 * the write, so a projection cannot silently fall behind its source. Raw
 * internal writers (seeds, backfills) bypass this and rely on readiness
 * flags and rebuilds instead.
 */
import { trackFinishedGoodsWrites } from "./finishedGoodsSummary";
import { trackSearchIndexWrites } from "./searchIndexWrites";
import type { TenantWriteOwner } from "./tenantFunctions";

export const inventoryWriter: TenantWriteOwner = ({ db, orgId, scheduler }) => {
  const summary = trackFinishedGoodsWrites(db, scheduler);
  // Search derives from the summary-tracked view, but its own derived rows
  // go to the untracked database.
  const search = trackSearchIndexWrites(summary.db, db, orgId, scheduler);
  return {
    db: search.db,
    flush: async () => {
      await summary.flush();
      await search.flush();
    },
  };
};
