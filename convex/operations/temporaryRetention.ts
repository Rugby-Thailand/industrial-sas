import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
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

/** One daily pass, with independently bounded work for each tenant. */
export const dispatch = internalMutation({
  args: { cursor: v.optional(v.string()), cutoff: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ organizations: number; isDone: boolean }> => {
    const cutoff = args.cutoff ?? Date.now();
    if (!Number.isSafeInteger(cutoff) || cutoff < 0 || cutoff > Date.now())
      throw new Error("Cutoff must be a past timestamp");
    // Organizations are the global identity catalogue. Tenant records are only
    // visited by the scoped sweep, never by a cross-tenant expiry range.
    const page = await ctx.db.query("organizations").paginate({
      numItems: 25,
      cursor: args.cursor ?? null,
    });
    for (const organization of page.page) {
      for (const table of ["idempotencyRecords", "hrPayslipTickets"] as const)
        await ctx.scheduler.runAfter(
          0,
          internal.operations.temporaryRetention.runPage,
          {
            orgId: organization._id,
            table,
            cutoff,
            remainingPages: 20,
          },
        );
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        1000,
        internal.operations.temporaryRetention.dispatch,
        {
          cutoff,
          cursor: page.continueCursor,
        },
      );
    return { organizations: page.page.length, isDone: page.isDone };
  },
});

export const runPage = internalMutation({
  args: {
    orgId: v.id("organizations"),
    table: v.union(
      v.literal("idempotencyRecords"),
      v.literal("hrPayslipTickets"),
    ),
    cutoff: v.number(),
    cursor: v.optional(v.string()),
    remainingPages: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    scanned: number;
    deleted: number;
    isDone: boolean;
    backlog: boolean;
  }> => {
    if (
      !Number.isInteger(args.remainingPages) ||
      args.remainingPages < 1 ||
      args.remainingPages > 20
    )
      throw new Error("Page budget must be 1..20");
    if (!(await ctx.db.get(args.orgId)))
      return { scanned: 0, deleted: 0, isDone: true, backlog: false };
    const result = await ctx.runMutation(
      internal.operations.temporaryRetention.sweep,
      {
        orgId: args.orgId,
        table: args.table,
        cutoff: args.cutoff,
        ...(args.cursor ? { cursor: args.cursor } : {}),
        limit: 100,
        dryRun: false,
      },
    );
    if (!result.isDone && args.remainingPages > 1)
      await ctx.scheduler.runAfter(
        1000,
        internal.operations.temporaryRetention.runPage,
        {
          ...args,
          cursor: result.cursor,
          remainingPages: args.remainingPages - 1,
        },
      );
    // When the budget is spent, the next daily pass starts at the oldest
    // surviving expiry. No permanent cursor or replay receipt is needed.
    return {
      scanned: result.scanned,
      deleted: result.deleted,
      isDone: result.isDone,
      backlog: !result.isDone && args.remainingPages === 1,
    };
  },
});
