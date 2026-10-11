/**
 * Database side of the AI usage projections. Every write that changes an
 * attempt re-derives its operation projection from the attempt ledger and
 * applies the summary delta in the same transaction, using the pure
 * functions in `convex/model/aiUsage/metrics.ts` (also used by the rebuild).
 */
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  projectOperation,
  replaceContribution,
  summaryKey,
  type OperationProjection,
} from "../model/aiUsage/metrics";
import { MAX_ATTEMPTS } from "../model/aiUsage/usage";

type Operation = Doc<"aiUsageOperations">;
type OperationFields = Omit<Operation, "_id" | "_creationTime">;

/** A domain refusal becomes the static error code the callers already use. */
export function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

/** The attempts of one operation, in attempt order (bounded). */
export async function operationAttempts(
  ctx: MutationCtx,
  orgId: Operation["orgId"],
  operationId: string,
): Promise<Doc<"aiUsageEvents">[]> {
  return await ctx.db
    .query("aiUsageEvents")
    .withIndex("by_orgId_operationId_attemptNo", (q) =>
      q.eq("orgId", orgId).eq("operationId", operationId),
    )
    .take(MAX_ATTEMPTS + 1);
}

export async function projectionOf(
  ctx: MutationCtx,
  orgId: Operation["orgId"],
  operationId: string,
): Promise<OperationProjection | null> {
  const attempts = await operationAttempts(ctx, orgId, operationId);
  return attempts.length === 0 ? null : unwrap(projectOperation(attempts));
}

/** Replace one operation's contribution to its daily summary row. */
export async function applySummaryDelta(
  ctx: MutationCtx,
  before: OperationFields | null,
  after: OperationFields | null,
): Promise<void> {
  const dimensions = after ?? before;
  if (!dimensions) return;
  const key = unwrap(summaryKey(dimensions));
  const existing = await ctx.db
    .query("aiUsageDailySummaries")
    .withIndex("by_orgId_summaryKey", (q) =>
      q.eq("orgId", dimensions.orgId).eq("summaryKey", key),
    )
    .unique();
  const metrics = unwrap(replaceContribution(existing, before, after));
  if (existing) {
    // A row left with no operation (an abandoned unsent attempt) is removed,
    // exactly as a rebuild of that day would leave it.
    if (Object.values(metrics).every((value) => value === 0))
      await ctx.db.delete("aiUsageDailySummaries", existing._id);
    else await ctx.db.patch("aiUsageDailySummaries", existing._id, metrics);
    return;
  }
  const {
    orgId,
    utcDay,
    feature,
    environment,
    actorUserId,
    warehouseId,
    requestedModel,
  } = dimensions;
  await ctx.db.insert("aiUsageDailySummaries", {
    orgId,
    utcDay,
    feature,
    environment,
    actorUserId,
    ...(warehouseId ? { warehouseId } : {}),
    requestedModel,
    summaryKey: key,
    ...metrics,
  });
}

/**
 * Re-derive an existing operation from its ledger, patch it and its summary.
 * With no attempts left the projection is removed. Returns the new fields.
 */
export async function refreshOperation(
  ctx: MutationCtx,
  before: Operation,
): Promise<OperationFields | null> {
  const projection = await projectionOf(ctx, before.orgId, before.operationId);
  if (!projection) {
    await ctx.db.delete("aiUsageOperations", before._id);
    await applySummaryDelta(ctx, before, null);
    return null;
  }
  const { _id, _creationTime: _created, ...previous } = before;
  const after: OperationFields = { ...previous, ...projection };
  await ctx.db.patch("aiUsageOperations", _id, projection);
  await applySummaryDelta(ctx, previous, after);
  return after;
}
