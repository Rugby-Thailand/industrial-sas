import { v } from "convex/values";

import {
  compareRollup,
  summarizeRollups,
  SITE_SUBJECT,
  type RollupMetric,
} from "../model/reporting/rollup";
import { MAX_JOB_PAGE_SIZE } from "../model/inventory/jobPage";
import { readRollup, setRollup } from "../lib/rollupStore";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import type { TenantDocumentAccess, TenantOrgId } from "../lib/tenantDb";
import { rollupMetric } from "../lib/validators";
import { refusal, writeErrorValidator } from "../lib/writeEnvelope";

export const MAX_VERIFY_ROWS = MAX_JOB_PAGE_SIZE;

interface CountableRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
}

async function countBounded(
  tenantDb: TenantDocumentAccess,
  table: Parameters<TenantDocumentAccess["byIndex"]>[0],
  index: string,
  equality: readonly { readonly field: string; readonly value: unknown }[],
): Promise<{ readonly count: number; readonly capped: boolean }> {
  const rows = await tenantDb
    .byIndex<CountableRow>(table, index, equality)
    .take(MAX_VERIFY_ROWS);

  return { count: rows.length, capped: rows.length === MAX_VERIFY_ROWS };
}

async function deriveMetric(
  tenantDb: TenantDocumentAccess,
  warehouseId: string,
  metric: Exclude<RollupMetric, "LOCATION_OCCUPANCY">,
): Promise<{ readonly count: number; readonly capped: boolean }> {
  switch (metric) {
    case "RECEIPTS_OPENED":
      return await countBounded(
        tenantDb,
        "receipts",
        "by_orgId_warehouseId_occurredAt",
        [{ field: "warehouseId", value: warehouseId }],
      );
    case "RECEIPT_LINES_POSTED":
      // Counted through the receipts of this site, because a receipt line has no
      // warehouse of its own — it belongs to the receipt that holds it.
      return await countReceiptLines(tenantDb, warehouseId);
    case "QC_PENDING":
      return await countBounded(
        tenantDb,
        "qcInspections",
        "by_orgId_warehouseId_status",
        [
          { field: "warehouseId", value: warehouseId },
          { field: "status", value: "OPEN" },
        ],
      );
    case "QC_PARKED":
      return await countBounded(
        tenantDb,
        "qcInspections",
        "by_orgId_warehouseId_status",
        [
          { field: "warehouseId", value: warehouseId },
          { field: "status", value: "PENDING_APPROVAL" },
        ],
      );
    case "PUTAWAY_READY":
      return await countBounded(
        tenantDb,
        "putawayTasks",
        "by_orgId_warehouseId_status",
        [
          { field: "warehouseId", value: warehouseId },
          { field: "status", value: "READY" },
        ],
      );
    case "PUTAWAY_CLAIMED":
      return await countBounded(
        tenantDb,
        "putawayTasks",
        "by_orgId_warehouseId_status",
        [
          { field: "warehouseId", value: warehouseId },
          { field: "status", value: "CLAIMED" },
        ],
      );
  }
}

async function countReceiptLines(
  tenantDb: TenantDocumentAccess,
  warehouseId: string,
): Promise<{ readonly count: number; readonly capped: boolean }> {
  const receipts = await tenantDb
    .byIndex<CountableRow>("receipts", "by_orgId_warehouseId_occurredAt", [
      { field: "warehouseId", value: warehouseId },
    ])
    .take(MAX_VERIFY_ROWS);

  let count = 0;
  for (const receipt of receipts) {
    const lines = await countBounded(
      tenantDb,
      "receiptLines",
      "by_orgId_receiptId",
      [{ field: "receiptId", value: receipt._id }],
    );
    count += lines.count;
    // A lower bound cannot disprove a counter, so it is not compared.
    if (lines.capped) return { count, capped: true };
  }

  return { count, capped: receipts.length === MAX_VERIFY_ROWS };
}

const comparisonValidator = v.object({
  metric: rollupMetric,
  subjectKey: v.string(),
  stored: v.number(),
  derived: v.number(),
  drifted: v.boolean(),
});

export const verifyRollups = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.object({
    ok: v.literal(true),
    checked: v.number(),
    balanced: v.boolean(),
    drifted: v.array(comparisonValidator),
    /** True when a derivation hit its read budget and is a lower bound. */
    incomplete: v.boolean(),
  }),
  permissionCode: "reporting.jobRun.read",
  target: { table: "operationsRollups" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const metrics = [
      "RECEIPTS_OPENED",
      "RECEIPT_LINES_POSTED",
      "QC_PENDING",
      "QC_PARKED",
      "PUTAWAY_READY",
      "PUTAWAY_CLAIMED",
    ] as const;

    const comparisons = [];
    let incomplete = false;

    for (const metric of metrics) {
      const derived = await deriveMetric(
        ctx.tenantDb,
        args.warehouseId,
        metric,
      );
      if (derived.capped) {
        // A lower bound cannot disprove a counter, so it is not compared.
        incomplete = true;
        continue;
      }
      const stored = await readRollup(ctx.tenantDb, args.warehouseId, metric);
      comparisons.push(
        compareRollup(metric, SITE_SUBJECT, stored?.count ?? 0, derived.count),
      );
    }

    const summary = summarizeRollups(comparisons);
    return {
      ok: true as const,
      checked: summary.checked,
      balanced: summary.balanced,
      drifted: summary.drifted.map((entry) => ({
        ...entry,
        metric: entry.metric as never,
      })),
      incomplete,
    };
  },
});

export const repairRollup = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    metric: rollupMetric,
  },
  returns: v.union(
    v.object({
      written: v.literal(true),
      metric: rollupMetric,
      from: v.number(),
      to: v.number(),
    }),
    v.object({ written: v.literal(false), error: writeErrorValidator }),
  ),
  permissionCode: "reporting.export.execute",
  target: { table: "operationsRollups" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    if (args.metric === "LOCATION_OCCUPANCY") {
      return refusal({ code: "METRIC_NOT_REPAIRABLE_HERE" });
    }

    const derived = await deriveMetric(
      ctx.tenantDb,
      args.warehouseId,
      args.metric,
    );
    if (derived.capped) return refusal({ code: "DERIVATION_INCOMPLETE" });

    const before = await readRollup(
      ctx.tenantDb,
      args.warehouseId,
      args.metric,
    );
    await setRollup({
      tenantDb: ctx.tenantDb,
      warehouseId: args.warehouseId,
      metric: args.metric,
      count: derived.count,
      now: Date.now(),
    });

    return {
      written: true as const,
      metric: args.metric,
      from: before?.count ?? 0,
      to: derived.count,
    };
  },
});

export const maxVerifyRows = MAX_VERIFY_ROWS;
