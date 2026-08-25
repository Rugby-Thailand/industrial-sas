/** Production acknowledgement queue created when a newer design is released. */
import { v } from "convex/values";

import { updateMasterDataRow } from "../lib/masterDataStore";
import {
  listArgs,
  pageOf,
  pageOptions,
  pageRefusal,
  pageRequestOf,
  pageResult,
} from "../lib/listEnvelope";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";

interface ImpactDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly masterCardId: string;
  readonly warehouseId: string;
  readonly fromRevisionId: string;
  readonly toRevisionId: string;
  readonly productionOrderId: string;
  readonly productionOrderNumber: string;
  readonly productionOrderStatus: string;
  readonly severity: "NO_IMPACT" | "REVIEW_REQUIRED" | "BLOCKING";
  readonly changedFields: readonly string[];
  readonly categories: readonly string[];
  readonly status: "OPEN" | "ACKNOWLEDGED";
  readonly createdByUserId: string;
  readonly createdAt: number;
  readonly acknowledgedByUserId?: string;
  readonly acknowledgedAt?: number;
  readonly acknowledgementNote?: string;
}

const impactStatus = v.union(v.literal("OPEN"), v.literal("ACKNOWLEDGED"));
const MAX_NOTE_LENGTH = 1_000;

export const listDesignChangeImpacts = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    status: v.optional(impactStatus),
    ...listArgs,
  },
  returns: pageOf(
    v.object({
      designChangeImpactId: v.id("designChangeImpacts"),
      warehouseId: v.id("warehouses"),
      masterCardId: v.id("masterCards"),
      fromRevisionId: v.id("masterCardRevisions"),
      toRevisionId: v.id("masterCardRevisions"),
      productionOrderId: v.id("productionOrders"),
      productionOrderNumber: v.string(),
      productionOrderStatus: v.string(),
      severity: v.union(
        v.literal("NO_IMPACT"),
        v.literal("REVIEW_REQUIRED"),
        v.literal("BLOCKING"),
      ),
      changedFields: v.array(v.string()),
      categories: v.array(v.string()),
      status: impactStatus,
      createdByUserId: v.id("users"),
      createdAt: v.number(),
      acknowledgedByUserId: v.optional(v.id("users")),
      acknowledgedAt: v.optional(v.number()),
      acknowledgementNote: v.optional(v.string()),
    }),
  ),
  permissionCode: "production.order.read",
  target: { table: "designChangeImpacts" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);
    const page = await ctx.tenantDb
      .byIndex<ImpactDocument>(
        "designChangeImpacts",
        "by_orgId_warehouseId_status_createdAt",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "status", value: args.status ?? "OPEN" },
        ],
      )
      .page(pageOptions(request.value));
    return pageResult(
      page.page.map((row) => ({
        designChangeImpactId: row._id as never,
        warehouseId: row.warehouseId as never,
        masterCardId: row.masterCardId as never,
        fromRevisionId: row.fromRevisionId as never,
        toRevisionId: row.toRevisionId as never,
        productionOrderId: row.productionOrderId as never,
        productionOrderNumber: row.productionOrderNumber,
        productionOrderStatus: row.productionOrderStatus,
        severity: row.severity,
        changedFields: [...row.changedFields],
        categories: [...row.categories],
        status: row.status,
        createdByUserId: row.createdByUserId as never,
        createdAt: row.createdAt,
        ...(row.acknowledgedByUserId === undefined
          ? {}
          : { acknowledgedByUserId: row.acknowledgedByUserId as never }),
        ...(row.acknowledgedAt === undefined
          ? {}
          : { acknowledgedAt: row.acknowledgedAt }),
        ...(row.acknowledgementNote === undefined
          ? {}
          : { acknowledgementNote: row.acknowledgementNote }),
      })),
      page,
    );
  },
});

export const acknowledgeDesignChangeImpact = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    designChangeImpactId: v.id("designChangeImpacts"),
    note: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "production.order.manage",
  target: {
    table: "designChangeImpacts",
    id: ({ designChangeImpactId }) => designChangeImpactId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const impact = await ctx.tenantDb.get<ImpactDocument>(
      "designChangeImpacts",
      args.designChangeImpactId,
    );
    if (impact === null) {
      return refusal({ code: "NOT_FOUND", table: "designChangeImpacts" });
    }
    if (impact.warehouseId !== args.warehouseId) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "warehouseId" });
    }
    if (impact.status !== "OPEN") {
      return refusal({
        code: "ILLEGAL_TRANSITION",
        field: "status",
        reason: "IMPACT_ALREADY_ACKNOWLEDGED",
        status: impact.status,
      });
    }
    const note = args.note.trim();
    if (note.length < 10 || note.length > MAX_NOTE_LENGTH) {
      return refusal({
        code: "FIELD_INVALID",
        field: "note",
        reason: note.length < 10 ? "TOO_SHORT" : "TOO_LONG",
      });
    }
    const context = writeContextOf(ctx, {
      table: "designChangeImpacts",
      operation: "engineering.changeImpact.acknowledge",
      requestId: args.requestId,
    });
    const outcome = await updateMasterDataRow({
      ...context,
      documentId: args.designChangeImpactId,
      fingerprint: {
        operation: "engineering.changeImpact.acknowledge",
        requestId: args.requestId,
        designChangeImpactId: args.designChangeImpactId,
        note,
      },
      uniqueness: [],
      patch: {
        status: "ACKNOWLEDGED",
        acknowledgedByUserId: context.actorUserId,
        acknowledgedAt: context.now,
        acknowledgementNote: note,
      },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});
