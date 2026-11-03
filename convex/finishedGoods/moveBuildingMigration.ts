/** Bounded, resumable validation/backfill of building-scoped active move reads. */
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

export const backfillBuildingIndexes = internalMutation({
  args: {
    orgId: v.id("organizations"),
    warehouseId: v.id("warehouses"),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    scanned: v.number(),
    updated: v.number(),
    pending: v.number(),
    invalidMoveIds: v.array(v.id("finishedGoodsMoves")),
    hasLegacyActiveMoves: v.boolean(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 50;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50)
      throw new Error("batchSize must be an integer from 1 to 50");
    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse || warehouse.orgId !== args.orgId)
      throw new Error("Warehouse does not belong to organization");
    const page = await ctx.db
      .query("finishedGoodsMoves")
      .withIndex("by_orgId_warehouseId_status", (q) =>
        q.eq("orgId", args.orgId).eq("warehouseId", args.warehouseId),
      )
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    const report = {
      scanned: page.page.length,
      updated: 0,
      pending: 0,
      invalidMoveIds: [] as (typeof page.page)[number]["_id"][],
    };
    for (const move of page.page) {
      if (move.status !== "RESERVED" && move.status !== "IN_TRANSIT") continue;
      const [source, target] = await Promise.all([
        ctx.db.get(move.sourcePlacementId),
        ctx.db.get(move.targetPlacementId),
      ]);
      if (
        !source ||
        !target ||
        [source, target].some(
          (p) =>
            p.orgId !== args.orgId ||
            p.warehouseId !== args.warehouseId ||
            p.palletId !== move.palletId,
        )
      ) {
        report.invalidMoveIds.push(move._id);
        // Do not certify malformed rows; clear any stale certification so reads
        // use the conservative fallback until the underlying data is repaired.
        if (!args.dryRun && move.buildingIndexVersion !== undefined)
          await ctx.db.patch(move._id, { buildingIndexVersion: undefined });
        continue;
      }
      const buildings = await Promise.all([
        ctx.db.get(source.buildingId),
        ctx.db.get(target.buildingId),
      ]);
      if (
        buildings.some(
          (building) =>
            !building ||
            building.orgId !== args.orgId ||
            building.warehouseId !== args.warehouseId,
        )
      ) {
        report.invalidMoveIds.push(move._id);
        if (!args.dryRun && move.buildingIndexVersion !== undefined)
          await ctx.db.patch(move._id, { buildingIndexVersion: undefined });
        continue;
      }
      if (
        move.buildingIndexVersion === 1 &&
        move.sourceBuildingId === source.buildingId &&
        move.targetBuildingId === target.buildingId
      )
        continue;
      report.pending++;
      if (!args.dryRun) {
        await ctx.db.patch(move._id, {
          sourceBuildingId: source.buildingId,
          targetBuildingId: target.buildingId,
          buildingIndexVersion: 1,
        });
        report.updated++;
      }
    }
    let hasLegacyActiveMoves = false;
    for (const status of ["RESERVED", "IN_TRANSIT"] as const) {
      const legacy = await ctx.db
        .query("finishedGoodsMoves")
        .withIndex("by_orgId_warehouseId_buildingIndexVersion_status", (q) =>
          q
            .eq("orgId", args.orgId)
            .eq("warehouseId", args.warehouseId)
            .eq("buildingIndexVersion", undefined)
            .eq("status", status),
        )
        .first();
      if (legacy) hasLegacyActiveMoves = true;
    }
    return {
      ...report,
      hasLegacyActiveMoves,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
