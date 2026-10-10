/**
 * Operator recovery for `aiUsage.finalizeFailed`: an attempt whose provider
 * answer arrived but whose finalization could not be written stays PENDING
 * (later INTERRUPTED) with unknown cost and no generation ID. The operator
 * copies `orgId`, `operationId`, `attemptNo`, `providerGenerationId` and
 * `status` from that log line into `aiUsage/recovery:attempt`.
 *
 * The action reads only the provider's generation metadata (a GET) and never
 * repeats inference. It is tenant-scoped by `orgId`, a dry run by default,
 * and idempotent: repeating an applied recovery answers `CURRENT`.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalMutation } from "../_generated/server";
import { lookupGeneration } from "./generation";
import { refreshOperation } from "./projection";
import { status, usageFields } from "./validators";

const GENERATION_ID = /^[a-zA-Z0-9_./:-]{1,160}$/;

type RecoveryState =
  | "NOT_FOUND"
  | "CURRENT"
  | "CONFLICT"
  | "INVALID"
  | "PROVIDER_UNCONFIGURED"
  | "COST_UNAVAILABLE"
  | "READY"
  | "RECOVERED";

const attemptArgs = {
  orgId: v.id("organizations"),
  operationId: v.string(),
  attemptNo: v.number(),
  providerGenerationId: v.string(),
};

export const record = internalMutation({
  args: {
    ...attemptArgs,
    status: v.optional(status),
    usage: v.object(usageFields),
    apply: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ state: RecoveryState }> => {
    if (
      args.status === "PENDING" ||
      args.usage.billingStatus !== "REPORTED" ||
      args.usage.usageSource !== "GENERATION_LOOKUP" ||
      args.usage.providerGenerationId !== args.providerGenerationId ||
      args.usage.costUsdNano === undefined
    )
      return { state: "INVALID" };
    const event = await ctx.db
      .query("aiUsageEvents")
      .withIndex("by_orgId_operationId_attemptNo", (q) =>
        q
          .eq("orgId", args.orgId)
          .eq("operationId", args.operationId)
          .eq("attemptNo", args.attemptNo),
      )
      .unique();
    if (!event) return { state: "NOT_FOUND" };
    if (event.billingStatus === "REPORTED")
      return {
        state:
          event.providerGenerationId === args.providerGenerationId
            ? "CURRENT"
            : "CONFLICT",
      };
    if (
      event.providerGenerationId !== undefined &&
      event.providerGenerationId !== args.providerGenerationId
    )
      return { state: "CONFLICT" };
    const claimed = await ctx.db
      .query("aiUsageEvents")
      .withIndex("by_orgId_providerGenerationId", (q) =>
        q
          .eq("orgId", args.orgId)
          .eq("providerGenerationId", args.providerGenerationId),
      )
      .first();
    if (claimed && claimed._id !== event._id) return { state: "CONFLICT" };
    const operation = await ctx.db
      .query("aiUsageOperations")
      .withIndex("by_orgId_operationId", (q) =>
        q.eq("orgId", args.orgId).eq("operationId", args.operationId),
      )
      .unique();
    if (!operation) return { state: "NOT_FOUND" };
    if (!args.apply) return { state: "READY" };
    // The logged outcome replaces only the placeholder statuses; a status the
    // ledger already finalized is kept.
    const outcome =
      event.status === "PENDING" || event.status === "INTERRUPTED"
        ? (args.status ??
          (event.status === "PENDING" ? "INTERRUPTED" : event.status))
        : event.status;
    const finishedAt = event.finishedAt ?? Date.now();
    await ctx.db.patch("aiUsageEvents", event._id, {
      ...args.usage,
      status: outcome,
      errorCode: outcome === "SUCCEEDED" ? undefined : outcome,
      finishedAt,
      durationMs: Math.max(0, finishedAt - event.startedAt),
    });
    await refreshOperation(ctx, operation);
    return { state: "RECOVERED" };
  },
});

export const attempt = internalAction({
  args: {
    ...attemptArgs,
    status: v.optional(status),
    apply: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    state: RecoveryState;
    applied: boolean;
    costUsdNano?: number;
  }> => {
    if (
      !GENERATION_ID.test(args.providerGenerationId) ||
      !Number.isSafeInteger(args.attemptNo) ||
      args.attemptNo < 1
    )
      return { state: "INVALID", applied: false };
    const lookup = await lookupGeneration(args.providerGenerationId);
    if (lookup.kind === "UNCONFIGURED")
      return { state: "PROVIDER_UNCONFIGURED", applied: false };
    if (lookup.kind !== "REPORTED")
      return { state: "COST_UNAVAILABLE", applied: false };
    const apply = args.apply === true;
    const { state } = await ctx.runMutation(internal.aiUsage.recovery.record, {
      orgId: args.orgId,
      operationId: args.operationId,
      attemptNo: args.attemptNo,
      providerGenerationId: args.providerGenerationId,
      ...(args.status === undefined ? {} : { status: args.status }),
      usage: lookup.usage,
      apply,
    });
    return {
      state,
      applied: state === "RECOVERED",
      ...(state === "READY" || state === "RECOVERED"
        ? { costUsdNano: lookup.usage.costUsdNano! }
        : {}),
    };
  },
});
