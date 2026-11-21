import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { createTenantDocumentAccess } from "../lib/tenantDb";
import { createMutationTenantStorage } from "../lib/tenantStorage";
import { normalizeCustomerName } from "../model/customers/customers";
import {
  resolveExactCustomerMatch,
  type ResolvedExactCustomerMatch,
} from "./matching";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;

/**
 * Bounded, resumable customer-link backfill for historical job scans in one
 * warehouse. Run with `{ warehouseId, dryRun: true }` first to inspect matched,
 * ambiguous, archived and unmatched counts, then run with `dryRun: false` and
 * pass `continueCursor` back in as `cursor` until `isDone` is true.
 *
 * Skips voided scans and any row that already carries a customer link or an
 * explicit link decision (`AUTO`, `MANUAL`, or `UNLINKED`).
 */
export const backfillJobScanCustomers = internalMutation({
  args: {
    warehouseId: v.id("warehouses"),
    dryRun: v.boolean(),
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    dryRun: v.boolean(),
    matched: v.number(),
    ambiguous: v.number(),
    archived: v.number(),
    unmatched: v.number(),
    skippedVoided: v.number(),
    skippedDecided: v.number(),
    skippedBlank: v.number(),
    updated: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? DEFAULT_BATCH_SIZE;
    if (
      !Number.isInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > MAX_BATCH_SIZE
    ) {
      throw new Error(
        `batchSize must be an integer from 1 to ${MAX_BATCH_SIZE}`,
      );
    }

    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse) throw new Error("Warehouse not found");

    const requestId = `customer-scan-backfill:${args.warehouseId}:${args.cursor ?? "start"}`;
    const tenantDb = createTenantDocumentAccess(
      { orgId: warehouse.orgId, requestId },
      createMutationTenantStorage(ctx, requestId),
    );

    const page = await ctx.db
      .query("finishedGoodsJobScans")
      .withIndex("by_orgId_warehouseId", (q) =>
        q.eq("orgId", warehouse.orgId).eq("warehouseId", args.warehouseId),
      )
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let matched = 0;
    let ambiguous = 0;
    let archived = 0;
    let unmatched = 0;
    let skippedVoided = 0;
    let skippedDecided = 0;
    let skippedBlank = 0;
    let updated = 0;

    const cache = new Map<string, ResolvedExactCustomerMatch>();
    const now = Date.now();

    for (const scan of page.page as Doc<"finishedGoodsJobScans">[]) {
      if (scan.voided) {
        skippedVoided += 1;
        continue;
      }
      if (
        scan.customerId !== undefined ||
        scan.customerLinkSource !== undefined
      ) {
        skippedDecided += 1;
        continue;
      }
      const captured = scan.customer?.trim();
      if (!captured) {
        skippedBlank += 1;
        continue;
      }
      const key = normalizeCustomerName(captured);
      if (!key) {
        skippedBlank += 1;
        continue;
      }

      let match = cache.get(key);
      if (!match) {
        match = await resolveExactCustomerMatch(tenantDb, captured);
        cache.set(key, match);
      }

      if (match.kind === "MATCHED") {
        matched += 1;
        if (!args.dryRun) {
          const nextUpdatedAt = Math.max(now, scan.updatedAt + 1);
          await tenantDb.patch("finishedGoodsJobScans", scan._id, {
            customerId: match.customerId,
            customerLinkSource: "AUTO",
            version: (scan.version ?? 1) + 1,
            updatedAt: nextUpdatedAt,
          });
          await tenantDb.insert("auditEvents", {
            occurredAt: nextUpdatedAt,
            actorKind: "SYSTEM",
            action: "customer.backfill.link",
            entityTable: "finishedGoodsJobScans",
            entityId: scan._id,
            warehouseId: args.warehouseId,
            outcome: "ALLOWED",
            requestId,
            changes: [
              { field: "customerId", to: match.customerId },
              { field: "customerLinkSource", to: "AUTO" },
            ],
          });
          updated += 1;
        }
      } else if (match.kind === "AMBIGUOUS") {
        ambiguous += 1;
      } else if (match.kind === "ARCHIVED") {
        archived += 1;
      } else {
        unmatched += 1;
      }
    }

    return {
      dryRun: args.dryRun,
      matched,
      ambiguous,
      archived,
      unmatched,
      skippedVoided,
      skippedDecided,
      skippedBlank,
      updated,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
