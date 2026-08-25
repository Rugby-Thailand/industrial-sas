import {
  applyRollupDelta,
  subjectKeyFor,
  type RollupMetric,
} from "../model/reporting/rollup";

import type { TenantDocumentAccess, TenantOrgId } from "./tenantDb";

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

  readonly subjectId?: string | undefined;
  readonly delta: number;

  readonly now: number;
}

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

  await input.tenantDb.replace(ROLLUP_TABLE, existing._id, {
    warehouseId: input.warehouseId,
    metric: input.metric,
    subjectKey: key.value,
    count: input.count,
    updatedAt: input.now,
  });
  return true;
}
