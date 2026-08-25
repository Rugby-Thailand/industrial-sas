import { v } from "convex/values";

import { queryWithOrg } from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  prioritizeOperationalExceptions,
  summarizeStockByLot,
  summarizeStockBySku,
  type OperationalException,
  type ReservationFact,
  type StockBalanceFact,
} from "../model/reporting/operationalViews";

const READ_LIMIT = 99;
const PROBE_LIMIT = READ_LIMIT + 1;
const EXCEPTION_SOURCE_LIMIT = 20;

interface BalanceDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly bucketKey: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly locationKind: string;
  readonly locationId?: string;
  readonly lotId?: string;
  readonly stockStatus: string;
  readonly quantity: { readonly uom: string; readonly minorUnits: number };
  readonly lastTransactionId: string;
  readonly updatedAt: number;
}

interface ItemDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly sku: string;
  readonly name: string;
  readonly baseUom: string;
}

interface LocationDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly code: string;
}

interface LotDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly lotCode: string;
  readonly expirationDate?: string;
}

interface ReservationDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly itemId: string;
  readonly baseUom: string;
  readonly baseMinorUnits: number;
  readonly consumedBaseMinorUnits: number;
  readonly releasedBaseMinorUnits: number;
}

const stockBalanceRow = v.object({
  bucketKey: v.string(),
  itemId: v.id("items"),
  sku: v.string(),
  itemName: v.string(),
  locationId: v.optional(v.id("locations")),
  locationCode: v.optional(v.string()),
  lotId: v.optional(v.id("lots")),
  lotCode: v.optional(v.string()),
  expirationDate: v.optional(v.string()),
  stockStatus: v.string(),
  baseUom: v.string(),
  baseMinorUnits: v.number(),
  lastTransactionId: v.id("inventoryTransactions"),
  updatedAt: v.number(),
});

const stockSkuRow = v.object({
  itemId: v.id("items"),
  sku: v.string(),
  itemName: v.string(),
  baseUom: v.string(),
  availableBaseMinorUnits: v.number(),
  committedBaseMinorUnits: v.number(),
  atpBaseMinorUnits: v.number(),
  qcHoldBaseMinorUnits: v.number(),
  rejectedBaseMinorUnits: v.number(),
  otherBaseMinorUnits: v.number(),
});

const stockLotRow = v.object({
  itemId: v.id("items"),
  sku: v.string(),
  lotId: v.id("lots"),
  lotCode: v.string(),
  expirationDate: v.optional(v.string()),
  baseUom: v.string(),
  availableBaseMinorUnits: v.number(),
  restrictedBaseMinorUnits: v.number(),
});

export const readStockReports = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.object({
    ok: v.literal(true),
    asOf: v.number(),
    complete: v.boolean(),
    balances: v.array(stockBalanceRow),
    sku: v.array(stockSkuRow),
    lots: v.array(stockLotRow),
  }),
  permissionCode: "inventory.balance.read",
  target: { table: "inventoryBalances" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const balanceProbe = await ctx.tenantDb
      .byIndex<BalanceDocument>(
        "inventoryBalances",
        "by_orgId_warehouseId_bucketKey",
        [{ field: "warehouseId", value: args.warehouseId }],
      )
      .take(PROBE_LIMIT);
    const activeReservations = await ctx.tenantDb
      .byIndex<ReservationDocument>(
        "inventoryReservations",
        "by_orgId_warehouseId_status_itemId",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "status", value: "ACTIVE" },
        ],
      )
      .take(PROBE_LIMIT);
    const pickingReservations = await ctx.tenantDb
      .byIndex<ReservationDocument>(
        "inventoryReservations",
        "by_orgId_warehouseId_status_itemId",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "status", value: "PICKING" },
        ],
      )
      .take(PROBE_LIMIT);

    const balances = balanceProbe
      .slice(0, READ_LIMIT)
      .filter(
        (row) =>
          row.locationKind === "PHYSICAL" && row.quantity.minorUnits !== 0,
      );
    const wireBalances: Array<{
      bucketKey: string;
      itemId: never;
      sku: string;
      itemName: string;
      locationId?: never;
      locationCode?: string;
      lotId?: never;
      lotCode?: string;
      expirationDate?: string;
      stockStatus: string;
      baseUom: string;
      baseMinorUnits: number;
      lastTransactionId: never;
      updatedAt: number;
    }> = [];
    const facts: StockBalanceFact[] = [];
    for (const balance of balances) {
      const item = await ctx.tenantDb.get<ItemDocument>(
        "items",
        balance.itemId,
      );
      if (item === null) continue;
      const location =
        balance.locationId === undefined
          ? null
          : await ctx.tenantDb.get<LocationDocument>(
              "locations",
              balance.locationId,
            );
      const lot =
        balance.lotId === undefined
          ? null
          : await ctx.tenantDb.get<LotDocument>("lots", balance.lotId);
      const shared = {
        itemId: balance.itemId,
        sku: item.sku,
        itemName: item.name,
        baseUom: balance.quantity.uom,
        stockStatus: balance.stockStatus,
        baseMinorUnits: balance.quantity.minorUnits,
        ...(balance.lotId === undefined ? {} : { lotId: balance.lotId }),
        ...(lot === null ? {} : { lotCode: lot.lotCode }),
        ...(lot?.expirationDate === undefined
          ? {}
          : { expirationDate: lot.expirationDate }),
      };
      facts.push(shared);
      wireBalances.push({
        bucketKey: balance.bucketKey,
        itemId: balance.itemId as never,
        sku: item.sku,
        itemName: item.name,
        ...(balance.locationId === undefined
          ? {}
          : { locationId: balance.locationId as never }),
        ...(location === null ? {} : { locationCode: location.code }),
        ...(balance.lotId === undefined
          ? {}
          : { lotId: balance.lotId as never }),
        ...(lot === null ? {} : { lotCode: lot.lotCode }),
        ...(lot?.expirationDate === undefined
          ? {}
          : { expirationDate: lot.expirationDate }),
        stockStatus: balance.stockStatus,
        baseUom: balance.quantity.uom,
        baseMinorUnits: balance.quantity.minorUnits,
        lastTransactionId: balance.lastTransactionId as never,
        updatedAt: balance.updatedAt,
      });
    }
    const reservations: ReservationFact[] = [
      ...activeReservations.slice(0, READ_LIMIT),
      ...pickingReservations.slice(0, READ_LIMIT),
    ];
    return {
      ok: true as const,
      asOf: Date.now(),
      complete:
        balanceProbe.length < PROBE_LIMIT &&
        activeReservations.length < PROBE_LIMIT &&
        pickingReservations.length < PROBE_LIMIT,
      balances: wireBalances,
      sku: summarizeStockBySku(facts, reservations).map((row) => ({
        ...row,
        itemId: row.itemId as never,
      })),
      lots: summarizeStockByLot(facts).map((row) => ({
        ...row,
        itemId: row.itemId as never,
        lotId: row.lotId as never,
      })),
    };
  },
});

interface LedgerLineDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly transactionId: string;
  readonly occurredAt: number;
  readonly itemId: string;
  readonly locationKind: string;
  readonly locationId?: string;
  readonly virtualBoundary?: string;
  readonly lotId?: string;
  readonly stockStatus: string;
  readonly quantity: { readonly uom: string; readonly minorUnits: number };
}

interface TransactionDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly type: string;
  readonly operation: string;
  readonly businessDate: string;
  readonly actorUserId: string;
  readonly deviceId?: string;
  readonly reversalOfTransactionId?: string;
}

export const readStockMovements = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.object({
    ok: v.literal(true),
    asOf: v.number(),
    complete: v.boolean(),
    movements: v.array(
      v.object({
        ledgerLineId: v.id("inventoryLedgerLines"),
        transactionId: v.id("inventoryTransactions"),
        type: v.string(),
        operation: v.string(),
        occurredAt: v.number(),
        businessDate: v.string(),
        itemId: v.id("items"),
        sku: v.string(),
        lotCode: v.optional(v.string()),
        location: v.string(),
        stockStatus: v.string(),
        baseUom: v.string(),
        signedBaseMinorUnits: v.number(),
        actorUserId: v.id("users"),
        deviceId: v.optional(v.id("devices")),
        reversalOfTransactionId: v.optional(v.id("inventoryTransactions")),
      }),
    ),
  }),
  permissionCode: "inventory.history.read",
  target: { table: "inventoryLedgerLines" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const probe = await ctx.tenantDb
      .byIndex<LedgerLineDocument>(
        "inventoryLedgerLines",
        "by_orgId_warehouseId_occurredAt",
        [{ field: "warehouseId", value: args.warehouseId }],
      )
      .take(PROBE_LIMIT);
    const movements = [];
    for (const line of probe.slice(0, READ_LIMIT)) {
      const transaction = await ctx.tenantDb.get<TransactionDocument>(
        "inventoryTransactions",
        line.transactionId,
      );
      const item = await ctx.tenantDb.get<ItemDocument>("items", line.itemId);
      if (transaction === null || item === null) continue;
      const location =
        line.locationId === undefined
          ? null
          : await ctx.tenantDb.get<LocationDocument>(
              "locations",
              line.locationId,
            );
      const lot =
        line.lotId === undefined
          ? null
          : await ctx.tenantDb.get<LotDocument>("lots", line.lotId);
      movements.push({
        ledgerLineId: line._id as never,
        transactionId: line.transactionId as never,
        type: transaction.type,
        operation: transaction.operation,
        occurredAt: line.occurredAt,
        businessDate: transaction.businessDate,
        itemId: line.itemId as never,
        sku: item.sku,
        ...(lot === null ? {} : { lotCode: lot.lotCode }),
        location:
          line.locationKind === "PHYSICAL"
            ? (location?.code ?? line.locationId ?? "PHYSICAL")
            : (line.virtualBoundary ?? "VIRTUAL"),
        stockStatus: line.stockStatus,
        baseUom: line.quantity.uom,
        signedBaseMinorUnits: line.quantity.minorUnits,
        actorUserId: transaction.actorUserId as never,
        ...(transaction.deviceId === undefined
          ? {}
          : { deviceId: transaction.deviceId as never }),
        ...(transaction.reversalOfTransactionId === undefined
          ? {}
          : {
              reversalOfTransactionId:
                transaction.reversalOfTransactionId as never,
            }),
      });
    }
    return {
      ok: true as const,
      asOf: Date.now(),
      complete: probe.length < PROBE_LIMIT,
      movements,
    };
  },
});

interface TaskExceptionDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly summary: string;
  readonly ownerUserId?: string;
  readonly reportedAt: number;
}

interface ReceivingExceptionDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly kind: string;
  readonly note?: string;
  readonly raisedByUserId: string;
  readonly raisedAt?: number;
}

interface OutputReceiptDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly productionOrderId: string;
  readonly receivedAt: number;
}

interface ChangeImpactDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly productionOrderNumber: string;
  readonly severity: "NO_IMPACT" | "REVIEW_REQUIRED" | "BLOCKING";
  readonly changedFields: readonly string[];
  readonly createdAt: number;
}

const exceptionSeverity = v.union(
  v.literal("CRITICAL"),
  v.literal("HIGH"),
  v.literal("MEDIUM"),
  v.literal("LOW"),
);

export const readOperationalExceptions = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.object({
    ok: v.literal(true),
    asOf: v.number(),
    complete: v.boolean(),
    exceptions: v.array(
      v.object({
        sourceType: v.string(),
        sourceId: v.string(),
        severity: exceptionSeverity,
        titleCode: v.string(),
        detail: v.string(),
        occurredAt: v.number(),
        ownerUserId: v.optional(v.id("users")),
        deepLink: v.string(),
      }),
    ),
  }),
  permissionCode: "reporting.dashboard.read",
  target: { table: "operationsRollups" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const tasks = await ctx.tenantDb
      .byIndex<TaskExceptionDocument>(
        "operatorTaskExceptions",
        "by_orgId_warehouseId_status_reportedAt",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "status", value: "OPEN" },
        ],
      )
      .take(EXCEPTION_SOURCE_LIMIT);
    const receiving = await ctx.tenantDb
      .byIndex<ReceivingExceptionDocument>(
        "receivingExceptions",
        "by_orgId_warehouseId_status_kind",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "status", value: "RAISED" },
        ],
      )
      .take(EXCEPTION_SOURCE_LIMIT);
    const quality = await ctx.tenantDb
      .byIndex<OutputReceiptDocument>(
        "productionOutputReceipts",
        "by_orgId_warehouseId_disposition_receivedAt",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "disposition", value: "QC_HOLD" },
        ],
      )
      .take(EXCEPTION_SOURCE_LIMIT);
    const changes = await ctx.tenantDb
      .byIndex<ChangeImpactDocument>(
        "designChangeImpacts",
        "by_orgId_warehouseId_status_createdAt",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "status", value: "OPEN" },
        ],
      )
      .take(EXCEPTION_SOURCE_LIMIT);

    const now = Date.now();
    const rows: OperationalException[] = [
      ...tasks.map((row) => ({
        sourceType: "TASK",
        sourceId: row._id,
        severity: "HIGH" as const,
        titleCode: "TASK_EXCEPTION",
        detail: row.summary,
        occurredAt: row.reportedAt,
        ...(row.ownerUserId === undefined
          ? {}
          : { ownerUserId: row.ownerUserId }),
      })),
      ...receiving.map((row) => ({
        sourceType: "RECEIVING",
        sourceId: row._id,
        severity: "HIGH" as const,
        titleCode: "RECEIVING_EXCEPTION",
        detail: row.note ?? row.kind,
        occurredAt: row.raisedAt ?? now,
        ownerUserId: row.raisedByUserId,
      })),
      ...quality.map((row) => ({
        sourceType: "QUALITY",
        sourceId: row._id,
        severity: "MEDIUM" as const,
        titleCode: "QC_HOLD",
        detail: row.productionOrderId,
        occurredAt: row.receivedAt,
      })),
      ...changes.map((row) => ({
        sourceType: "DESIGN_CHANGE",
        sourceId: row._id,
        severity:
          row.severity === "BLOCKING"
            ? ("CRITICAL" as const)
            : ("MEDIUM" as const),
        titleCode: "DESIGN_CHANGE",
        detail: `${row.productionOrderNumber}: ${row.changedFields.join(", ")}`,
        occurredAt: row.createdAt,
      })),
    ];
    return {
      ok: true as const,
      asOf: now,
      complete: [tasks, receiving, quality, changes].every(
        (source) => source.length < EXCEPTION_SOURCE_LIMIT,
      ),
      exceptions: prioritizeOperationalExceptions(rows).map((row) => {
        const { ownerUserId, ...base } = row;
        return {
          ...base,
          ...(ownerUserId === undefined
            ? {}
            : { ownerUserId: ownerUserId as never }),
          deepLink:
            row.sourceType === "RECEIVING"
              ? "/receiving"
              : row.sourceType === "QUALITY"
                ? "/production/orders"
                : row.sourceType === "DESIGN_CHANGE"
                  ? "/production/orders"
                  : "/handheld/work",
        };
      }),
    };
  },
});
