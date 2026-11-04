/**
 * Operational migration for derived zone occupancy (convex/lib/zoneOccupancy.ts).
 * The tenant is derived from the warehouse, never caller supplied. Run with
 * `restart: true`, then pass each `continueCursor` back until `ready`.
 */
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../_generated/server";
import { createTenantDocumentAccess } from "../lib/tenantDb";
import { createMutationTenantStorage } from "../lib/tenantStorage";
import {
  rebuildZoneOccupancy,
  ZONE_OCCUPANCY_VERSION,
} from "../lib/zoneOccupancy";

async function readiness(
  ctx: MutationCtx,
  orgId: Doc<"organizations">["_id"],
  warehouseId: Doc<"warehouses">["_id"],
) {
  return ctx.db
    .query("storageZoneOccupancyReadiness")
    .withIndex("by_orgId_warehouseId", (q) =>
      q.eq("orgId", orgId).eq("warehouseId", warehouseId),
    )
    .unique();
}

/** Raw-writing seeds and repairs call this so readers fall back until rebuilt. */
export async function invalidateZoneOccupancy(
  ctx: MutationCtx,
  warehouseId: Doc<"warehouses">["_id"],
) {
  const warehouse = await ctx.db.get(warehouseId);
  if (!warehouse) return;
  const row = await readiness(ctx, warehouse.orgId, warehouseId);
  // Also poisons an unfinished backfill: it must restart to become ready.
  if (row && (row.ready || !row.stale))
    await ctx.db.patch(row._id, { ready: false, stale: true });
}

export const run = internalMutation({
  args: {
    warehouseId: v.id("warehouses"),
    restart: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    rebuilt: v.number(),
    isDone: v.boolean(),
    ready: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 20;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50)
      throw new Error("batchSize must be an integer from 1 to 50");
    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse) throw new Error("Warehouse not found");
    const orgId = warehouse.orgId;
    const requestId = "storage-zone-occupancy-backfill";
    const db = createTenantDocumentAccess(
      { orgId, requestId },
      createMutationTenantStorage(ctx, requestId),
    );
    const state = await readiness(ctx, orgId, args.warehouseId);
    if (args.restart || !args.cursor) {
      if (state)
        await ctx.db.patch(state._id, {
          ready: false,
          blocked: false,
          stale: false,
          version: ZONE_OCCUPANCY_VERSION,
        });
      else
        await ctx.db.insert("storageZoneOccupancyReadiness", {
          orgId,
          warehouseId: args.warehouseId,
          version: ZONE_OCCUPANCY_VERSION,
          ready: false,
        });
    }
    const page = await ctx.db
      .query("storageZones")
      .withIndex("by_orgId_warehouseId_code", (q) =>
        q.eq("orgId", orgId).eq("warehouseId", args.warehouseId),
      )
      .paginate({
        cursor: args.restart ? null : (args.cursor ?? null),
        numItems: batchSize,
      });
    for (const zone of page.page) await rebuildZoneOccupancy(db, zone);
    let ready = false;
    if (page.isDone) {
      // A rebuilt zone with a cross-building placement blocks readiness.
      const done = await readiness(ctx, orgId, args.warehouseId);
      ready = done !== null && done.blocked !== true && done.stale !== true;
      if (done && ready)
        await ctx.db.patch(done._id, {
          ready: true,
          version: ZONE_OCCUPANCY_VERSION,
        });
    }
    return {
      rebuilt: page.page.length,
      isDone: page.isDone,
      ready,
      continueCursor: page.continueCursor,
    };
  },
});

export const invalidate = internalMutation({
  args: { warehouseId: v.id("warehouses") },
  returns: v.object({ ready: v.boolean() }),
  handler: async (ctx, args) => {
    await invalidateZoneOccupancy(ctx, args.warehouseId);
    return { ready: false };
  },
});
