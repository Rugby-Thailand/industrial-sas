import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { postLedgerTransaction } from "../lib/inventoryLedgerStore";
import {
  listArgs,
  pageOf,
  pageOptions,
  pageRefusal,
  pageRequestOf,
  pageResult,
} from "../lib/listEnvelope";
import type { LedgerTransactionDraft } from "../model/inventory/ledgerTransaction";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { adjustRollup } from "../lib/rollupStore";
import { storageLocationBreadcrumb } from "../lib/storageAddressStore";
import { refusal } from "../lib/writeEnvelope";
import { putawayTaskStatus } from "../lib/validators";
import { MAX_JOB_PAGE_SIZE } from "../model/inventory/jobPage";
import {
  assertConfirmable,
  decideClaim,
  recommendPutaway,
  validateOverride,
  type PutawayCandidate,
  type PutawayRecommendation,
} from "../model/inbound/putawayScoring";

export const PUTAWAY_OPERATIONS = Object.freeze({
  claim: "putaway.task.claim",
  confirm: "putaway.task.confirm",
});

export const MAX_PUTAWAY_CANDIDATES = 50;

interface TaskDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly receiptLineId: string;
  readonly itemId: string;
  readonly lotId?: string;
  readonly handlingUnitId?: string;
  readonly baseMinorUnits: number;
  readonly fromLocationId: string;
  readonly status: string;
  readonly claimedByUserId?: string;
  readonly recommendedLocationId?: string;
  readonly recommendationTrace?: string;
}

interface LocationDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly code: string;
  readonly locationType: string;
  readonly status: string;
}

interface ReceiptLineDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly stockStatus: string;
}

interface ItemDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly baseUom: string;
}

type StorageBuildingDocument = Doc<"storageBuildings">;
type StorageZoneDocument = Doc<"storageZones">;

async function candidatesFor(
  ctx: TenantFunctionContext,
  task: TaskDocument,
): Promise<readonly PutawayCandidate[]> {
  const locations = await ctx.tenantDb
    .byIndex<LocationDocument>(
      "locations",
      "by_orgId_warehouseId_status_code",
      [
        { field: "warehouseId", value: task.warehouseId },
        { field: "status", value: "ACTIVE" },
      ],
    )
    .take(MAX_PUTAWAY_CANDIDATES);

  return await Promise.all(
    locations.map(async (location) => {
      let prohibited = false;
      if (location.locationType === "FLOOR_BLOCK") {
        const zone = await ctx.tenantDb
          .byIndex<StorageZoneDocument>("storageZones", "by_orgId_locationId", [
            { field: "locationId", value: location._id },
          ])
          .unique();
        if (zone !== null) {
          const building = await ctx.tenantDb.get<StorageBuildingDocument>(
            "storageBuildings",
            zone.buildingId,
          );
          prohibited =
            zone.status !== "ACTIVE" || building?.status !== "ACTIVE";
        }
      }
      return {
        locationId: location._id,
        code:
          (await storageLocationBreadcrumb(ctx.tenantDb, location._id)) ??
          location.code,
        locationType: location.locationType,
        status: location.status,
        ...(prohibited ? { prohibited } : {}),
      };
    }),
  );
}

const componentValidator = v.object({
  name: v.string(),
  weight: v.number(),
  points: v.number(),
});

const recommendationValidator = v.union(
  v.object({
    ok: v.literal(true),
    ranked: v.array(
      v.object({
        locationId: v.id("locations"),
        code: v.string(),
        score: v.number(),
        components: v.array(componentValidator),
        viaOverflow: v.boolean(),
      }),
    ),
    rejected: v.array(
      v.object({
        locationId: v.id("locations"),
        code: v.string(),
        reason: v.string(),
      }),
    ),
    filtersApplied: v.array(v.string()),
  }),
  v.object({ ok: v.literal(false), error: v.object({ code: v.string() }) }),
);

export const recommendPutawayLocations = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    putawayTaskId: v.id("putawayTasks"),
  },
  returns: recommendationValidator,
  permissionCode: "putaway.task.read",
  target: { table: "putawayTasks", id: ({ putawayTaskId }) => putawayTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const task = await ctx.tenantDb.get<TaskDocument>(
      "putawayTasks",
      args.putawayTaskId,
    );
    if (task === null) {
      return { ok: false as const, error: { code: "NOT_FOUND" } };
    }

    // Validate against the stored recommendation the operator actually saw.
    if (task.recommendationTrace !== undefined) {
      try {
        const stored = JSON.parse(
          task.recommendationTrace,
        ) as PutawayRecommendation;
        return {
          ok: true as const,
          ranked: stored.ranked.map((entry) => ({
            locationId: entry.locationId as never,
            code: entry.code,
            score: entry.score,
            components: entry.components.map((component) => ({ ...component })),
            viaOverflow: entry.viaOverflow,
          })),
          rejected: stored.rejected.map((entry) => ({
            locationId: entry.locationId as never,
            code: entry.code,
            reason: entry.reason,
          })),
          filtersApplied: [...stored.filtersApplied],
        };
      } catch {
        // A trace that will not parse is corruption, not an empty warehouse.
        return {
          ok: false as const,
          error: { code: "RECOMMENDATION_UNREADABLE" },
        };
      }
    }

    const line = await ctx.tenantDb.get<ReceiptLineDocument>(
      "receiptLines",
      task.receiptLineId,
    );
    if (line === null) {
      return { ok: false as const, error: { code: "REFERENCE_NOT_FOUND" } };
    }

    const recommendation = recommendPutaway({
      demand: {
        itemId: task.itemId,
        minorUnits: task.baseMinorUnits,
        stockStatus: line.stockStatus,
        ...(task.lotId === undefined ? {} : { lotId: task.lotId }),
      },
      candidates: await candidatesFor(ctx, task),
    });

    if (!recommendation.ok) {
      return { ok: false as const, error: { code: recommendation.error.code } };
    }
    return {
      ok: true as const,
      ranked: recommendation.value.ranked.map((entry) => ({
        locationId: entry.locationId as never,
        code: entry.code,
        score: entry.score,
        components: entry.components.map((component) => ({ ...component })),
        viaOverflow: entry.viaOverflow,
      })),
      rejected: recommendation.value.rejected.map((entry) => ({
        locationId: entry.locationId as never,
        code: entry.code,
        reason: entry.reason,
      })),
      filtersApplied: [...recommendation.value.filtersApplied],
    };
  },
});

const claimOutcomeValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),

    alreadyHeld: v.boolean(),
    recommendedLocationId: v.optional(v.id("locations")),
  }),
  v.object({
    written: v.literal(false),
    error: v.object({
      code: v.string(),
      field: v.optional(v.string()),
      reason: v.optional(v.string()),
      table: v.optional(v.string()),
      status: v.optional(v.string()),
      requestId: v.optional(v.string()),
    }),
  }),
);

export const claimPutawayTask = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    putawayTaskId: v.id("putawayTasks"),
  },
  returns: claimOutcomeValidator,
  permissionCode: "putaway.task.claim",
  target: { table: "putawayTasks", id: ({ putawayTaskId }) => putawayTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const task = await ctx.tenantDb.get<TaskDocument>(
      "putawayTasks",
      args.putawayTaskId,
    );

    if (task === null || task.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "putawayTasks" });
    }

    const decision = decideClaim({
      status: task.status as "READY",
      actorUserId: ctx.tenant.actor._id,
      ...(task.claimedByUserId === undefined
        ? {}
        : { claimedByUserId: task.claimedByUserId }),
    });
    if (!decision.ok) return refusal(decision.error);

    if (decision.value.alreadyHeld) {
      return {
        written: true as const,
        documentId: args.putawayTaskId,
        replayed: true,
        alreadyHeld: true,
        ...(task.recommendedLocationId === undefined
          ? {}
          : { recommendedLocationId: task.recommendedLocationId as never }),
      };
    }

    const line = await ctx.tenantDb.get<ReceiptLineDocument>(
      "receiptLines",
      task.receiptLineId,
    );
    if (line === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "receiptLineId" });
    }

    const recommendation = recommendPutaway({
      demand: {
        itemId: task.itemId,
        minorUnits: task.baseMinorUnits,
        stockStatus: line.stockStatus,
        ...(task.lotId === undefined ? {} : { lotId: task.lotId }),
      },
      candidates: await candidatesFor(ctx, task),
    });
    if (!recommendation.ok) return refusal(recommendation.error);

    const top = recommendation.value.ranked[0];

    await ctx.tenantDb.patch("putawayTasks", args.putawayTaskId, {
      status: "CLAIMED",
      claimedByUserId: ctx.tenant.actor._id,
      claimedAt: Date.now(),
      // The trace is the audit evidence for the advice, stored as it was given.
      recommendationTrace: JSON.stringify(recommendation.value),
      ...(top === undefined ? {} : { recommendedLocationId: top.locationId }),
    });

    await moveTaskCounters(ctx, args.warehouseId, { ready: -1, claimed: 1 });

    return {
      written: true as const,
      documentId: args.putawayTaskId,
      replayed: false,
      alreadyHeld: false,
      ...(top === undefined
        ? {}
        : { recommendedLocationId: top.locationId as never }),
    };
  },
});

const confirmOutcomeValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),
    transactionId: v.string(),

    isOverride: v.boolean(),
  }),
  v.object({
    written: v.literal(false),
    error: v.object({
      code: v.string(),
      field: v.optional(v.string()),
      reason: v.optional(v.string()),
      table: v.optional(v.string()),
      status: v.optional(v.string()),
      requestId: v.optional(v.string()),
    }),
  }),
);

export const confirmPutaway = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    putawayTaskId: v.id("putawayTasks"),
    chosenLocationId: v.id("locations"),
    overrideReasonCodeId: v.optional(v.id("reasonCodes")),
  },
  returns: confirmOutcomeValidator,
  permissionCode: "putaway.task.confirm",
  target: { table: "putawayTasks", id: ({ putawayTaskId }) => putawayTaskId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const task = await ctx.tenantDb.get<TaskDocument>(
      "putawayTasks",
      args.putawayTaskId,
    );

    if (task === null || task.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "putawayTasks" });
    }

    const holder = assertConfirmable({
      status: task.status as "CLAIMED",
      actorUserId: ctx.tenant.actor._id,
      ...(task.claimedByUserId === undefined
        ? {}
        : { claimedByUserId: task.claimedByUserId }),
    });
    if (!holder.ok) return refusal(holder.error);

    if (task.recommendationTrace === undefined) {
      return refusal({
        code: "RECOMMENDATION_MISSING",
        field: "putawayTaskId",
      });
    }

    let recommendation: PutawayRecommendation;
    try {
      recommendation = JSON.parse(
        task.recommendationTrace,
      ) as PutawayRecommendation;
    } catch {
      return refusal({ code: "RECOMMENDATION_UNREADABLE" });
    }

    if (args.overrideReasonCodeId !== undefined) {
      const reason = await ctx.tenantDb.get(
        "reasonCodes",
        args.overrideReasonCodeId,
      );
      if (reason === null) {
        return refusal({
          code: "REFERENCE_NOT_FOUND",
          field: "overrideReasonCodeId",
        });
      }
    }

    const override = validateOverride({
      recommendation,
      chosenLocationId: args.chosenLocationId,
      ...(args.overrideReasonCodeId === undefined
        ? {}
        : { reasonCodeId: args.overrideReasonCodeId }),
    });
    if (!override.ok) return refusal(override.error);

    const line = await ctx.tenantDb.get<ReceiptLineDocument>(
      "receiptLines",
      task.receiptLineId,
    );
    if (line === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "receiptLineId" });
    }
    const item = await ctx.tenantDb.get<ItemDocument>("items", task.itemId);
    if (item === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "itemId" });
    }

    const orgId = ctx.tenant.organization._id;
    const now = Date.now();
    const bucketAt = (locationId: string) => ({
      orgId,
      warehouseId: args.warehouseId,
      itemId: task.itemId,
      location: { kind: "PHYSICAL" as const, locationId },
      stockStatus: line.stockStatus,
      ...(task.lotId === undefined ? {} : { lotId: task.lotId }),
      ...(task.handlingUnitId === undefined
        ? {}
        : { handlingUnitId: task.handlingUnitId }),
    });

    const draft = {
      orgId,
      warehouseId: args.warehouseId,
      type: "PUTAWAY",
      operation: PUTAWAY_OPERATIONS.confirm,
      requestId: args.requestId,
      actorUserId: ctx.tenant.actor._id,
      occurredAt: now,
      source: { type: "PUTAWAY_TASK", id: args.putawayTaskId },
      lines: [
        {
          bucket: bucketAt(task.fromLocationId),
          quantity: { uom: item.baseUom, minorUnits: -task.baseMinorUnits },
        },
        {
          bucket: bucketAt(args.chosenLocationId),
          quantity: { uom: item.baseUom, minorUnits: task.baseMinorUnits },
        },
      ],
    } as unknown as LedgerTransactionDraft;

    const posted = await postLedgerTransaction({
      tenantDb: ctx.tenantDb,
      tenant: ctx.tenant,
      permissionCode: ctx.permission.code,
      now,
      draft,
    });
    if (!posted.ok) {
      return refusal(posted.error as unknown as { code: string });
    }

    await ctx.tenantDb.patch("putawayTasks", args.putawayTaskId, {
      status: "CONFIRMED",
      chosenLocationId: args.chosenLocationId,
      transactionId: posted.value.result.transactionId,
      ...(args.overrideReasonCodeId === undefined
        ? {}
        : { overrideReasonCodeId: args.overrideReasonCodeId }),
    });

    await moveTaskCounters(ctx, args.warehouseId, { claimed: -1 });

    // The pallet is where it was put. The one-location invariant is a stored
    // field, so it has to be maintained here (`INV-0005-04`).
    if (task.handlingUnitId !== undefined) {
      await ctx.tenantDb.patch("handlingUnits", task.handlingUnitId, {
        currentLocationId: args.chosenLocationId,
      });
    }

    return {
      written: true as const,
      documentId: args.putawayTaskId,
      replayed: posted.value.replayed,
      transactionId: posted.value.result.transactionId,
      isOverride: override.value.isOverride,
    };
  },
});

const taskValidator = v.object({
  putawayTaskId: v.id("putawayTasks"),
  warehouseId: v.id("warehouses"),
  receiptLineId: v.id("receiptLines"),
  itemId: v.id("items"),
  lotId: v.optional(v.id("lots")),
  handlingUnitId: v.optional(v.id("handlingUnits")),
  baseMinorUnits: v.number(),
  baseUom: v.optional(v.string()),
  fromLocationId: v.id("locations"),
  status: putawayTaskStatus,
  claimedByUserId: v.optional(v.id("users")),
  recommendedLocationId: v.optional(v.id("locations")),
  chosenLocationId: v.optional(v.id("locations")),
});

export const listPutawayTasks = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    status: v.optional(putawayTaskStatus),
    ...listArgs,
  },
  returns: pageOf(taskValidator),
  permissionCode: "putaway.task.read",
  target: { table: "putawayTasks" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);

    const page = await ctx.tenantDb
      .byIndex<TaskDocument & Record<string, never>>(
        "putawayTasks",
        "by_orgId_warehouseId_status",
        [
          { field: "warehouseId", value: args.warehouseId },
          ...(args.status === undefined
            ? []
            : [{ field: "status", value: args.status }]),
        ],
      )
      .page(pageOptions(request.value));

    const baseUomByItemId = new Map<string, string | undefined>();
    for (const row of page.page) {
      const itemId = (row as unknown as Record<string, unknown>)[
        "itemId"
      ] as string;
      if (baseUomByItemId.has(itemId)) continue;
      const item = await ctx.tenantDb.get<ItemDocument>("items", itemId);
      baseUomByItemId.set(itemId, item?.baseUom);
    }

    return pageResult(
      page.page.map((row) => {
        const record = row as unknown as Record<string, unknown>;
        const optional = (name: string) =>
          record[name] === undefined ? {} : { [name]: record[name] as never };
        const baseUom = baseUomByItemId.get(record["itemId"] as string);
        return {
          putawayTaskId: row._id as never,
          warehouseId: record["warehouseId"] as never,
          receiptLineId: record["receiptLineId"] as never,
          itemId: record["itemId"] as never,
          baseMinorUnits: record["baseMinorUnits"] as number,
          ...(baseUom === undefined ? {} : { baseUom }),
          fromLocationId: record["fromLocationId"] as never,
          status: record["status"] as never,
          ...optional("lotId"),
          ...optional("handlingUnitId"),
          ...optional("claimedByUserId"),
          ...optional("recommendedLocationId"),
          ...optional("chosenLocationId"),
        };
      }),
      page,
    );
  },
});

async function moveTaskCounters(
  ctx: TenantFunctionContext,
  warehouseId: string,
  deltas: { readonly ready?: number; readonly claimed?: number },
): Promise<void> {
  const now = Date.now();
  if (deltas.ready !== undefined) {
    await adjustRollup({
      tenantDb: ctx.tenantDb,
      warehouseId,
      metric: "PUTAWAY_READY",
      delta: deltas.ready,
      now,
    });
  }
  if (deltas.claimed !== undefined) {
    await adjustRollup({
      tenantDb: ctx.tenantDb,
      warehouseId,
      metric: "PUTAWAY_CLAIMED",
      delta: deltas.claimed,
      now,
    });
  }
}

export const maxPutawayPageSize = MAX_JOB_PAGE_SIZE;
