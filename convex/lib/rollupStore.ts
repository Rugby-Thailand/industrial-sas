/**
 * Moving a maintained counter, inside the transaction that earned the move
 * (`ADR-0011` §6, `INV-0011-07`, `INV-0011-09`).
 *
 * Every function here runs on the caller's `TenantDocumentAccess`, in the
 * caller's transaction. That placement is the whole design: a counter updated by
 * a separate job is a counter that is wrong for as long as the job is behind,
 * and a supervisor cannot tell a stale tile from a quiet warehouse. Written with
 * the domain change, it commits or does not exist.
 *
 * ### Why a wrong counter never stops a receipt
 *
 * A dashboard tile is a display. If the counter arithmetic is wrong — a
 * transition counted twice, an increment lost to a code path nobody updated —
 * the honest response is *not* to refuse the posting: an operator at a dock
 * cannot fix a rollup, and a warehouse that stops receiving because a number is
 * off has failed much worse than a number being off.
 *
 * So `adjustRollup` is total. It clamps at zero and records `underflowAt`, which
 * is the marker `verifyRollups` and the ledger-drift runbook look for. The
 * failure stays visible without being fatal, which is the same trade the
 * reconciliation job makes for balances.
 *
 * ### What it will not do
 *
 * Invent a metric. `RollupMetric` is closed and each member is paired with a
 * derivation the verifier knows how to run, so a counter that nothing could
 * recompute cannot be created from a call site.
 */
import {
  applyRollupDelta,
  subjectKeyFor,
  type RollupMetric,
} from "../model/reporting/rollup";

import type { TenantDocumentAccess, TenantOrgId } from "./tenantDb";

/** The stored shape, as this module reads it back. */
export interface RollupDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly metric: RollupMetric;
  readonly subjectKey: string;
  readonly count: number;
  readonly updatedAt: number;
  readonly underflowAt?: number;
}

export const ROLLUP_TABLE = "operationsRollups";
export const ROLLUP_INDEX = "by_orgId_warehouseId_metric_subjectKey";

export interface RollupAdjustment {
  readonly tenantDb: TenantDocumentAccess;
  readonly warehouseId: string;
  readonly metric: RollupMetric;
  /** Required for a per-subject metric, refused for a site metric. */
  readonly subjectId?: string | undefined;
  readonly delta: number;
  /** The caller's clock, so this module takes none. */
  readonly now: number;
}

/**
 * Read one counter, or `null` when it has never been touched.
 *
 * `null` is not zero, and the difference is worth keeping: a metric with no row
 * has had no events at all, while a zero row has had events that netted out. The
 * dashboard shows both as `0` — correctly — but the verifier treats them
 * differently, because a missing row for a metric with source data is drift.
 */
export async function readRollup(
  tenantDb: TenantDocumentAccess,
  warehouseId: string,
  metric: RollupMetric,
  subjectId?: string,
): Promise<RollupDocument | null> {
  const key = subjectKeyFor(metric, subjectId);
  if (!key.ok) return null;

  return await tenantDb
    .byIndex<RollupDocument>(ROLLUP_TABLE, ROLLUP_INDEX, [
      { field: "warehouseId", value: warehouseId },
      { field: "metric", value: metric },
      { field: "subjectKey", value: key.value },
    ])
    .unique();
}

/**
 * One bounded page of a metric's per-subject counters.
 *
 * Only occupancy needs this today. It is a page rather than a collection because
 * a warehouse has as many location counters as it has locations, and a map that
 * silently stopped at some internal limit would show an empty aisle that is full.
 */
export async function readRollupPage(
  tenantDb: TenantDocumentAccess,
  warehouseId: string,
  metric: RollupMetric,
  limit: number,
): Promise<readonly RollupDocument[]> {
  return await tenantDb
    .byIndex<RollupDocument>(ROLLUP_TABLE, ROLLUP_INDEX, [
      { field: "warehouseId", value: warehouseId },
      { field: "metric", value: metric },
    ])
    .take(limit);
}

/**
 * Move a counter, creating it if this is its first event.
 *
 * Total: there is no input for which this refuses. A mismatched subject key is
 * the one thing it cannot store, and rather than throwing into a receipt posting
 * it declines the adjustment and reports it, so the verifier finds the gap.
 */
export async function adjustRollup(
  input: RollupAdjustment,
): Promise<{ readonly applied: boolean; readonly underflow: boolean }> {
  const { tenantDb, warehouseId, metric, delta, now } = input;

  const key = subjectKeyFor(metric, input.subjectId);
  if (!key.ok) return { applied: false, underflow: false };
  if (delta === 0) return { applied: true, underflow: false };

  const existing = await tenantDb
    .byIndex<RollupDocument>(ROLLUP_TABLE, ROLLUP_INDEX, [
      { field: "warehouseId", value: warehouseId },
      { field: "metric", value: metric },
      { field: "subjectKey", value: key.value },
    ])
    .unique();

  const moved = applyRollupDelta(existing?.count ?? 0, delta);

  if (existing === null) {
    await tenantDb.insert(ROLLUP_TABLE, {
      warehouseId,
      metric,
      subjectKey: key.value,
      count: moved.next,
      updatedAt: now,
      ...(moved.underflow ? { underflowAt: now } : {}),
    });
    return { applied: true, underflow: moved.underflow };
  }

  await tenantDb.patch(ROLLUP_TABLE, existing._id, {
    count: moved.next,
    updatedAt: now,
    ...(moved.underflow ? { underflowAt: now } : {}),
  });
  return { applied: true, underflow: moved.underflow };
}

/**
 * Set a counter to a known value.
 *
 * The verifier's repair path, and deliberately separate from `adjustRollup`: a
 * rebuild states what the number *is*, having derived it, while an adjustment
 * states how it *changed*. Collapsing the two would let a call site "fix" a
 * counter it had not recomputed.
 */
export async function setRollup(input: {
  readonly tenantDb: TenantDocumentAccess;
  readonly warehouseId: string;
  readonly metric: RollupMetric;
  readonly subjectId?: string | undefined;
  readonly count: number;
  readonly now: number;
}): Promise<boolean> {
  const key = subjectKeyFor(input.metric, input.subjectId);
  if (!key.ok) return false;

  const existing = await input.tenantDb
    .byIndex<RollupDocument>(ROLLUP_TABLE, ROLLUP_INDEX, [
      { field: "warehouseId", value: input.warehouseId },
      { field: "metric", value: input.metric },
      { field: "subjectKey", value: key.value },
    ])
    .unique();

  if (existing === null) {
    await input.tenantDb.insert(ROLLUP_TABLE, {
      warehouseId: input.warehouseId,
      metric: input.metric,
      subjectKey: key.value,
      count: input.count,
      updatedAt: input.now,
    });
    return true;
  }

  // The underflow marker is cleared here and only here: a rebuild is the one
  // event that makes a previously suspect number trustworthy again.
  await input.tenantDb.replace(ROLLUP_TABLE, existing._id, {
    warehouseId: input.warehouseId,
    metric: input.metric,
    subjectKey: key.value,
    count: input.count,
    updatedAt: input.now,
  });
  return true;
}
