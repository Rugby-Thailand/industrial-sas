import { v, type GenericId } from "convex/values";

import {
  postLedgerTransaction,
  readBalancePage,
  readTransactionHistoryPage,
  readTransactionWithBalances,
  reconcileBucketPage,
  reverseLedgerTransaction,
  toPublicLedgerError,
  type LedgerStoreError,
  type PostOutcome,
  type PublicLedgerError,
  type PostedBalance,
  type PostedTransaction,
  type BalanceSummary,
  type TransactionSummary,
} from "../lib/inventoryLedgerStore";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantPolicyContext,
} from "../lib/tenantFunctions";
import { pageRequestOf } from "../lib/listEnvelope";
import {
  inventoryTransactionSource,
  inventoryTransactionType,
  ledgerLocationKind,
  signedQuantity,
  stockStatus,
  virtualBoundaryCode,
} from "../lib/validators";
import { MAX_JOB_PAGE_SIZE } from "../model/inventory/jobPage";
import { storageLocationBreadcrumb } from "../lib/storageAddressStore";
import { LEDGER_OPERATIONS } from "../model/inventory/requestIdentity";
import {
  decodeBucketKey,
  type InventoryBucket,
  type LedgerLocation,
  type StockStatus,
  type VirtualBoundaryCode,
} from "../model/inventory/stockIdentity";
import type { LedgerLineDraft } from "../model/inventory/ledgerTransaction";

// Convex validators cannot express this discriminated input shape.
const ledgerLineArgument = v.object({
  itemId: v.id("items"),
  locationKind: ledgerLocationKind,
  locationId: v.optional(v.id("locations")),
  virtualBoundary: v.optional(virtualBoundaryCode),
  lotId: v.optional(v.id("lots")),
  handlingUnitId: v.optional(v.id("handlingUnits")),
  ownerId: v.optional(v.id("owners")),
  stockStatus,
  quantity: signedQuantity,
});

const publicLedgerErrorValidator = v.object({
  code: v.string(),
  field: v.optional(v.string()),
  table: v.optional(v.string()),
  reference: v.optional(v.string()),
  index: v.optional(v.number()),
  bucketKey: v.optional(v.string()),
  conservationKey: v.optional(v.string()),
  stockStatus: v.optional(v.string()),
  uom: v.optional(v.string()),
  expected: v.optional(v.string()),
  received: v.optional(v.string()),
  reason: v.optional(v.string()),
  boundary: v.optional(v.string()),
  transactionId: v.optional(v.string()),
  amount: v.optional(v.number()),
  limit: v.optional(v.number()),
  causeCode: v.optional(v.string()),
});

const postedLineValidator = v.object({
  lineIndex: v.number(),
  bucketKey: v.string(),
  itemId: v.id("items"),
  stockStatus,
  uom: v.string(),
  minorUnits: v.number(),
});

const postedTransactionValidator = v.object({
  transactionId: v.id("inventoryTransactions"),
  requestId: v.string(),
  operation: v.string(),
  type: inventoryTransactionType,
  warehouseId: v.id("warehouses"),
  occurredAt: v.number(),
  businessDate: v.string(),
  lineCount: v.number(),
  conservationGroupCount: v.number(),
  reversalOfTransactionId: v.optional(v.id("inventoryTransactions")),
  lines: v.array(postedLineValidator),
});

const postedBalanceValidator = v.object({
  bucketKey: v.string(),
  uom: v.string(),
  minorUnits: v.number(),
});

const postOutcomeValidator = v.union(
  v.object({
    posted: v.literal(true),
    replayed: v.boolean(),
    transaction: postedTransactionValidator,
    balances: v.array(postedBalanceValidator),
  }),
  v.object({
    posted: v.literal(false),
    error: publicLedgerErrorValidator,
  }),
);

function wireTransaction(transaction: PostedTransaction) {
  return {
    transactionId:
      transaction.transactionId as GenericId<"inventoryTransactions">,
    requestId: transaction.requestId,
    operation: transaction.operation,
    type: transaction.type,
    warehouseId: transaction.warehouseId as GenericId<"warehouses">,
    occurredAt: transaction.occurredAt,
    businessDate: transaction.businessDate,
    lineCount: transaction.lineCount,
    conservationGroupCount: transaction.conservationGroupCount,
    ...(transaction.reversalOfTransactionId === undefined
      ? {}
      : {
          reversalOfTransactionId:
            transaction.reversalOfTransactionId as GenericId<"inventoryTransactions">,
        }),
    lines: transaction.lines.map((line) => ({
      lineIndex: line.lineIndex,
      bucketKey: line.bucketKey,
      itemId: line.itemId as GenericId<"items">,
      stockStatus: line.stockStatus,
      uom: line.uom,
      minorUnits: line.minorUnits,
    })),
  };
}

const wireTransactionSummary = (
  item: TransactionSummary,
  locationBreadcrumbs: readonly string[] = [],
) => ({
  transactionId: item.transactionId as GenericId<"inventoryTransactions">,
  type: item.type,
  operation: item.operation,
  requestId: item.requestId,
  occurredAt: item.occurredAt,
  businessDate: item.businessDate,
  lineCount: item.lineCount,
  locationBreadcrumbs: [...locationBreadcrumbs],
  ...(item.reversalOfTransactionId === undefined
    ? {}
    : {
        reversalOfTransactionId:
          item.reversalOfTransactionId as GenericId<"inventoryTransactions">,
      }),
});

const wireBalanceSummary = (item: BalanceSummary, breadcrumb?: string) => ({
  bucketKey: item.bucketKey,
  stockStatus: item.stockStatus,
  uom: item.uom,
  minorUnits: item.minorUnits,
  ...(breadcrumb === undefined ? {} : { locationBreadcrumb: breadcrumb }),
});

const wireBalances = (balances: readonly PostedBalance[]) =>
  balances.map((balance) => ({
    bucketKey: balance.bucketKey,
    uom: balance.uom,
    minorUnits: balance.minorUnits,
  }));

const refusal = (error: LedgerStoreError) => ({
  posted: false as const,
  error: { ...toPublicLedgerError(error) },
});

/** A successful posting or replay. */
const posted = (outcome: PostOutcome) => ({
  posted: true as const,
  replayed: outcome.replayed,
  transaction: wireTransaction(outcome.result),
  balances: wireBalances(outcome.balances),
});

type WireLedgerError = {
  -readonly [Key in keyof PublicLedgerError]: PublicLedgerError[Key];
};

type WirePage<Item> =
  | {
      ok: true;
      items: Item[];
      nextCursor: string | null;
      complete: boolean;
    }
  | { ok: false; error: WireLedgerError };

type LedgerLineArgument = {
  readonly itemId: string;
  readonly locationKind: "PHYSICAL" | "VIRTUAL";
  readonly locationId?: string;
  readonly virtualBoundary?: string;
  readonly lotId?: string;
  readonly handlingUnitId?: string;
  readonly ownerId?: string;
  readonly stockStatus: StockStatus;
  readonly quantity: { readonly uom: string; readonly minorUnits: number };
};

function draftLine(
  orgId: string,
  warehouseId: string,
  line: LedgerLineArgument,
): LedgerLineDraft {
  const location: LedgerLocation =
    line.locationKind === "PHYSICAL"
      ? { kind: "PHYSICAL", locationId: line.locationId as string }
      : {
          kind: "VIRTUAL",
          boundary: line.virtualBoundary as VirtualBoundaryCode,
        };
  const bucket: InventoryBucket = {
    orgId,
    warehouseId,
    itemId: line.itemId,
    location,
    ...(line.lotId === undefined ? {} : { lotId: line.lotId }),
    ...(line.handlingUnitId === undefined
      ? {}
      : { handlingUnitId: line.handlingUnitId }),
    ...(line.ownerId === undefined ? {} : { ownerId: line.ownerId }),
    stockStatus: line.stockStatus,
  };
  return { bucket, quantity: line.quantity };
}

export const postTransaction = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),

    requestId: v.string(),
    type: inventoryTransactionType,
    source: inventoryTransactionSource,
    reasonCodeId: v.optional(v.id("reasonCodes")),

    installationId: v.optional(v.string()),
    lines: v.array(ledgerLineArgument),
  },
  returns: postOutcomeValidator,
  permissionCode: "inventory.transaction.post",
  target: { table: "inventoryTransactions" },
  warehouseId: ({ warehouseId }) => warehouseId,
  installationId: ({ installationId }) => installationId,
  handler: async (ctx, args) => {
    const orgId = ctx.tenant.organization._id;
    const now = Date.now();

    const outcome = await postLedgerTransaction({
      tenantDb: ctx.tenantDb,
      tenant: ctx.tenant,
      permissionCode: ctx.permission.code,
      now,
      ...(args.installationId === undefined
        ? {}
        : { installationId: args.installationId }),
      draft: {
        orgId,
        warehouseId: args.warehouseId,
        type: args.type,
        operation: LEDGER_OPERATIONS.post,
        requestId: args.requestId,
        actorUserId: ctx.tenant.actor._id,
        occurredAt: now,
        source: args.source,
        ...(args.reasonCodeId === undefined
          ? {}
          : { reasonCodeId: args.reasonCodeId }),
        lines: args.lines.map((line) =>
          draftLine(orgId, args.warehouseId, line as LedgerLineArgument),
        ),
      },
    });

    if (!outcome.ok) return refusal(outcome.error);
    return posted(outcome.value);
  },
});

async function reversalPolicy(
  ctx: TenantPolicyContext,
  args: { readonly originalTransactionId: string },
): Promise<{
  readonly thresholdExceeded: boolean;
  readonly approvalSatisfied: boolean;
  readonly makerUserId?: string;
}> {
  const original = await ctx.tenantDb.get<{
    readonly orgId: TenantOrgId;
    readonly actorUserId: string;
  }>("inventoryTransactions", args.originalTransactionId);

  if (original === null) {
    return Object.freeze({
      thresholdExceeded: false,
      approvalSatisfied: false,
    });
  }
  return Object.freeze({
    thresholdExceeded: false,
    approvalSatisfied: true,
    makerUserId: original.actorUserId,
  });
}

export const reverseTransaction = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    originalTransactionId: v.id("inventoryTransactions"),
    requestId: v.string(),
    reasonCodeId: v.id("reasonCodes"),
    installationId: v.optional(v.string()),
  },
  returns: postOutcomeValidator,
  permissionCode: "inventory.transaction.reverse",
  target: {
    table: "inventoryTransactions",
    id: ({ originalTransactionId }) => originalTransactionId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  installationId: ({ installationId }) => installationId,
  policy: (ctx, args) => reversalPolicy(ctx, args),
  handler: async (ctx, args) => {
    const now = Date.now();
    const outcome = await reverseLedgerTransaction({
      tenantDb: ctx.tenantDb,
      tenant: ctx.tenant,
      permissionCode: ctx.permission.code,
      now,
      ...(args.installationId === undefined
        ? {}
        : { installationId: args.installationId }),
      warehouseId: args.warehouseId,
      originalTransactionId: args.originalTransactionId,
      requestId: args.requestId,
      operation: LEDGER_OPERATIONS.reverse,
      actorUserId: ctx.tenant.actor._id,
      reasonCodeId: args.reasonCodeId,
    });

    if (!outcome.ok) return refusal(outcome.error);
    return posted(outcome.value);
  },
});

const transactionDetailValidator = v.union(
  v.object({
    found: v.literal(true),
    transaction: postedTransactionValidator,
    balances: v.array(postedBalanceValidator),
  }),
  v.object({ found: v.literal(false), error: publicLedgerErrorValidator }),
);

export const getTransaction = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    transactionId: v.id("inventoryTransactions"),
  },
  returns: transactionDetailValidator,
  permissionCode: "inventory.history.read",
  target: {
    table: "inventoryTransactions",
    id: ({ transactionId }) => transactionId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const outcome = await readTransactionWithBalances(
      ctx.tenantDb,
      args.transactionId,
    );
    if (!outcome.ok) {
      return {
        found: false as const,
        error: { ...toPublicLedgerError(outcome.error) },
      };
    }
    if (outcome.value.result.warehouseId !== args.warehouseId) {
      return {
        found: false as const,
        error: {
          ...toPublicLedgerError({
            code: "TRANSACTION_OUT_OF_WAREHOUSE_SCOPE",
            expected: args.warehouseId,
            received: outcome.value.result.warehouseId,
          }),
        },
      };
    }
    return {
      found: true as const,
      transaction: wireTransaction(outcome.value.result),
      balances: wireBalances(outcome.value.balances),
    };
  },
});

const transactionSummaryValidator = v.object({
  transactionId: v.id("inventoryTransactions"),
  type: inventoryTransactionType,
  operation: v.string(),
  requestId: v.string(),
  occurredAt: v.number(),
  businessDate: v.string(),
  lineCount: v.number(),
  reversalOfTransactionId: v.optional(v.id("inventoryTransactions")),
  locationBreadcrumbs: v.array(v.string()),
});

const historyPageValidator = v.union(
  v.object({
    ok: v.literal(true),
    items: v.array(transactionSummaryValidator),
    nextCursor: v.union(v.string(), v.null()),
    complete: v.boolean(),
  }),
  v.object({ ok: v.literal(false), error: publicLedgerErrorValidator }),
);

export const listTransactions = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    maxPageSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: historyPageValidator,
  permissionCode: "inventory.history.read",
  target: { table: "inventoryTransactions" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (
    ctx,
    args,
  ): Promise<WirePage<ReturnType<typeof wireTransactionSummary>>> => {
    const request = pageRequestOf(args);
    if (!request.ok) {
      return {
        ok: false as const,
        error: {
          ...toPublicLedgerError(request.error as unknown as LedgerStoreError),
        },
      };
    }
    const page = await readTransactionHistoryPage(
      ctx.tenantDb,
      args.warehouseId,
      request.value,
    );
    if (!page.ok) {
      return {
        ok: false as const,
        error: { ...toPublicLedgerError(page.error) },
      };
    }
    return {
      ok: true as const,
      items: await Promise.all(
        page.value.items.map(async (item) => {
          const lines = await ctx.tenantDb
            .byIndex<{
              readonly _id: string;
              readonly orgId: TenantOrgId;
              readonly bucketKey: string;
            }>("inventoryLedgerLines", "by_orgId_transactionId_lineIndex", [
              { field: "transactionId", value: item.transactionId },
            ])
            .take(100);
          const breadcrumbs = new Set<string>();
          for (const line of lines) {
            const decoded = decodeBucketKey(line.bucketKey);
            if (!decoded.ok || decoded.value.location.kind !== "PHYSICAL") {
              continue;
            }
            const breadcrumb = await storageLocationBreadcrumb(
              ctx.tenantDb,
              decoded.value.location.locationId,
            );
            if (breadcrumb !== undefined) breadcrumbs.add(breadcrumb);
          }
          return wireTransactionSummary(item, [...breadcrumbs]);
        }),
      ),
      nextCursor: page.value.nextCursor,
      complete: page.value.complete,
    };
  },
});

const balanceSummaryValidator = v.object({
  bucketKey: v.string(),
  stockStatus,
  uom: v.string(),
  minorUnits: v.number(),
  locationBreadcrumb: v.optional(v.string()),
});

const balancePageValidator = v.union(
  v.object({
    ok: v.literal(true),
    items: v.array(balanceSummaryValidator),
    nextCursor: v.union(v.string(), v.null()),
    complete: v.boolean(),
  }),
  v.object({ ok: v.literal(false), error: publicLedgerErrorValidator }),
);

export const listBalances = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    maxPageSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: balancePageValidator,
  permissionCode: "inventory.balance.read",
  target: { table: "inventoryBalances" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (
    ctx,
    args,
  ): Promise<WirePage<ReturnType<typeof wireBalanceSummary>>> => {
    const request = pageRequestOf(args);
    if (!request.ok) {
      return {
        ok: false as const,
        error: {
          ...toPublicLedgerError(request.error as unknown as LedgerStoreError),
        },
      };
    }
    const page = await readBalancePage(
      ctx.tenantDb,
      args.warehouseId,
      request.value,
    );
    if (!page.ok) {
      return {
        ok: false as const,
        error: { ...toPublicLedgerError(page.error) },
      };
    }
    return {
      ok: true as const,
      items: await Promise.all(
        page.value.items.map(async (item) => {
          const decoded = decodeBucketKey(item.bucketKey);
          const breadcrumb =
            decoded.ok && decoded.value.location.kind === "PHYSICAL"
              ? await storageLocationBreadcrumb(
                  ctx.tenantDb,
                  decoded.value.location.locationId,
                )
              : undefined;
          return wireBalanceSummary(item, breadcrumb);
        }),
      ),
      nextCursor: page.value.nextCursor,
      complete: page.value.complete,
    };
  },
});

const driftValidator = v.object({
  bucketKey: v.string(),
  kind: v.union(
    v.literal("MISSING_BALANCE"),
    v.literal("EXTRA_BALANCE"),
    v.literal("QUANTITY_MISMATCH"),
    v.literal("UOM_MISMATCH"),
  ),
  projectedMinorUnits: v.optional(v.number()),
  storedMinorUnits: v.optional(v.number()),
  projectedUom: v.optional(v.string()),
  storedUom: v.optional(v.string()),
});

const reconciliationPageValidator = v.union(
  v.object({
    ok: v.literal(true),
    bucketKey: v.string(),
    linesRead: v.number(),
    nextCursor: v.union(v.string(), v.null()),
    complete: v.boolean(),
    carryUom: v.union(v.string(), v.null()),
    carryMinorUnits: v.union(v.number(), v.null()),

    drift: v.optional(v.array(driftValidator)),
  }),
  v.object({ ok: v.literal(false), error: publicLedgerErrorValidator }),
);

export const reconcileBucket = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    bucketKey: v.string(),
    maxPageSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
    carryUom: v.optional(v.string()),
    carryMinorUnits: v.optional(v.number()),
  },
  returns: reconciliationPageValidator,
  permissionCode: "inventory.balance.read",
  target: { table: "inventoryBalances" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const decoded = decodeBucketKey(args.bucketKey);
    if (!decoded.ok) {
      return {
        ok: false as const,
        error: {
          ...toPublicLedgerError({
            code: "LINE_BUCKET_INVALID",
            index: -1,
            cause: decoded.error,
          }),
        },
      };
    }
    if (
      decoded.value.orgId !== ctx.tenant.organization._id ||
      decoded.value.warehouseId !== args.warehouseId
    ) {
      return {
        ok: false as const,
        error: {
          ...toPublicLedgerError({
            code: "BUCKET_OUT_OF_WAREHOUSE_SCOPE",
            expected: args.warehouseId,
            received: decoded.value.warehouseId,
          }),
        },
      };
    }

    const request = pageRequestOf(args);
    if (!request.ok) {
      return {
        ok: false as const,
        error: {
          ...toPublicLedgerError(request.error as unknown as LedgerStoreError),
        },
      };
    }

    const carry =
      args.carryUom === undefined || args.carryMinorUnits === undefined
        ? null
        : { uom: args.carryUom, minorUnits: args.carryMinorUnits };

    const page = await reconcileBucketPage(
      ctx.tenantDb,
      args.bucketKey,
      request.value,
      carry,
    );
    if (!page.ok) {
      return {
        ok: false as const,
        error: { ...toPublicLedgerError(page.error) },
      };
    }
    return {
      ok: true as const,
      bucketKey: page.value.bucketKey,
      linesRead: page.value.page.items.length,
      nextCursor: page.value.page.nextCursor,
      complete: page.value.page.complete,
      carryUom: page.value.carry === null ? null : page.value.carry.uom,
      carryMinorUnits:
        page.value.carry === null ? null : page.value.carry.minorUnits,
      ...(page.value.drift === undefined
        ? {}
        : { drift: page.value.drift.map((record) => ({ ...record })) }),
    };
  },
});

export const maxLedgerPageSize = MAX_JOB_PAGE_SIZE;
