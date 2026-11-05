/** Local-only probes for actual transaction headroom. Never bypass tenant auth. */
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { mutation, internalQuery } from "../_generated/server";

function assertLocal() {
  const url = process.env.CONVEX_CLOUD_URL ?? process.env.CONVEX_URL ?? "";
  if (
    process.env.ALLOW_LOCAL_TEST_SEED !== "true" ||
    !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(url)
  )
    throw new Error("Transaction probe requires an enabled loopback fixture");
}
export const metrics = internalQuery({
  args: {},
  handler: async (ctx) => {
    assertLocal();
    return ctx.meta.getTransactionMetrics();
  },
});
// Public only so admin acting-as calls retain their user identity. The local
// guard disables this probe on hosted deployments; the nested mutation keeps
// its normal permission, warehouse and selection checks.
export const deleteScans = mutation({
  args: {
    warehouseId: v.id("warehouses"),
    requestId: v.string(),
    ids: v.array(v.id("finishedGoodsJobScans")),
  },
  handler: async (ctx, args) => {
    assertLocal();
    const result = await ctx.runMutation(
      makeFunctionReference<"mutation">(
        "finishedGoods/jobScans:deleteJobScans",
      ),
      args,
    );
    return { result, metrics: await ctx.meta.getTransactionMetrics() };
  },
});
