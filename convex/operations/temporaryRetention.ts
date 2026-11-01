import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { createTenantDocumentAccess, type TenantOrgId } from "../lib/tenantDb";
import { createMutationTenantStorage } from "../lib/tenantStorage";

/** Operator-driven, resumable expiry sweep. Never touches business/history tables. */
export const sweep = internalMutation({
  args: {
    orgId: v.id("organizations"),
    table: v.union(
      v.literal("idempotencyRecords"),
      v.literal("hrPayslipTickets"),
      v.literal("supportGrants"),
    ),
    cursor: v.optional(v.string()),
    cutoff: v.number(),
    limit: v.number(),
    dryRun: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.cutoff) ||
      args.cutoff > Date.now() ||
      args.cutoff < 0
    )
      throw new Error("Cutoff must be a past timestamp");
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)
      throw new Error("Limit must be between 1 and 100");
    if (!(await ctx.db.get(args.orgId)))
      throw new Error("Organization not found");
    const requestId = "temporary-retention-v1";
    const db = createTenantDocumentAccess(
      { orgId: args.orgId, requestId },
      createMutationTenantStorage(ctx, requestId),
    );
    const result = await db
      .byIndex<{
        _id: string;
        orgId: TenantOrgId;
        expiresAt: number;
        status?: string;
      }>(args.table, "by_orgId_expiresAt", [], {
        field: "expiresAt",
        upper: {
          value: Math.min(args.cutoff, Number.MAX_SAFE_INTEGER - 1),
          inclusive: true,
        },
      })
      .page({ limit: args.limit, cursor: args.cursor });
    let deleted = 0;
    let expired = 0;
    let retained = 0;
    for (const row of result.page) {
      if (args.table === "supportGrants") {
        if (["REQUESTED", "APPROVED", "ACTIVE"].includes(row.status ?? "")) {
          if (!args.dryRun)
            await db.patch("supportGrants", row._id, { status: "EXPIRED" });
          expired++;
        } else retained++;
      } else if (!args.dryRun) {
        await db.delete(args.table, row._id);
        deleted++;
      }
    }
    return {
      version: 1,
      orgId: args.orgId,
      table: args.table,
      cutoff: args.cutoff,
      dryRun: args.dryRun,
      scanned: result.page.length,
      eligible: result.page.length,
      deleted,
      expired,
      retained,
      isDone: result.isDone,
      cursor: result.continueCursor,
    };
  },
});
