import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";
import { inventoryWriter } from "../lib/inventoryWriter";
import { createTenantDocumentAccess } from "../lib/tenantDb";
import { createMutationTenantStorage } from "../lib/tenantStorage";
import { normalizeCustomerName } from "../model/customers/customers";
import { recordCustomerJobLink } from "./activitySummary";
import {
  autoLinkPaused,
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
 * Skips any row that already carries a customer link or an explicit link
 * decision (`AUTO`, `MANUAL`, or `UNLINKED`). Apply classifies every other row,
 * which drains the legacy review stream: blank and voided tickets are stamped
 * `customerReviewPending: false` (retired, captured text untouched) and
 * unresolved named tickets `true`. Classification stamps leave `version`
 * alone so open ticket editors stay current; only new links bump it.
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
    if (!args.dryRun && autoLinkPaused())
      throw new Error("CUSTOMER_AUTO_LINK_PAUSED");
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
    const sourceDb = createTenantDocumentAccess(
      { orgId: warehouse.orgId, requestId },
      createMutationTenantStorage(ctx, requestId),
    );

    const writer = inventoryWriter({
      db: sourceDb,
      orgId: warehouse.orgId,
      scheduler: ctx.scheduler,
    });
    const tenantDb = writer.db;

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

    const classify = async (
      scan: Doc<"finishedGoodsJobScans">,
      state: boolean,
    ) => {
      if (args.dryRun || scan.customerReviewPending === state) return;
      await tenantDb.patch("finishedGoodsJobScans", scan._id, {
        customerReviewPending: state,
      });
      updated += 1;
    };

    for (const scan of page.page as Doc<"finishedGoodsJobScans">[]) {
      if (
        scan.customerId !== undefined ||
        scan.customerLinkSource !== undefined
      ) {
        skippedDecided += 1;
        continue;
      }
      const captured = scan.customer?.trim();
      const key = captured ? normalizeCustomerName(captured) : "";
      if (scan.voided || !captured || !key) {
        if (scan.voided) skippedVoided += 1;
        else skippedBlank += 1;
        // Blank tickets stay editable: naming one later re-runs auto-link.
        await classify(scan, false);
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
            customerReviewPending: undefined,
            version: (scan.version ?? 1) + 1,
            updatedAt: nextUpdatedAt,
          });
          await recordCustomerJobLink(
            tenantDb,
            args.warehouseId,
            match.customerId,
            {
              jobScanId: scan._id,
              factoryOrder: scan.factoryOrder,
              createdAt: scan.createdAt,
            },
          );
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
      } else {
        if (match.kind === "AMBIGUOUS") {
          ambiguous += 1;
        } else if (match.kind === "ARCHIVED") {
          archived += 1;
        } else {
          unmatched += 1;
        }
        await classify(scan, true);
      }
    }

    await writer.flush();
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

const DEFAULT_WAREHOUSE_PAGE = 50;

/**
 * Rollout inventory: every warehouse (all organizations, any status) with
 * whether it still holds legacy job scans the backfill has not classified.
 * Page with `cursor` until `isDone`; run the backfill for each warehouse whose
 * `legacyRemaining` is true, then list again to confirm all are drained.
 */
export const listCustomerBackfillWarehouses = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    numItems: v.optional(v.number()),
  },
  returns: v.object({
    warehouses: v.array(
      v.object({
        warehouseId: v.id("warehouses"),
        orgId: v.string(),
        code: v.string(),
        name: v.string(),
        status: v.string(),
        legacyRemaining: v.boolean(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const numItems = args.numItems ?? DEFAULT_WAREHOUSE_PAGE;
    if (
      !Number.isInteger(numItems) ||
      numItems < 1 ||
      numItems > MAX_BATCH_SIZE
    )
      throw new Error(
        `numItems must be an integer from 1 to ${MAX_BATCH_SIZE}`,
      );
    const page = await ctx.db
      .query("warehouses")
      .paginate({ cursor: args.cursor ?? null, numItems });
    const warehouses = await Promise.all(
      page.page.map(async (warehouse) => {
        const legacy = await ctx.db
          .query("finishedGoodsJobScans")
          .withIndex(
            "by_orgId_warehouseId_linkSource_reviewPending_createdAt",
            (q) =>
              q
                .eq("orgId", warehouse.orgId)
                .eq("warehouseId", warehouse._id)
                .eq("customerLinkSource", undefined)
                .eq("customerReviewPending", undefined),
          )
          .first();
        return {
          warehouseId: warehouse._id,
          orgId: String(warehouse.orgId),
          code: warehouse.code,
          name: warehouse.name,
          status: String(warehouse.status),
          legacyRemaining: legacy !== null,
        };
      }),
    );
    return {
      warehouses,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
