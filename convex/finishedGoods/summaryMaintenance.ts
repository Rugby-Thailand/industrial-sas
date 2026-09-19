import { v } from "convex/values";
import { mutationWithOrg } from "../lib/tenantFunctions";
import { backfillProductSummaries } from "../lib/finishedGoodsSummary";

/** Managers can resume an interrupted projection backfill one bounded batch at a time. */
export const prepare = mutationWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "finishedGoodsPallets" },
  warehouseId: (args) => args.warehouseId,
  handler: (ctx, args) =>
    backfillProductSummaries(ctx.tenantDb, args.warehouseId),
});
