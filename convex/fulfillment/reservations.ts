/** Explainable ATP and FIFO/FEFO reservations for available-stock fulfillment. */
import { v } from "convex/values";

import {
  appendDomainAudit,
  createMasterDataRow,
  describeAuditValue,
  insertedFields,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
} from "../lib/masterDataStore";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import type { TenantDocumentAccess, TenantOrgId } from "../lib/tenantDb";
import { allocationStrategy } from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import {
  allocateReservation,
  calculateAtp,
  deriveFulfillmentLineStatus,
  moveFulfillmentQuantity,
  type FulfillmentQuantities,
  type ReservationCandidate,
} from "../model/fulfillment/reservationPolicy";
import {
  parseBusinessDate,
  type BusinessDate,
} from "../model/time/businessDate";

export const RESERVATION_OPERATIONS = Object.freeze({
  allocate: "fulfillment.reservation.allocate",
  release: "fulfillment.reservation.release",
  cancelRemaining: "fulfillment.reservation.cancelRemaining",
});

const MAX_ALLOCATION_BUCKETS = 100;
const RESERVATION_LIFETIME_MS = 24 * 60 * 60 * 1_000;

interface FulfillmentOrderRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly status: string;
  readonly allowPartial: boolean;
}

interface FulfillmentLineRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly fulfillmentOrderId: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly baseUom: string;
  readonly orderedBaseMinorUnits: number;
  readonly status: string;
  readonly quantities: FulfillmentQuantities;
}

interface BalanceRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly bucketKey: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly locationKind: "PHYSICAL" | "VIRTUAL";
  readonly locationId?: string;
  readonly lotId?: string;
  readonly quantity: { readonly uom: string; readonly minorUnits: number };
  readonly lastTransactionId: string;
}

interface LotRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly lotCode: string;
  readonly manufactureDate?: string;
  readonly bestBeforeDate?: string;
  readonly expirationDate?: string;
}

interface TransactionRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly businessDate: string;
  readonly occurredAt: number;
}

interface ReservationRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly bucketKey: string;
  readonly baseMinorUnits: number;
  readonly consumedBaseMinorUnits: number;
  readonly releasedBaseMinorUnits: number;
  readonly status: string;
  readonly fulfillmentLineId: string;
  readonly warehouseId: string;
  readonly expiresAt: number;
}

const reservationReleaseReason = v.union(
  v.literal("REPLAN"),
  v.literal("BACKORDER"),
  v.literal("CANCEL_REMAINING"),
  v.literal("EXPIRED"),
);

const atpCandidateValidator = v.object({
  bucketKey: v.string(),
  locationId: v.id("locations"),
  lotId: v.optional(v.id("lots")),
  baseUom: v.string(),
  onHandBaseMinorUnits: v.number(),
  reservedBaseMinorUnits: v.number(),
  atpBaseMinorUnits: v.number(),
  lotCode: v.optional(v.string()),
  receivedOn: v.string(),
  expirationDate: v.optional(v.string()),
});

const atpResultValidator = v.union(
  v.object({
    available: v.literal(true),
    itemId: v.id("items"),
    warehouseId: v.id("warehouses"),
    baseUom: v.string(),
    atpBaseMinorUnits: v.number(),
    candidates: v.array(atpCandidateValidator),
  }),
  v.object({
    available: v.literal(false),
    error: v.object({ code: v.string(), reason: v.optional(v.string()) }),
  }),
);

const unavailable = (code: string, reason?: string) => ({
  available: false as const,
  error: { code, ...(reason === undefined ? {} : { reason }) },
});

const parseOptionalDate = (
  value: string | undefined,
): BusinessDate | null | "INVALID" => {
  if (value === undefined) return null;
  const parsed = parseBusinessDate(value);
  return parsed.ok ? parsed.value : "INVALID";
};

async function activeReservationTotals(
  tenantDb: TenantDocumentAccess,
  warehouseId: string,
  itemId: string,
): Promise<Map<string, number> | null> {
  const totals = new Map<string, number>();
  for (const status of ["ACTIVE", "PICKING"] as const) {
    const page = await tenantDb
      .byIndex<ReservationRow>(
        "inventoryReservations",
        "by_orgId_warehouseId_itemId_status_expiresAt",
        [
          { field: "warehouseId", value: warehouseId },
          { field: "itemId", value: itemId },
          { field: "status", value: status },
        ],
      )
      .page({ limit: MAX_ALLOCATION_BUCKETS });
    if (!page.isDone) return null;
    for (const reservation of page.page) {
      const open =
        reservation.baseMinorUnits - reservation.releasedBaseMinorUnits;
      if (!Number.isSafeInteger(open) || open < 0) return null;
      totals.set(
        reservation.bucketKey,
        (totals.get(reservation.bucketKey) ?? 0) + open,
      );
    }
  }
  return totals;
}

async function loadCandidates(
  tenantDb: TenantDocumentAccess,
  warehouseId: string,
  itemId: string,
  baseUom: string,
): Promise<
  | {
      readonly ok: true;
      readonly candidates: readonly ReservationCandidate[];
      readonly rows: ReadonlyMap<string, BalanceRow>;
      readonly display: readonly {
        readonly bucketKey: string;
        readonly locationId: string;
        readonly lotId?: string;
        readonly baseUom: string;
        readonly onHandBaseMinorUnits: number;
        readonly reservedBaseMinorUnits: number;
        readonly atpBaseMinorUnits: number;
        readonly lotCode?: string;
        readonly receivedOn: string;
        readonly expirationDate?: string;
      }[];
    }
  | { readonly ok: false; readonly code: string; readonly reason?: string }
> {
  const balancePage = await tenantDb
    .byIndex<BalanceRow>(
      "inventoryBalances",
      "by_orgId_warehouseId_itemId_stockStatus",
      [
        { field: "warehouseId", value: warehouseId },
        { field: "itemId", value: itemId },
        { field: "stockStatus", value: "AVAILABLE" },
      ],
    )
    .page({ limit: MAX_ALLOCATION_BUCKETS });
  if (!balancePage.isDone) {
    return {
      ok: false,
      code: "ALLOCATION_WINDOW_EXCEEDED",
      reason: "BALANCE_BUCKET_LIMIT",
    };
  }
  const reserved = await activeReservationTotals(tenantDb, warehouseId, itemId);
  if (reserved === null) {
    return {
      ok: false,
      code: "ALLOCATION_WINDOW_EXCEEDED",
      reason: "RESERVATION_LIMIT",
    };
  }

  const candidates: ReservationCandidate[] = [];
  const rows = new Map<string, BalanceRow>();
  const display: {
    bucketKey: string;
    locationId: string;
    lotId?: string;
    baseUom: string;
    onHandBaseMinorUnits: number;
    reservedBaseMinorUnits: number;
    atpBaseMinorUnits: number;
    lotCode?: string;
    receivedOn: string;
    expirationDate?: string;
  }[] = [];

  for (const balance of balancePage.page) {
    if (
      balance.locationKind !== "PHYSICAL" ||
      balance.locationId === undefined ||
      balance.quantity.uom !== baseUom ||
      !Number.isSafeInteger(balance.quantity.minorUnits) ||
      balance.quantity.minorUnits <= 0
    ) {
      continue;
    }
    const transaction = await tenantDb.get<TransactionRow>(
      "inventoryTransactions",
      balance.lastTransactionId,
    );
    if (transaction === null) {
      return { ok: false, code: "STORED_ROW_INVALID" };
    }
    const receivedOn = parseBusinessDate(transaction.businessDate);
    if (!receivedOn.ok) {
      return { ok: false, code: "STORED_ROW_INVALID" };
    }
    let lot: LotRow | null = null;
    if (balance.lotId !== undefined) {
      lot = await tenantDb.get<LotRow>("lots", balance.lotId);
      if (lot === null) {
        return { ok: false, code: "STORED_ROW_INVALID" };
      }
    }
    const manufactureDate = parseOptionalDate(lot?.manufactureDate);
    const bestBeforeDate = parseOptionalDate(lot?.bestBeforeDate);
    const expirationDate = parseOptionalDate(lot?.expirationDate);
    if (
      manufactureDate === "INVALID" ||
      bestBeforeDate === "INVALID" ||
      expirationDate === "INVALID"
    ) {
      return { ok: false, code: "STORED_ROW_INVALID" };
    }
    const reservedBaseMinorUnits = reserved.get(balance.bucketKey) ?? 0;
    candidates.push({
      bucketKey: balance.bucketKey,
      stockMinorUnits: balance.quantity.minorUnits,
      alreadyReservedMinorUnits: reservedBaseMinorUnits,
      rotation: {
        // Bucket keys are intentionally long canonical encodings. The balance
        // document ID is the stable bounded tie-breaker the rotation kernel
        // requires; allocation still records the canonical bucket key.
        candidateKey: balance._id,
        lotCode: lot?.lotCode ?? null,
        receivedOn: receivedOn.value,
        receiptSequence: transaction.occurredAt,
        expirationDate,
        bestBeforeDate,
        manufactureDate,
      },
    });
    rows.set(balance.bucketKey, balance);
    display.push({
      bucketKey: balance.bucketKey,
      locationId: balance.locationId,
      ...(balance.lotId === undefined ? {} : { lotId: balance.lotId }),
      baseUom,
      onHandBaseMinorUnits: balance.quantity.minorUnits,
      reservedBaseMinorUnits,
      atpBaseMinorUnits: Math.max(
        0,
        balance.quantity.minorUnits - reservedBaseMinorUnits,
      ),
      ...(lot === null ? {} : { lotCode: lot.lotCode }),
      receivedOn: transaction.businessDate,
      ...(lot?.expirationDate === undefined
        ? {}
        : { expirationDate: lot.expirationDate }),
    });
  }
  return {
    ok: true,
    candidates: Object.freeze(candidates),
    rows,
    display: Object.freeze(display),
  };
}

/**
 * Application-level ATP seam shared by the read model and demand routing.
 * Keeping one loader prevents the route decision and later reservation from
 * disagreeing about active reservations or eligible AVAILABLE buckets.
 */
export async function readAvailableToPromise(input: {
  readonly tenantDb: TenantDocumentAccess;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly baseUom: string;
}): Promise<
  | {
      readonly ok: true;
      readonly atpBaseMinorUnits: number;
      readonly display: Extract<
        Awaited<ReturnType<typeof loadCandidates>>,
        { readonly ok: true }
      >["display"];
    }
  | { readonly ok: false; readonly code: string; readonly reason?: string }
> {
  const loaded = await loadCandidates(
    input.tenantDb,
    input.warehouseId,
    input.itemId,
    input.baseUom,
  );
  if (!loaded.ok) return loaded;
  const atp = calculateAtp(loaded.candidates);
  if (!atp.ok) return { ok: false, code: atp.error.code };
  return {
    ok: true,
    atpBaseMinorUnits: atp.value,
    display: loaded.display,
  };
}

export const getAvailableToPromise = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    itemId: v.id("items"),
  },
  returns: atpResultValidator,
  permissionCode: "fulfillment.atp.read",
  target: {
    table: "inventoryBalances",
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const item = await ctx.tenantDb.get<{
      readonly orgId: TenantOrgId;
      readonly baseUom: string;
    }>("items", args.itemId);
    if (item === null) return unavailable("REFERENCE_NOT_FOUND");
    const loaded = await readAvailableToPromise({
      tenantDb: ctx.tenantDb,
      warehouseId: args.warehouseId,
      itemId: args.itemId,
      baseUom: item.baseUom,
    });
    if (!loaded.ok) return unavailable(loaded.code, loaded.reason);
    return {
      available: true as const,
      itemId: args.itemId,
      warehouseId: args.warehouseId,
      baseUom: item.baseUom,
      atpBaseMinorUnits: loaded.atpBaseMinorUnits,
      candidates: loaded.display.map((candidate) => ({
        bucketKey: candidate.bucketKey,
        locationId: candidate.locationId as never,
        ...(candidate.lotId === undefined
          ? {}
          : { lotId: candidate.lotId as never }),
        baseUom: candidate.baseUom,
        onHandBaseMinorUnits: candidate.onHandBaseMinorUnits,
        reservedBaseMinorUnits: candidate.reservedBaseMinorUnits,
        atpBaseMinorUnits: candidate.atpBaseMinorUnits,
        ...(candidate.lotCode === undefined
          ? {}
          : { lotCode: candidate.lotCode }),
        receivedOn: candidate.receivedOn,
        ...(candidate.expirationDate === undefined
          ? {}
          : { expirationDate: candidate.expirationDate }),
      })),
    };
  },
});

export const allocateFulfillmentLine = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    fulfillmentLineId: v.id("fulfillmentLines"),
    strategy: allocationStrategy,
    asOfBusinessDate: v.string(),
    requestedBaseMinorUnits: v.number(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.reservation.allocate",
  target: {
    table: "fulfillmentLines",
    id: ({ fulfillmentLineId }) => fulfillmentLineId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const line = await ctx.tenantDb.get<FulfillmentLineRow>(
      "fulfillmentLines",
      args.fulfillmentLineId,
    );
    if (line === null) {
      return refusal({ code: "NOT_FOUND", table: "fulfillmentLines" });
    }
    if (line.warehouseId !== args.warehouseId) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "warehouseId" });
    }
    const fingerprint = {
      operation: RESERVATION_OPERATIONS.allocate,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      fulfillmentLineId: args.fulfillmentLineId,
      strategy: args.strategy,
      asOfBusinessDate: args.asOfBusinessDate,
      requestedBaseMinorUnits: args.requestedBaseMinorUnits,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "fulfillmentAllocationRuns",
      operation: RESERVATION_OPERATIONS.allocate,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);

    const fulfillment = await ctx.tenantDb.get<FulfillmentOrderRow>(
      "fulfillmentOrders",
      line.fulfillmentOrderId,
    );
    if (fulfillment === null || fulfillment.warehouseId !== args.warehouseId) {
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "fulfillmentOrderId",
      });
    }
    if (
      fulfillment.status !== "RELEASED" &&
      fulfillment.status !== "IN_FULFILLMENT"
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "FULFILLMENT_NOT_RELEASED",
      });
    }
    if (
      !Number.isSafeInteger(args.requestedBaseMinorUnits) ||
      args.requestedBaseMinorUnits <= 0 ||
      args.requestedBaseMinorUnits >
        line.quantities.DEMAND + line.quantities.BACKORDERED
    ) {
      return refusal({
        code: "FIELD_INVALID",
        field: "requestedBaseMinorUnits",
        reason: "EXCEEDS_UNALLOCATED_DEMAND",
      });
    }
    const asOf = parseBusinessDate(args.asOfBusinessDate);
    if (!asOf.ok) {
      return refusal({
        code: "FIELD_INVALID",
        field: "asOfBusinessDate",
        reason: asOf.error.code,
      });
    }
    const loaded = await loadCandidates(
      ctx.tenantDb,
      args.warehouseId,
      line.itemId,
      line.baseUom,
    );
    if (!loaded.ok) return refusal(loaded);
    const decision = allocateReservation({
      requestedMinorUnits: args.requestedBaseMinorUnits,
      candidates: loaded.candidates,
      rotationPolicy: {
        strategy: args.strategy,
        rotationDateSource: "EXPIRATION",
        missingRotationDate:
          args.strategy === "FEFO" ? "EXCLUDE" : "ORDER_LAST",
        expired: "EXCLUDE",
      },
      asOf: asOf.value,
      allowPartial: fulfillment.allowPartial,
    });
    if (!decision.ok) return refusal(decision.error);

    for (const allocation of decision.value.allocations) {
      if (loaded.rows.get(allocation.bucketKey)?.locationId === undefined) {
        return refusal({ code: "STORED_ROW_INVALID", field: "bucketKey" });
      }
    }
    let quantities = line.quantities;
    let reserveRemaining = decision.value.reservedMinorUnits;
    const fromDemand = Math.min(quantities.DEMAND, reserveRemaining);
    if (fromDemand > 0) {
      const moved = moveFulfillmentQuantity(quantities, {
        from: "DEMAND",
        to: "RESERVED",
        baseMinorUnits: fromDemand,
      });
      if (!moved.ok) return refusal(moved.error);
      quantities = moved.value;
      reserveRemaining -= fromDemand;
    }
    if (reserveRemaining > 0) {
      const moved = moveFulfillmentQuantity(quantities, {
        from: "BACKORDERED",
        to: "RESERVED",
        baseMinorUnits: reserveRemaining,
      });
      if (!moved.ok) return refusal(moved.error);
      quantities = moved.value;
    }
    const newBackorderFromDemand = Math.min(
      quantities.DEMAND,
      decision.value.backorderedMinorUnits,
    );
    if (newBackorderFromDemand > 0) {
      const moved = moveFulfillmentQuantity(quantities, {
        from: "DEMAND",
        to: "BACKORDERED",
        baseMinorUnits: newBackorderFromDemand,
      });
      if (!moved.ok) return refusal(moved.error);
      quantities = moved.value;
    }
    const status = deriveFulfillmentLineStatus(
      line.orderedBaseMinorUnits,
      quantities,
    );
    if (!status.ok) return refusal(status.error);

    const now = Date.now();
    const runOutcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "fulfillmentAllocationRuns",
        operation: RESERVATION_OPERATIONS.allocate,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint,
      uniqueness: [],
      document: {
        fulfillmentLineId: args.fulfillmentLineId,
        warehouseId: args.warehouseId,
        itemId: line.itemId,
        strategy: args.strategy,
        allowPartial: fulfillment.allowPartial,
        asOfBusinessDate: args.asOfBusinessDate,
        requestedBaseMinorUnits: args.requestedBaseMinorUnits,
        atpBaseMinorUnits: decision.value.atpMinorUnits,
        reservedBaseMinorUnits: decision.value.reservedMinorUnits,
        backorderedBaseMinorUnits: decision.value.backorderedMinorUnits,
        reservationCount: decision.value.allocations.length,
        createdAt: now,
        createdByUserId: ctx.tenant.actor._id,
      },
    });
    if (!runOutcome.ok) return refusal(runOutcome.error);

    const context = writeContextOf(ctx, {
      table: "fulfillmentLines",
      operation: RESERVATION_OPERATIONS.allocate,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
    });
    for (const allocation of decision.value.allocations) {
      const balance = loaded.rows.get(allocation.bucketKey)!;
      const reservation = {
        allocationRunId: runOutcome.value.documentId,
        fulfillmentOrderId: line.fulfillmentOrderId,
        fulfillmentLineId: args.fulfillmentLineId,
        warehouseId: args.warehouseId,
        itemId: line.itemId,
        bucketKey: allocation.bucketKey,
        locationId: balance.locationId,
        ...(balance.lotId === undefined ? {} : { lotId: balance.lotId }),
        baseUom: line.baseUom,
        baseMinorUnits: allocation.baseMinorUnits,
        status: "ACTIVE",
        expiresAt: now + RESERVATION_LIFETIME_MS,
        rotationRank: allocation.rank,
        rotationExplanation: allocation.explanation.map((entry) => ({
          ...entry,
        })),
        consumedBaseMinorUnits: 0,
        releasedBaseMinorUnits: 0,
        createdAt: now,
        createdByUserId: ctx.tenant.actor._id,
      };
      const reservationId = await ctx.tenantDb.insert(
        "inventoryReservations",
        reservation,
      );
      await appendDomainAudit(context, {
        entityTable: "inventoryReservations",
        entityId: reservationId,
        changes: insertedFields(reservation),
      });
    }

    await ctx.tenantDb.patch("fulfillmentLines", args.fulfillmentLineId, {
      quantities: { ...quantities },
      status: status.value,
    });
    await appendDomainAudit(context, {
      entityTable: "fulfillmentLines",
      entityId: args.fulfillmentLineId,
      changes: [
        {
          field: "quantities",
          from: describeAuditValue(line.quantities),
          to: describeAuditValue(quantities),
        },
        { field: "status", from: line.status, to: status.value },
      ],
    });
    if (fulfillment.status === "RELEASED") {
      await ctx.tenantDb.patch("fulfillmentOrders", line.fulfillmentOrderId, {
        status: "IN_FULFILLMENT",
      });
      await appendDomainAudit(context, {
        entityTable: "fulfillmentOrders",
        entityId: line.fulfillmentOrderId,
        changes: [{ field: "status", from: "RELEASED", to: "IN_FULFILLMENT" }],
      });
    }
    return written(runOutcome.value);
  },
});

/**
 * Explicitly return an active reservation to demand/backorder/cancelled state.
 * Expiry is never inferred inside ATP: a server command must observe the expiry,
 * transition the row, and leave audit evidence before the stock becomes ATP.
 */
export const releaseFulfillmentReservation = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    inventoryReservationId: v.id("inventoryReservations"),
    reason: reservationReleaseReason,
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.reservation.release",
  target: {
    table: "inventoryReservations",
    id: ({ inventoryReservationId }) => inventoryReservationId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const reservation = await ctx.tenantDb.get<ReservationRow>(
      "inventoryReservations",
      args.inventoryReservationId,
    );
    if (reservation === null) {
      return refusal({ code: "NOT_FOUND", table: "inventoryReservations" });
    }
    if (reservation.warehouseId !== args.warehouseId) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "warehouseId" });
    }
    const fingerprint = {
      operation: RESERVATION_OPERATIONS.release,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      inventoryReservationId: args.inventoryReservationId,
      reason: args.reason,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "inventoryReservations",
      operation: RESERVATION_OPERATIONS.release,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    if (reservation.status !== "ACTIVE") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "RESERVATION_NOT_ACTIVE",
      });
    }
    const now = Date.now();
    if (args.reason === "EXPIRED" && reservation.expiresAt > now) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "expiresAt",
        reason: "RESERVATION_NOT_EXPIRED",
      });
    }
    const openBaseMinorUnits =
      reservation.baseMinorUnits -
      reservation.consumedBaseMinorUnits -
      reservation.releasedBaseMinorUnits;
    if (!Number.isSafeInteger(openBaseMinorUnits) || openBaseMinorUnits <= 0) {
      return refusal({
        code: "STORED_ROW_INVALID",
        field: "baseMinorUnits",
      });
    }
    const line = await ctx.tenantDb.get<FulfillmentLineRow>(
      "fulfillmentLines",
      reservation.fulfillmentLineId,
    );
    if (line === null || line.warehouseId !== args.warehouseId) {
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "fulfillmentLineId",
      });
    }
    const destination =
      args.reason === "REPLAN"
        ? "DEMAND"
        : args.reason === "CANCEL_REMAINING"
          ? "CANCELLED"
          : "BACKORDERED";
    const moved = moveFulfillmentQuantity(line.quantities, {
      from: "RESERVED",
      to: destination,
      baseMinorUnits: openBaseMinorUnits,
    });
    if (!moved.ok) return refusal(moved.error);
    const status = deriveFulfillmentLineStatus(
      line.orderedBaseMinorUnits,
      moved.value,
    );
    if (!status.ok) return refusal(status.error);

    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "inventoryReservations",
        operation: RESERVATION_OPERATIONS.release,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: args.inventoryReservationId,
      fingerprint,
      uniqueness: [],
      patch: {
        status: args.reason === "EXPIRED" ? "EXPIRED" : "RELEASED",
        releasedAt: now,
        releaseReason: args.reason,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    const context = writeContextOf(ctx, {
      table: "fulfillmentLines",
      operation: RESERVATION_OPERATIONS.release,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
    });
    await ctx.tenantDb.patch("fulfillmentLines", line._id, {
      quantities: { ...moved.value },
      status: status.value,
    });
    await appendDomainAudit(context, {
      entityTable: "fulfillmentLines",
      entityId: line._id,
      changes: [
        {
          field: "quantities",
          from: describeAuditValue(line.quantities),
          to: describeAuditValue(moved.value),
        },
        { field: "status", from: line.status, to: status.value },
      ],
    });
    return written(outcome.value);
  },
});

/** Cancel only demand that has not entered picking, preserving delivered work. */
export const cancelFulfillmentLineRemainder = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    fulfillmentLineId: v.id("fulfillmentLines"),
    reason: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.reservation.release",
  target: {
    table: "fulfillmentLines",
    id: ({ fulfillmentLineId }) => fulfillmentLineId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const line = await ctx.tenantDb.get<FulfillmentLineRow>(
      "fulfillmentLines",
      args.fulfillmentLineId,
    );
    if (line === null || line.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "fulfillmentLines" });
    }
    const reason = args.reason.trim().normalize("NFC");
    if (reason.length === 0 || reason.length > 500) {
      return refusal({ code: "FIELD_INVALID", field: "reason" });
    }
    const fingerprint = {
      operation: RESERVATION_OPERATIONS.cancelRemaining,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      fulfillmentLineId: args.fulfillmentLineId,
      reason,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "fulfillmentLines",
      operation: RESERVATION_OPERATIONS.cancelRemaining,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);

    if (
      line.quantities.PICKING > 0 ||
      line.quantities.STAGED > 0 ||
      line.quantities.ISSUED > 0 ||
      line.quantities.LOADED > 0
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "quantities",
        reason: "REMAINING_WORK_IN_EXECUTION",
      });
    }
    const cancellable =
      line.quantities.DEMAND +
      line.quantities.RESERVED +
      line.quantities.BACKORDERED;
    if (cancellable <= 0) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "quantities",
        reason: "NO_CANCELLABLE_QUANTITY",
      });
    }
    const reservationPage = await ctx.tenantDb
      .byIndex<ReservationRow>(
        "inventoryReservations",
        "by_orgId_fulfillmentLineId_status_bucketKey",
        [
          { field: "fulfillmentLineId", value: line._id },
          { field: "status", value: "ACTIVE" },
        ],
      )
      .page({ limit: MAX_ALLOCATION_BUCKETS });
    if (!reservationPage.isDone) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "reservations",
        reason: "RESERVATION_LIMIT_EXCEEDED",
      });
    }
    const openReservations = reservationPage.page.map((reservation) => ({
      reservation,
      openBaseMinorUnits:
        reservation.baseMinorUnits -
        reservation.consumedBaseMinorUnits -
        reservation.releasedBaseMinorUnits,
    }));
    if (
      openReservations.some(
        ({ openBaseMinorUnits }) =>
          !Number.isSafeInteger(openBaseMinorUnits) || openBaseMinorUnits <= 0,
      ) ||
      openReservations.reduce(
        (sum, { openBaseMinorUnits }) => sum + openBaseMinorUnits,
        0,
      ) !== line.quantities.RESERVED
    ) {
      return refusal({ code: "STORED_ROW_INVALID", field: "reservations" });
    }

    let quantities = line.quantities;
    for (const stage of ["DEMAND", "RESERVED", "BACKORDERED"] as const) {
      const amount = quantities[stage];
      if (amount === 0) continue;
      const moved = moveFulfillmentQuantity(quantities, {
        from: stage,
        to: "CANCELLED",
        baseMinorUnits: amount,
      });
      if (!moved.ok) return refusal(moved.error);
      quantities = moved.value;
    }
    const status = deriveFulfillmentLineStatus(
      line.orderedBaseMinorUnits,
      quantities,
    );
    if (!status.ok) return refusal(status.error);
    const orderLines = await ctx.tenantDb
      .byIndex<FulfillmentLineRow>(
        "fulfillmentLines",
        "by_orgId_fulfillmentOrderId_customerOrderLineId",
        [{ field: "fulfillmentOrderId", value: line.fulfillmentOrderId }],
      )
      .page({ limit: 50 });
    if (!orderLines.isDone || orderLines.page.length === 0) {
      return refusal({ code: "STORED_ROW_INVALID", field: "orderLines" });
    }
    const projected = orderLines.page.map((row) =>
      row._id === line._id ? { ...row, quantities } : row,
    );
    const allResolved = projected.every(
      (row) =>
        row.quantities.DELIVERED + row.quantities.CANCELLED ===
        row.orderedBaseMinorUnits,
    );
    const allCancelled = projected.every(
      (row) => row.quantities.CANCELLED === row.orderedBaseMinorUnits,
    );
    const order = await ctx.tenantDb.get<FulfillmentOrderRow>(
      "fulfillmentOrders",
      line.fulfillmentOrderId,
    );
    if (order === null || order.warehouseId !== args.warehouseId) {
      return refusal({ code: "STORED_ROW_INVALID", field: "fulfillmentOrder" });
    }
    const now = Date.now();
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "fulfillmentLines",
        operation: RESERVATION_OPERATIONS.cancelRemaining,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: line._id,
      fingerprint,
      uniqueness: [],
      patch: {
        quantities: { ...quantities },
        status: status.value,
        cancellationReason: reason,
        cancelledAt: now,
        cancelledByUserId: ctx.tenant.actor._id,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    const context = writeContextOf(ctx, {
      table: "fulfillmentLines",
      operation: RESERVATION_OPERATIONS.cancelRemaining,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
    });
    for (const { reservation, openBaseMinorUnits } of openReservations) {
      await ctx.tenantDb.patch("inventoryReservations", reservation._id, {
        status: "RELEASED",
        releasedBaseMinorUnits:
          reservation.releasedBaseMinorUnits + openBaseMinorUnits,
        releasedAt: now,
        releaseReason: "CANCEL_REMAINING",
      });
      await appendDomainAudit(context, {
        entityTable: "inventoryReservations",
        entityId: reservation._id,
        changes: [
          { field: "status", from: reservation.status, to: "RELEASED" },
          {
            field: "releasedBaseMinorUnits",
            from: describeAuditValue(reservation.releasedBaseMinorUnits),
            to: describeAuditValue(
              reservation.releasedBaseMinorUnits + openBaseMinorUnits,
            ),
          },
        ],
      });
    }
    if (allResolved) {
      await ctx.tenantDb.patch("fulfillmentOrders", order._id, {
        status: allCancelled ? "CANCELLED" : "COMPLETE",
        ...(allCancelled ? { cancelledAt: now } : { completedAt: now }),
      });
      await appendDomainAudit(context, {
        entityTable: "fulfillmentOrders",
        entityId: order._id,
        changes: [
          {
            field: "status",
            from: order.status,
            to: allCancelled ? "CANCELLED" : "COMPLETE",
          },
        ],
      });
    }
    return written(outcome.value);
  },
});
