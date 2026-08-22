/**
 * Putaway: an explainable recommendation, a contended claim, and a balanced move.
 *
 * The scoring lives in `convex/model/inbound/putawayScoring.ts` and is
 * deterministic by construction (`INV-0007-10`). What this module adds is the
 * three things a pure function cannot do:
 *
 * 1. **Read the candidates**, bounded, from the tenant's own locations.
 * 2. **Store the explanation** with the task, so "why this bin?" survives the
 *    session that asked it (`INV-0007-09`, D-14).
 * 3. **Resolve the race.** Two operators on two handhelds press *claim* at the
 *    same moment; the claim is decided against the row as re-read inside the
 *    transaction, so the loser is told they lost rather than both being told
 *    they won (`INV-0007-11`).
 *
 * ### Why the recommendation is stored rather than recomputed at confirmation
 *
 * A confirmation validates the chosen location against the recommendation that
 * *the operator saw*. Recomputing would validate against a warehouse that may
 * have changed while they walked to the rack — and would silently turn a
 * legitimate choice into an override, or an override into a legitimate choice.
 */
import { v } from "convex/values";

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

/**
 * How many locations one recommendation considers.
 *
 * Bounded because the read is on a handheld's critical path and a warehouse may
 * have thousands of bins. The candidates come from the warehouse's own location
 * index in code order, so the set is stable — which the determinism guarantee
 * needs — and a tenant whose best bin sits outside the first page gets a worse
 * recommendation rather than a slower screen. The alternative, an unbounded
 * scan, is what `INV-0002-05` forbids.
 */
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

/**
 * Build the candidate set for one task.
 *
 * The preference facts — "this bin already holds the item", "this is its home" —
 * are read from balances where they are cheap and left absent where they are
 * not. An absent fact scores zero rather than guessing, which is the honest
 * behaviour for a tenant that has not modelled capacity or zones: the
 * recommendation degrades to travel and fragmentation rather than inventing
 * numbers.
 */
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

  return locations.map((location) => ({
    locationId: location._id,
    code: location.code,
    locationType: location.locationType,
    status: location.status,
  }));
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

/**
 * Recommend where a task's stock should go, with the reasoning.
 *
 * A **query**: recommending changes nothing, and an operator refreshing the
 * screen must not write a row. The recommendation is persisted when the task is
 * claimed, which is the moment somebody committed to acting on it.
 */
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

    /*
     * Once the task is claimed, the **stored** trace is the answer — not a fresh
     * computation. The confirmation validates the chosen location against the
     * trace that was frozen at claim time (`INV-0007-09`), so a screen shown a
     * recomputed list could offer a bin the confirmation would then refuse, or
     * silently turn an override into a non-override because the warehouse
     * changed while the operator walked to the rack.
     */
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
    /** True when this actor already held the task. */
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

/**
 * Claim a task, and freeze the recommendation the operator will act on.
 *
 * Compare-and-set (`INV-0007-11`): the row is re-read inside this transaction,
 * so two handhelds pressing at once resolve on the write. Re-claiming a task you
 * already hold succeeds — an operator whose screen reconnected should not be told
 * they lost their own task — and does not recompute the recommendation, because
 * the one they are looking at is the one they will be held to.
 */
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
    // The accessor proves the tenant, not the site. A task belonging to another
    // warehouse answers exactly as one that does not exist, so a warehouse-scoped
    // actor cannot claim another site's backlog (`INV-0006-04`). Nothing further
    // down catches it: a claim is a patch and a counter move, with no ledger
    // posting whose own warehouse checks would refuse first.
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

    /*
     * The task moves from one backlog to the other, in this transaction. A
     * re-claim of a task this actor already holds does not reach here — the
     * status guard above returns first — so the pair cannot be moved twice.
     */
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
    /** True when the operator did not take the top recommendation. */
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

/**
 * Confirm the move (`INV-0007-08`).
 *
 * Posts a balanced `PUTAWAY`: the quantity out of the receiving location and
 * into the chosen one, same item, same lot, same status. The stored
 * recommendation is what the chosen location is validated against, so a bin that
 * failed a hard constraint is refused however the operator reached it — a
 * constraint is compatibility, prohibition, or capacity, and none of those is a
 * preference a handheld may overrule.
 *
 * Taking a runner-up is permitted and needs a reason (`INV-0007-09`). It is
 * recorded on the task with the location that *was* recommended, which is what
 * makes override analytics possible at all.
 */
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
    // Same reason as the claim path: the site is not proved by the accessor.
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

    // Confirmed leaves the board entirely; occupancy is maintained by the ledger
    // posting above, where the stock actually moved.
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

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `baseUom` is on the wire for the same reason it is on a purchase-order line:
 * the quantity beside it is counted in it, and nothing else on the row says so.
 *
 * A putaway board at one site holds kilograms of coil, litres of resin, and
 * eaches of carton in the same column. Rendering `baseMinorUnits` without its
 * unit makes those one measure — which is what the visual audit found. The unit
 * is the item's, so it is a join, and it is optional because a task whose item
 * cannot be read is a dangling reference rather than a state the board can
 * resolve: the screen shows its unrenderable marker instead of a bare number.
 */
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

/** The task board at one site. */
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

    /*
     * The base unit of each distinct item on the page, read once per item.
     *
     * A page is bounded by `MAX_JOB_PAGE_SIZE` and a board's tasks name far
     * fewer items than they have rows, so this is a small bounded number of
     * document reads on a handheld's critical path. An item that cannot be read
     * is recorded as "no unit" rather than re-read for every task naming it.
     */
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

/**
 * Move the two board counters together.
 *
 * The pair is one fact — a task is ready, claimed, or gone — so both sides of a
 * transition are written by one helper. Two separate call sites are two chances
 * to move one and forget the other, and the symptom of that is a board whose
 * totals do not add up to the tasks on it.
 */
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

/** The page cap, re-exported so a client can size its own loop. */
export const maxPutawayPageSize = MAX_JOB_PAGE_SIZE;
