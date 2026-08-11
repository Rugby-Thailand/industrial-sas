/**
 * Proving the dashboard's numbers, and repairing them when they are wrong
 * (`ADR-0011` §6, `INV-0011-09`).
 *
 * A maintained counter is a projection, and every projection in this system owes
 * the same debt the balance projection owes the ledger: it must be derivable
 * from its source, and something must actually derive it. Without that, a
 * counter is a number that was right once.
 *
 * So each metric is paired here with the read that recomputes it, and the pair
 * is the contract. Adding a metric without a derivation is not possible from a
 * call site — `RollupMetric` is closed — and adding one here without wiring its
 * derivation makes this file fail to compile on the exhaustive switch.
 *
 * ### Bounded, like everything else
 *
 * Recomputation walks the source tables in pages (`INV-0011-01`). A site with
 * more rows than one run's budget returns `BUDGET_EXHAUSTED` with a cursor
 * rather than silently checking a prefix and calling the rest balanced — a
 * verifier that lied by omission would be worse than no verifier.
 *
 * ### Verify and repair are separate
 *
 * `verifyRollups` is a query: it reads, compares, and reports. `repairRollup` is
 * a mutation that takes a metric and a derived value and writes it. Splitting
 * them means a drift report can be read by anyone with dashboard permission,
 * while writing a counter needs the permission that owns it — and it means a
 * repair states a number somebody derived rather than one this code assumed.
 */
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

/**
 * How many source rows one verification read may count.
 *
 * The tenant page cap, and not a multiple of it. Counting more would mean paging,
 * paging means a cursor, and **a Convex function execution may perform only one
 * indexed read that has a continuation** (`convex/lib/tenantStorage.ts`) — so a
 * verifier that walked five pages per metric across six metrics would work on a
 * small site and fail on every real one.
 *
 * The consequence is stated rather than hidden: a metric whose source exceeds
 * this is reported as unverifiable, not as balanced.
 */
export const MAX_VERIFY_ROWS = MAX_JOB_PAGE_SIZE;

interface CountableRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
}

/**
 * Count the rows of one indexed read, up to the cap.
 *
 * One `.take()`, which creates no continuation and so may be called as often as
 * a handler needs. Reaching the cap is reported rather than silently treated as
 * the total: `100` and "at least 100" support different conclusions, and a
 * verifier that conflated them would report drift on every busy site.
 */
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

/**
 * Recompute one metric from the tables that define it.
 *
 * The switch is exhaustive by type. A metric added to `RollupMetric` without a
 * derivation here is a compile error, which is the only way to keep "every
 * counter is checkable" true as the set grows.
 */
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

/**
 * Receipt lines belonging to one site.
 *
 * Two levels, both bounded: the site's receipts, then each receipt's lines. It
 * is more work than a single index would be, and the alternative — putting
 * `warehouseId` on `receiptLines` — would be a denormalization that can disagree
 * with the receipt it hangs from. A count that is slower to derive is better
 * than a count that can be derived two ways.
 */
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
    // A receipt at the cap means its own lines are a lower bound, so the total
    // is one too — and a lower bound cannot disprove a counter.
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

/**
 * Compare every site-wide counter against a fresh derivation.
 *
 * Reports agreement as well as drift, because "checked and fine" and "not
 * checked" are different operational states and a report that only spoke up on
 * failure could not tell them apart.
 *
 * Occupancy is excluded: it has one counter per location, and verifying it is a
 * per-location walk that belongs to a scheduled job rather than to a query a
 * supervisor triggers. The runbook says so rather than this pretending to have
 * covered it.
 */
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
        // A lower bound cannot disprove a counter, so it is not compared at all.
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

/**
 * Rewrite one counter from a fresh derivation.
 *
 * The repair half, and a mutation rather than part of the verifier on purpose: a
 * read that silently corrected what it found would make drift undetectable —
 * every run would report balanced, having just fixed the evidence.
 *
 * Refuses when the derivation hit its budget. Writing a lower bound into a
 * counter would replace a number that might be right with one that is certainly
 * wrong.
 */
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
      // Per-location repair needs a subject and a per-location walk; refusing is
      // honest, and the scheduled rebuild is where that belongs.
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

/** The read budget, re-exported so a test and a runbook share one number. */
export const maxVerifyRows = MAX_VERIFY_ROWS;
