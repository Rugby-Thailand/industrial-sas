/**
 * The inventory ledger's public surface.
 *
 * Six functions, all registered through `queryWithOrg`/`mutationWithOrg`, which is
 * the only registration path this repository permits
 * (`scripts/verify-tenant-boundary.mjs`, rule `registration`). Each declares a
 * code-owned permission and cannot be registered without one (`INV-0006-01`), and
 * each is warehouse-scoped, so the server revalidates the target warehouse against
 * the actor's membership before the handler runs (`INV-0006-04`).
 *
 * Nothing here writes. Every write goes through `convex/lib/inventoryLedgerStore.ts`
 * — the one module allowed to touch `inventoryTransactions`,
 * `inventoryLedgerLines`, and `inventoryBalances` — and the guard fails the build if
 * this file, or any other, inserts a balance row. That split is the point: the
 * public surface owns arguments, authorization declarations, and the wire shape; the
 * store owns the invariants.
 *
 * ### What the client is not allowed to supply
 *
 * - **`orgId`.** Never an argument. It comes from the resolved tenant context
 *   (`INV-0001-02`).
 * - **`actorUserId`.** From the mirrored actor the wrapper resolved from a verified
 *   Clerk token, never from the request.
 * - **`occurredAt`.** The server clock. A client-supplied instant would let a
 *   handheld backdate stock into a closed period.
 * - **`deviceId`.** Only the opaque `installationId` the PWA mints, resolved through
 *   the organization's own index. A device is correlation, never an authorization
 *   subject (`ADR-0006` §8).
 * - **`serialId`.** Not in any argument shape. The schema is serial-ready and the
 *   flows stay off (D-09, `INV-0005-08`); the store refuses a serial outright.
 * - **A balance.** There is no function here that sets, edits, or deletes one
 *   (`INV-0003-11`).
 *
 * ### Failures are values, not throws
 *
 * A domain refusal — unbalanced, negative, a foreign reference, a reused request ID
 * — comes back as `{ posted: false, error }` inside the wrapper's success envelope.
 * A caller has to handle it to compile, and a Thai or English message is the UI's to
 * choose from the `code` (D-06). An *authorization* denial is the wrapper's own
 * envelope (`{ ok: false, denial }`), which keeps "you may not" and "that would be
 * wrong" distinguishable on the client.
 */
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
import { LEDGER_OPERATIONS } from "../model/inventory/requestIdentity";
import {
  decodeBucketKey,
  type InventoryBucket,
  type LedgerLocation,
  type StockStatus,
  type VirtualBoundaryCode,
} from "../model/inventory/stockIdentity";
import type { LedgerLineDraft } from "../model/inventory/ledgerTransaction";

/* -------------------------------------------------------------------------- */
/* Argument and return shapes                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One line, as a client writes it.
 *
 * `locationKind` is the discriminant and both payload fields are optional, because
 * Convex validators cannot express dependent optionality. The pure kernel decides
 * which combination is legal; a `PHYSICAL` line with no `locationId` is
 * `LINE_BUCKET_INVALID` from there rather than a row with a hole in it.
 */
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

/**
 * The wire shape of a posting.
 *
 * `replayed` sits beside `transaction` rather than inside it, so a retry's
 * `transaction` is structurally identical to the original's — which is the
 * observable form of `INV-0003-01` and is what the property test compares.
 */
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

/**
 * The wire form of a posted transaction.
 *
 * A shallow copy with mutable arrays, because a Convex `returns` validator
 * describes the serialized value and `readonly` is not part of that description.
 * The copy is the boundary: the store's own values stay frozen, and nothing a
 * caller does to what it receives can reach them.
 */
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

/** The wire form of one transaction-history row. */
const wireTransactionSummary = (item: TransactionSummary) => ({
  transactionId: item.transactionId as GenericId<"inventoryTransactions">,
  type: item.type,
  operation: item.operation,
  requestId: item.requestId,
  occurredAt: item.occurredAt,
  businessDate: item.businessDate,
  lineCount: item.lineCount,
  ...(item.reversalOfTransactionId === undefined
    ? {}
    : {
        reversalOfTransactionId:
          item.reversalOfTransactionId as GenericId<"inventoryTransactions">,
      }),
});

/** The wire form of one balance row. */
const wireBalanceSummary = (item: BalanceSummary) => ({
  bucketKey: item.bucketKey,
  stockStatus: item.stockStatus,
  uom: item.uom,
  minorUnits: item.minorUnits,
});

/** The wire form of a balance list. */
const wireBalances = (balances: readonly PostedBalance[]) =>
  balances.map((balance) => ({
    bucketKey: balance.bucketKey,
    uom: balance.uom,
    minorUnits: balance.minorUnits,
  }));

/** A refusal, with the structured error flattened for the wire. */
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

/** The wire error, with mutable optional fields as a Convex validator sees them. */
type WireLedgerError = {
  -readonly [Key in keyof PublicLedgerError]: PublicLedgerError[Key];
};

/** A paged wire answer: the items, the cursor, and completion — or a refusal. */
type WirePage<Item> =
  | {
      ok: true;
      items: Item[];
      nextCursor: string | null;
      complete: boolean;
    }
  | { ok: false; error: WireLedgerError };

/* -------------------------------------------------------------------------- */
/* Argument translation                                                        */
/* -------------------------------------------------------------------------- */

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

/**
 * Turn the flat wire line into the kernel's bucket-plus-quantity shape.
 *
 * A translation and nothing else: no defaulting, no coercion, no dropped field. Any
 * value that is wrong — a `PHYSICAL` line with a boundary, a boundary code the
 * catalogue does not define, a non-integer quantity — reaches
 * `validateLedgerTransaction` and is refused by name there, which keeps one module
 * responsible for what a legal line is.
 */
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

/* -------------------------------------------------------------------------- */
/* Posting                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Post a balanced inventory transaction, or replay the one this request already
 * produced.
 *
 * The foundation primitive. The inbound features — receipt, QC disposition, pallet
 * build, putaway confirmation — will each own their own permission and their own
 * argument shape and will call the same store, so the invariants are proved once.
 * Until they exist, this is how a transaction is posted, which is why the permission
 * it declares (`inventory.transaction.post`) is granted only to roles that supervise
 * stock rather than to every handheld operator.
 */
export const postTransaction = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    /** Client-generated UUIDv7, stable across retries of one intent (§5 Q30). */
    requestId: v.string(),
    type: inventoryTransactionType,
    source: inventoryTransactionSource,
    reasonCodeId: v.optional(v.id("reasonCodes")),
    /** Opaque PWA installation value, for device correlation only. */
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

/* -------------------------------------------------------------------------- */
/* Reversal                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The server-computed policy facts for a reversal.
 *
 * `inventory.transaction.reverse` carries threshold, maker-checker, and step-up
 * (catalogue §2.8), so the wrapper requires a policy callback and refuses to
 * register the function without one. Both facts below are computed here, from the
 * trusted context and the tenant's own rows — never from a request field, which is
 * the whole reason the callback exists rather than an argument.
 *
 * - **Maker-checker** is separation of duties on the correction: `makerUserId` is
 *   the actor who posted the *original* transaction, read through the tenant-bound
 *   accessor, and `approvalSatisfied` is true once that original has been found and
 *   belongs to this tenant. The evaluator then denies with `APPROVAL_REQUIRED` when
 *   the maker and the actor are the same person (`INV-0006-05`). A reversal is
 *   therefore always a second pair of eyes, enforced rather than asked for.
 * - **Threshold** is `thresholdExceeded: false`, and that is **provisional**. No
 *   threshold values exist yet: there is no policy table and `RG-030` is open (§5
 *   Q26). "Nothing exceeds an unconfigured threshold" is the only honest reading of
 *   an absent policy, and it is stated here rather than hidden so the gate is
 *   findable. When `RG-030` lands, this reads the configured limit against the
 *   reversal's own magnitude, and the denial becomes reachable.
 *
 * A callback that throws contributes no facts and the request denies, which is the
 * wrapper's behaviour and the correct one: a broken policy must not become an
 * allowed reversal.
 */
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

/**
 * Reverse one transaction with an exact compensating posting (`INV-0003-08`).
 *
 * The original is never modified, never deleted, and never marked: it stays exactly
 * as it was, and the correction is a second transaction that names it. A reversal
 * cannot be reversed, a transaction cannot be reversed twice, and neither can be
 * reversed across organizations or outside the warehouse the permission was decided
 * in.
 */
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

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

const transactionDetailValidator = v.union(
  v.object({
    found: v.literal(true),
    transaction: postedTransactionValidator,
    balances: v.array(postedBalanceValidator),
  }),
  v.object({ found: v.literal(false), error: publicLedgerErrorValidator }),
);

/**
 * One transaction and its lines, plus the current balances of its buckets.
 *
 * The transaction is read through the tenant-bound accessor, so another tenant's ID
 * answers `REFERENCE_NOT_FOUND` — the same answer as an ID that never existed. The
 * warehouse is then checked as well: within one tenant, a warehouse-scoped actor
 * must not read another site's ledger just because the permission decision was made
 * for a warehouse they do hold (`INV-0006-04`).
 */
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

/**
 * A bounded, resumable page of one warehouse's transaction history.
 *
 * There is no unpaged variant, and no `collect`: the accessor this reads through has
 * neither, and a tenant accumulates roughly a million ledger lines a year (B-11). A
 * page size above `MAX_JOB_PAGE_SIZE` is refused rather than clamped, so a caller
 * that asked for five thousand rows finds out instead of silently receiving a
 * hundred.
 */
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
      items: page.value.items.map(wireTransactionSummary),
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

/**
 * A bounded, resumable page of one warehouse's current balances.
 *
 * Read-only, and the only way to see a balance. There is deliberately no companion
 * that writes one: `INV-0003-11` is that no such API exists, and the guard proves
 * it for the whole `convex/` tree rather than for this file alone.
 */
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
      items: page.value.items.map(wireBalanceSummary),
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
    /** Present only on the final page: the verdict for this bucket. */
    drift: v.optional(v.array(driftValidator)),
  }),
  v.object({ ok: v.literal(false), error: publicLedgerErrorValidator }),
);

/**
 * Reconcile one bucket, one resumable page of its ledger lines at a time
 * (`INV-0003-10`).
 *
 * A query, not a cron. Nothing here schedules anything and no cloud resource is
 * created: the scheduling boundary is the caller's — a Convex cron, a Workpool job,
 * or a test loop — and this is the bounded step it drives (`ADR-0011`, §5 Q34).
 * Making it a query is also what makes it safe: reconciliation *reports* drift and
 * must not repair it, and a query cannot write (`OPS-0003-02`).
 *
 * The caller carries the running total between pages (`carryUom`,
 * `carryMinorUnits`), because a resumable fold has to keep its accumulator
 * somewhere and a server-side scratch table would be state nobody audits. The
 * verdict arrives with the final page, where the replayed total is complete;
 * comparing a partial total would report drift on every bucket with more history
 * than one page.
 *
 * The bucket key is checked against the authorized warehouse by *decoding* it, so a
 * key naming another site — or another tenant — is refused before a line is read.
 */
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

/** The strict page-size cap, re-exported so a client can size its own loop. */
export const maxLedgerPageSize = MAX_JOB_PAGE_SIZE;
