/**
 * Persisted per-actor action quotas.
 *
 * Consumed inside the action authorization preflight mutation, so the count
 * is transactional: concurrent requests from one actor serialize under
 * Convex OCC, across every server instance. A refused attempt does not
 * consume a unit. Each (actor, key) is one row reset in place per window.
 */
import type { Doc } from "../_generated/dataModel";
import type { TenantDocumentAccess } from "./tenantDb";

export interface ActionRateLimit {
  /** Stable name of the limited capability, e.g. `hr.search.ai`. */
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
}

export interface ActionQuotaVerdict {
  readonly allowed: boolean;
  /** Time until the current window ends; 0 when allowed. */
  readonly retryAfterMs: number;
  readonly remaining: number;
}

export function assertActionRateLimit(limit: ActionRateLimit): void {
  if (
    !/^[a-z][a-zA-Z0-9._-]{0,63}$/.test(limit.key) ||
    !Number.isSafeInteger(limit.limit) ||
    limit.limit < 1 ||
    limit.limit > 10_000 ||
    !Number.isSafeInteger(limit.windowMs) ||
    limit.windowMs < 1_000 ||
    limit.windowMs > 86_400_000
  )
    throw new Error("Invalid action rate limit declaration.");
}

export async function consumeActionQuota(
  tenantDb: TenantDocumentAccess,
  actorUserId: string,
  limit: ActionRateLimit,
  now: number,
): Promise<ActionQuotaVerdict> {
  const windowStart = now - (now % limit.windowMs);
  const row = await tenantDb
    .byIndex<Doc<"actionQuotas">>("actionQuotas", "by_orgId_actorUserId_key", [
      { field: "actorUserId", value: actorUserId },
      { field: "key", value: limit.key },
    ])
    .unique();
  if (row === null) {
    await tenantDb.insert("actionQuotas", {
      actorUserId,
      key: limit.key,
      windowStart,
      count: 1,
    });
    return { allowed: true, retryAfterMs: 0, remaining: limit.limit - 1 };
  }
  const count = row.windowStart === windowStart ? row.count : 0;
  if (count >= limit.limit)
    return {
      allowed: false,
      retryAfterMs: windowStart + limit.windowMs - now,
      remaining: 0,
    };
  await tenantDb.patch("actionQuotas", row._id, {
    windowStart,
    count: count + 1,
  });
  return {
    allowed: true,
    retryAfterMs: 0,
    remaining: limit.limit - count - 1,
  };
}
