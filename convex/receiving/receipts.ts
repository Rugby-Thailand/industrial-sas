/**
 * Receiving: the point where a pallet on a dock becomes a ledger balance.
 *
 * This is the spine of the inbound slice, and almost everything it does is
 * delegation. The tolerance arithmetic is `receiptPolicy`, the unit conversion is
 * the UOM kernel, the QC decision is `qcPolicy`, and the posting itself is
 * `postLedgerTransaction`. What this module owns is the *order* those happen in
 * and the fact that they happen in **one transaction**: the receipt line, the
 * running received total, the ledger posting, the audit row, and the idempotency
 * record either all commit or none do.
 *
 * ### Why a receipt line cannot exist without a transaction
 *
 * `receiptLines.transactionId` is required by the schema. A receipt line with no
 * posting would be stock somebody recorded and the ledger never saw — the exact
 * drift `ADR-0003` exists to make impossible, and the kind that is invisible
 * until a stock count months later.
 *
 * ### Why exceptions are separate mutations
 *
 * `receiving.receipt.unexpected` and `receiving.receipt.blind` carry
 * maker-checker in the catalogue. Routing them through the normal posting with a
 * client-supplied "kind" flag would let a handheld declare its own posting
 * ordinary and walk around the permission that exists to catch it
 * (`INV-0007-04`). So the kind is decided by the server from the row it read,
 * and each exception has its own entry point with its own declared permission.
 */
import { v } from "convex/values";

import { postLedgerTransaction } from "../lib/inventoryLedgerStore";
import type { LedgerTransactionDraft } from "../model/inventory/ledgerTransaction";
import {
  CODE_FIELD,
  createMasterDataRow,
  normalizeField,
} from "../lib/masterDataStore";
import { adjustRollup } from "../lib/rollupStore";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
  type TenantPolicyContext,
} from "../lib/tenantFunctions";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import {
  listArgs,
  pageOf,
  pageOptions,
  pageRefusal,
  pageRequestOf,
} from "../lib/listEnvelope";
import {
  receiptClassification,
  receiptLineKind,
  signedQuantity,
  stockStatus,
} from "../lib/validators";
import { RECEIVING_LOCATION_TYPES } from "../masterData/catalogue";
import { MAX_JOB_PAGE_SIZE } from "../model/inventory/jobPage";
import {
  NO_TOLERANCE,
  assessReceipt,
  acceptsReceipt,
  makeTolerance,
  statusAfterReceipt,
  type ReceiptTolerance,
} from "../model/inbound/receiptPolicy";
import {
  planSample,
  receiptStockStatus,
  resolveQcApplicability,
  type QcProfileMatch,
} from "../model/inbound/qcPolicy";
import {
  businessDateFromInstant,
  businessDateToIso,
} from "../model/time/businessDate";
import { zoneById } from "../model/time/businessDate";
import { convertOrderedToBase } from "../purchasing/orders";

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

export const RECEIVING_OPERATIONS = Object.freeze({
  openReceipt: "receiving.receipt.open",
  postLine: "receiving.receipt.postLine",
  postExceptionLine: "receiving.receipt.postExceptionLine",
  raiseException: "receiving.exception.raise",
  buildHandlingUnit: "receiving.handlingUnit.build",
});

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                  */
/* -------------------------------------------------------------------------- */

interface ReceiptDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly purchaseOrderId?: string;
  readonly receiptNumber: string;
  readonly businessDate: string;
}

/** Only the field the receiving screens display: the order's own number. */
interface OrderDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly poNumber: string;
}

interface OrderLineDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly purchaseOrderId: string;
  readonly itemId: string;
  readonly orderedBaseMinorUnits: number;
  readonly receivedBaseMinorUnits: number;
  readonly status: string;
}

interface ItemDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly sku: string;
  readonly baseUom: string;
  readonly trackingMode: string;
  readonly status: string;
}

interface LotDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly itemId: string;
  readonly lotCode: string;
}

interface QcProfileDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly itemId?: string;
  readonly supplierId?: string;
  readonly enabled: boolean;
  readonly strategy: string;
  readonly parameter?: number;
}

interface ExceptionDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly kind: string;
  readonly itemId?: string;
  readonly status: string;
  readonly raisedByUserId: string;
  readonly reasonCodeId: string;
}

/* -------------------------------------------------------------------------- */
/* Tolerance policy                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The organization's over-receipt tolerance.
 *
 * Read from settings when the tenant has configured one, and `NONE` otherwise.
 * `OPS-0007-02` — confirming the tolerance with the pilot tenant — is an **open
 * gate**, so the unconfigured case is the one every deployment is in today; it
 * refuses every extra unit without an approval, which is the fail-closed reading
 * and the one an auditor would expect of an unconfigured policy.
 */
function toleranceFrom(settings: unknown): ReceiptTolerance {
  if (typeof settings !== "object" || settings === null) return NO_TOLERANCE;
  const raw = (settings as { readonly receiptTolerancePercent?: unknown })
    .receiptTolerancePercent;
  if (typeof raw !== "number") return NO_TOLERANCE;

  const tolerance = makeTolerance(Math.round(raw * 100), 10_000);
  return tolerance.ok ? tolerance.value : NO_TOLERANCE;
}

/* -------------------------------------------------------------------------- */
/* Receipt headers                                                             */
/* -------------------------------------------------------------------------- */

/** Open a receipt so lines have something to belong to. */
export const openReceipt = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    receiptNumber: v.string(),
    purchaseOrderId: v.optional(v.id("purchaseOrders")),
  },
  returns: writeOutcomeValidator,
  permissionCode: "receiving.receipt.post",
  target: { table: "receipts" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const receiptNumber = normalizeField(
      "receiptNumber",
      args.receiptNumber,
      CODE_FIELD,
    );
    if (!receiptNumber.ok) return refusal(receiptNumber.error);

    if (args.purchaseOrderId !== undefined) {
      const order = await ctx.tenantDb.get(
        "purchaseOrders",
        args.purchaseOrderId,
      );
      if (order === null) {
        return refusal({
          code: "REFERENCE_NOT_FOUND",
          field: "purchaseOrderId",
        });
      }
    }

    const now = Date.now();
    const businessDate = businessDateIsoFor(ctx, now);
    if (!businessDate.ok) return refusal(businessDate.error);

    const document = {
      warehouseId: args.warehouseId,
      receiptNumber: receiptNumber.value,
      receivedByUserId: ctx.tenant.actor._id,
      occurredAt: now,
      businessDate: businessDate.value,
      ...(args.purchaseOrderId === undefined
        ? {}
        : { purchaseOrderId: args.purchaseOrderId }),
    };

    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "receipts",
        operation: RECEIVING_OPERATIONS.openReceipt,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint: { ...document, occurredAt: undefined },
      uniqueness: [
        {
          field: "receiptNumber",
          index: "by_orgId_receiptNumber",
          equality: [{ field: "receiptNumber", value: receiptNumber.value }],
        },
      ],
      document,
    });

    /*
     * Counted only when the row is new. A replay answers with the receipt the
     * original request created, and counting it again would make the tile grow
     * every time a handheld retried through a dropped connection — the exact
     * condition the idempotency machinery exists for.
     */
    if (outcome.ok && !outcome.value.replayed) {
      await adjustRollup({
        tenantDb: ctx.tenantDb,
        warehouseId: args.warehouseId,
        metric: "RECEIPTS_OPENED",
        delta: 1,
        now,
      });
    }

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/** The organization's business date for an instant (`ADR-0011`, `G-105`). */
function businessDateIsoFor(
  ctx: TenantFunctionContext,
  instant: number,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: { code: string; field?: string } } {
  const zone = zoneById(ctx.tenant.organization.settings.timezone);
  if (!zone.ok) {
    return { ok: false, error: { code: "UNKNOWN_ORGANIZATION_TIMEZONE" } };
  }
  const date = businessDateFromInstant(instant, zone.value);
  if (!date.ok) {
    return { ok: false, error: { code: "FIELD_INVALID", field: "occurredAt" } };
  }
  const iso = businessDateToIso(date.value);
  if (!iso.ok) {
    return {
      ok: false,
      error: { code: "FIELD_INVALID", field: "businessDate" },
    };
  }
  return { ok: true, value: iso.value };
}

/* -------------------------------------------------------------------------- */
/* The posting itself                                                          */
/* -------------------------------------------------------------------------- */

const postOutcomeValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),
    transactionId: v.string(),
    classification: receiptClassification,
    kind: receiptLineKind,
    stockStatus,
    baseMinorUnits: v.number(),
    /** True when the server thinks this may be a double scan (`ADR-0007` §3). */
    plausibleDuplicate: v.boolean(),
    /** Present when the receipt landed in `QC_HOLD` and opened an inspection. */
    inspectionId: v.optional(v.string()),
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

interface PostLineInput {
  readonly requestId: string;
  readonly warehouseId: string;
  readonly receiptId: string;
  readonly locationId: string;
  readonly itemId: string;
  readonly quantity: { readonly uom: string; readonly minorUnits: number };
  readonly lotCode?: string | undefined;
  readonly expirationDate?: string | undefined;
  readonly manufactureDate?: string | undefined;
  readonly purchaseOrderLineId?: string | undefined;
  readonly handlingUnitId?: string | undefined;
  readonly overrideKind?: "UNEXPECTED" | "CANCELLED_LINE" | "BLIND" | undefined;
  readonly exceptionId?: string | undefined;
}

/**
 * The whole receipt posting, shared by the ordinary and the exception paths.
 *
 * Written once and called from three mutations rather than copied, because the
 * part that must not vary between them is exactly the part that is hard: the
 * conversion, the tolerance assessment, the QC decision, the ledger draft, and
 * the running total, all inside one transaction. What varies is the permission
 * the caller declared and the kind the server assigns — and those are arguments.
 */
type PostLineOutcome =
  | {
      readonly written: true;
      readonly documentId: string;
      readonly replayed: boolean;
      readonly transactionId: string;
      readonly classification:
        | "PARTIAL"
        | "COMPLETE"
        | "OVER_WITHIN_TOLERANCE"
        | "OVER_BEYOND_TOLERANCE";
      readonly kind: "ORDERED" | "UNEXPECTED" | "CANCELLED_LINE" | "BLIND";
      readonly stockStatus: "AVAILABLE" | "QC_HOLD";
      readonly baseMinorUnits: number;
      readonly plausibleDuplicate: boolean;
      readonly inspectionId?: string;
    }
  | ReturnType<typeof refusal>;

async function postLine(
  ctx: TenantFunctionContext,
  input: PostLineInput,
): Promise<PostLineOutcome> {
  const receipt = await ctx.tenantDb.get<ReceiptDocument>(
    "receipts",
    input.receiptId,
  );
  if (receipt === null)
    return refusal({ code: "NOT_FOUND", table: "receipts" });

  const item = await ctx.tenantDb.get<ItemDocument>("items", input.itemId);
  if (item === null) {
    return refusal({ code: "REFERENCE_NOT_FOUND", field: "itemId" });
  }
  if (item.status !== "ACTIVE") {
    return refusal({ code: "ITEM_NOT_ACTIVE", field: "itemId" });
  }

  /*
   * The location is validated here, not merely picked in a UI. A picker is a
   * suggestion; this is the constraint. Three things have to hold and each has a
   * way of going wrong that a screen cannot prevent:
   *
   * - **Active.** A deactivated dock is one somebody withdrew from use.
   * - **This warehouse.** Two sites' docks look alike in a list, and the
   *   warehouse edge is a real boundary (`INV-0006-04`).
   * - **A dock or a staging lane.** Receiving straight to a rack would put the
   *   stock where putaway was going to move it, making the task a fiction.
   *
   * All three answer with one code. Which of them failed is a detail an
   * authorized operator may see on their own tenant's data, and the field name
   * is what they can act on.
   */
  const location = await ctx.tenantDb.get<{
    readonly _id: string;
    readonly orgId: TenantOrgId;
    readonly warehouseId: string;
    readonly locationType: string;
    readonly status: string;
  }>("locations", input.locationId);
  if (location === null) {
    return refusal({ code: "REFERENCE_NOT_FOUND", field: "locationId" });
  }
  if (
    location.status !== "ACTIVE" ||
    location.warehouseId !== input.warehouseId ||
    !RECEIVING_LOCATION_TYPES.includes(location.locationType)
  ) {
    return refusal({ code: "LOCATION_NOT_RECEIVABLE", field: "locationId" });
  }

  // Convert what the operator captured into the item's base minor units. The
  // kernel is the only implementation of the conversion (`ADR-0004`).
  const base = await convertOrderedToBase(ctx.tenantDb, item, input.quantity);
  if (!base.ok) return refusal(base.error);

  /* ---------------------------------------------------------------------- */
  /* Order line, tolerance, and kind                                        */
  /* ---------------------------------------------------------------------- */

  let orderLine: OrderLineDocument | null = null;
  if (input.purchaseOrderLineId !== undefined) {
    orderLine = await ctx.tenantDb.get<OrderLineDocument>(
      "purchaseOrderLines",
      input.purchaseOrderLineId,
    );
    if (orderLine === null) {
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "purchaseOrderLineId",
      });
    }

    /*
     * The line must be on the order the receipt names. Otherwise a posting would
     * advance the received total of an order nobody is receiving, and the two
     * documents would disagree about what arrived — a disagreement that only
     * surfaces when a buyer reconciles months later.
     */
    if (
      receipt.purchaseOrderId !== undefined &&
      orderLine.purchaseOrderId !== receipt.purchaseOrderId
    ) {
      return refusal({
        code: "LINE_NOT_ON_RECEIPT_ORDER",
        field: "purchaseOrderLineId",
      });
    }
  }

  /*
   * The kind is decided by the server, from rows it read, and the caller's
   * `overrideKind` only *narrows* what the entry point already declared. A
   * handheld that could name its own kind would route an unexpected delivery
   * around the permission built to catch it (`INV-0007-04`).
   */
  const kind =
    input.overrideKind ??
    (orderLine === null
      ? "BLIND"
      : orderLine.status === "CANCELLED"
        ? "CANCELLED_LINE"
        : orderLine.itemId !== input.itemId
          ? "UNEXPECTED"
          : "ORDERED");

  /*
   * The ordinary entry point posts *ordinary* receipts and nothing else.
   *
   * The kind is derived from the rows the server read, so a delivery of the
   * wrong item derives `UNEXPECTED` — and that is an exception with its own
   * permission and its own maker (`INV-0007-04`). Letting it through here
   * because the derivation was correct would route the delivery around the very
   * control built to catch it: the caller declared `receiving.receipt.post`,
   * and `receiving.receipt.unexpected` is a different code with maker-checker
   * on it.
   *
   * The exception entry point passes `overrideKind` from a raised exception,
   * which is how it says "this one has a maker" — so the check is on the absence
   * of that, never on a claim the client made about the kind.
   */
  if (input.overrideKind === undefined && kind !== "ORDERED") {
    return refusal(
      kind === "UNEXPECTED"
        ? { code: "ITEM_NOT_ON_LINE", field: "itemId" }
        : { code: "EXCEPTION_REQUIRED", status: kind },
    );
  }

  if (
    kind === "ORDERED" &&
    orderLine !== null &&
    !acceptsReceipt(orderLine.status as "OPEN")
  ) {
    return refusal({ code: "LINE_NOT_OPEN", status: orderLine.status });
  }

  const tolerance = toleranceFrom(ctx.tenant.organization.settings);
  const assessment =
    orderLine === null || kind !== "ORDERED"
      ? null
      : assessReceipt({
          orderedMinorUnits: orderLine.orderedBaseMinorUnits,
          alreadyReceivedMinorUnits: orderLine.receivedBaseMinorUnits,
          incomingMinorUnits: base.baseMinorUnits,
          tolerance,
        });

  if (assessment !== null && !assessment.ok) return refusal(assessment.error);

  /*
   * Over-tolerance needs `receiving.receipt.overTolerance`, which this entry
   * point does not declare. Refusing here rather than posting is `INV-0007-02`:
   * the approval is a different permission with maker-checker on it, and a
   * posting that quietly accepted the extra would make that permission
   * decorative.
   */
  if (assessment !== null && assessment.value.requiresApproval) {
    return refusal({
      code: "OVER_TOLERANCE_APPROVAL_REQUIRED",
      field: "quantity",
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Lot capture                                                            */
  /* ---------------------------------------------------------------------- */

  let lotId: string | undefined;
  if (item.trackingMode === "LOT") {
    const lotCode = (input.lotCode ?? "").trim();
    if (lotCode.length === 0) {
      // A lot-tracked item with no lot is stock nobody can trace, recall, or
      // rotate by expiry (`ADR-0005`, §5 Q19).
      return refusal({ code: "LOT_REQUIRED", field: "lotCode" });
    }

    const existing = await ctx.tenantDb
      .byIndex<LotDocument>("lots", "by_orgId_itemId_lotCode", [
        { field: "itemId", value: input.itemId },
        { field: "lotCode", value: lotCode },
      ])
      .unique();

    lotId =
      existing?._id ??
      (await ctx.tenantDb.insert("lots", {
        itemId: input.itemId,
        lotCode,
        status: "ACTIVE",
        ...(input.manufactureDate === undefined
          ? {}
          : { manufactureDate: input.manufactureDate }),
        ...(input.expirationDate === undefined
          ? {}
          : { expirationDate: input.expirationDate }),
      }));
  } else if ((input.lotCode ?? "").trim().length > 0) {
    // Capturing a lot against an untracked item would create a lot the ledger
    // then refuses to post against (`INV-0005-02`).
    return refusal({ code: "LOT_NOT_TRACKED", field: "lotCode" });
  }

  /* ---------------------------------------------------------------------- */
  /* QC applicability                                                       */
  /* ---------------------------------------------------------------------- */

  const profiles: QcProfileMatch[] = [];
  const itemProfile = await ctx.tenantDb
    .byIndex<QcProfileDocument>("qcProfiles", "by_orgId_itemId", [
      { field: "itemId", value: input.itemId },
    ])
    .first();
  if (itemProfile !== null) {
    profiles.push({
      scope: "ITEM",
      enabled: itemProfile.enabled,
      strategy: itemProfile.strategy,
      ...(itemProfile.parameter === undefined
        ? {}
        : { parameter: itemProfile.parameter }),
    });
  }

  const order =
    receipt.purchaseOrderId === undefined
      ? null
      : await ctx.tenantDb.get<{
          readonly _id: string;
          readonly orgId: TenantOrgId;
          readonly supplierId: string;
        }>("purchaseOrders", receipt.purchaseOrderId);

  if (order !== null) {
    const supplierProfile = await ctx.tenantDb
      .byIndex<QcProfileDocument>("qcProfiles", "by_orgId_supplierId", [
        { field: "supplierId", value: order.supplierId },
      ])
      .first();
    if (supplierProfile !== null) {
      profiles.push({
        scope: "SUPPLIER",
        enabled: supplierProfile.enabled,
        strategy: supplierProfile.strategy,
        ...(supplierProfile.parameter === undefined
          ? {}
          : { parameter: supplierProfile.parameter }),
      });
    }
  }

  const applicability = resolveQcApplicability(profiles);
  const landedStatus = receiptStockStatus(applicability);

  /* ---------------------------------------------------------------------- */
  /* The ledger posting                                                     */
  /* ---------------------------------------------------------------------- */

  const now = Date.now();
  const orgId = ctx.tenant.organization._id;
  const quantity = { uom: item.baseUom, minorUnits: base.baseMinorUnits };

  const bucket = (
    location:
      | { readonly kind: "PHYSICAL"; readonly locationId: string }
      | { readonly kind: "VIRTUAL"; readonly boundary: "SUPPLIER_RECEIPT" },
  ) => ({
    orgId,
    warehouseId: input.warehouseId,
    itemId: input.itemId,
    location,
    stockStatus: landedStatus,
    ...(lotId === undefined ? {} : { lotId }),
  });

  const draft: LedgerTransactionDraft = {
    orgId,
    warehouseId: input.warehouseId,
    type: "RECEIPT",
    operation: RECEIVING_OPERATIONS.postLine,
    requestId: input.requestId,
    actorUserId: ctx.tenant.actor._id,
    occurredAt: now,
    source: { type: "RECEIPT", id: input.receiptId },
    lines: [
      {
        /*
         * The stock lands in the dock or staging location it was received to,
         * and putaway moves it from there. Receiving straight to a rack would
         * make the putaway task a fiction.
         */
        bucket: {
          ...bucket({ kind: "PHYSICAL", locationId: input.locationId }),
          ...(input.handlingUnitId === undefined
            ? {}
            : { handlingUnitId: input.handlingUnitId }),
        },
        quantity,
      },
      {
        // The counterparty: stock enters the warehouse from outside it, and the
        // boundary line is what makes the transaction balance (`ADR-0003` §2).
        bucket: bucket({ kind: "VIRTUAL", boundary: "SUPPLIER_RECEIPT" }),
        quantity: { uom: item.baseUom, minorUnits: -base.baseMinorUnits },
      },
    ],
  };

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

  /*
   * A replayed posting must not write a second receipt line or advance the
   * running total again. The ledger store already recognised the request ID, so
   * the honest answer is the original line — found by the transaction it
   * produced.
   */
  if (posted.value.replayed) {
    const existingLine = await ctx.tenantDb
      .byIndex<{ readonly _id: string; readonly orgId: TenantOrgId }>(
        "receiptLines",
        "by_orgId_receiptId",
        [{ field: "receiptId", value: input.receiptId }],
      )
      .take(50);
    const match = existingLine.find(
      (line) =>
        (line as unknown as { transactionId?: string }).transactionId ===
        posted.value.result.transactionId,
    );
    return {
      written: true as const,
      documentId: match?._id ?? posted.value.result.transactionId,
      replayed: true,
      transactionId: posted.value.result.transactionId,
      classification: assessment?.value.classification ?? "COMPLETE",
      kind,
      stockStatus: landedStatus,
      baseMinorUnits: base.baseMinorUnits,
      plausibleDuplicate: false,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* The receipt line, the running total, and the inspection                */
  /* ---------------------------------------------------------------------- */

  const receiptLineId = await ctx.tenantDb.insert("receiptLines", {
    receiptId: input.receiptId,
    itemId: input.itemId,
    locationId: input.locationId,
    capturedQuantity: input.quantity,
    baseMinorUnits: base.baseMinorUnits,
    kind,
    classification: assessment?.value.classification ?? "COMPLETE",
    stockStatus: landedStatus,
    transactionId: posted.value.result.transactionId,
    overToleranceApproved: false,
    ...(input.purchaseOrderLineId === undefined
      ? {}
      : { purchaseOrderLineId: input.purchaseOrderLineId }),
    ...(lotId === undefined ? {} : { lotId }),
    ...(input.handlingUnitId === undefined
      ? {}
      : { handlingUnitId: input.handlingUnitId }),
  });

  if (orderLine !== null && assessment !== null) {
    await ctx.tenantDb.patch("purchaseOrderLines", orderLine._id, {
      receivedBaseMinorUnits: assessment.value.totalAfterMinorUnits,
      status: statusAfterReceipt(assessment.value),
    });
  }

  /*
   * The dashboard counters, moved in the transaction that earned the move
   * (`ADR-0011` §6). Counted here rather than derived on read because "how many
   * lines were posted at this site" is otherwise a scan of the one table that
   * grows fastest.
   */
  await adjustRollup({
    tenantDb: ctx.tenantDb,
    warehouseId: input.warehouseId,
    metric: "RECEIPT_LINES_POSTED",
    delta: 1,
    now,
  });

  let inspectionId: string | undefined;
  if (landedStatus === "QC_HOLD") {
    /*
     * The sample plan is computed and stored now, not resolved later. A profile
     * changes; the plan actually applied to this delivery does not, and it is
     * the evidence an auditor reads.
     */
    const matched = applicability.matched;
    const plan = planSample({
      strategy: matched?.strategy ?? "ALL",
      ...(matched?.parameter === undefined
        ? {}
        : { parameter: matched.parameter }),
      // Whole base units, floored: an inspector counts things, not thousandths.
      lotSize: Math.max(1, Math.floor(base.baseMinorUnits / 1_000)),
    });
    if (!plan.ok) return refusal(plan.error);

    inspectionId = await ctx.tenantDb.insert("qcInspections", {
      warehouseId: input.warehouseId,
      receiptLineId,
      itemId: input.itemId,
      status: "OPEN",
      strategy: plan.value.strategy,
      sampleSize: plan.value.sampleSize,
      lotSize: plan.value.lotSize,
    });
    await adjustRollup({
      tenantDb: ctx.tenantDb,
      warehouseId: input.warehouseId,
      metric: "QC_PENDING",
      delta: 1,
      now,
    });
  }

  /*
   * Stock that landed available is ready to be put away, so the task is created
   * here. Held stock deliberately gets none: a putaway task for `QC_HOLD` stock
   * would be a queue entry inviting the bypass `INV-0007-05` forbids, and the
   * task is created by the QC release instead.
   */
  if (landedStatus === "AVAILABLE") {
    await ctx.tenantDb.insert("putawayTasks", {
      warehouseId: input.warehouseId,
      receiptLineId,
      itemId: input.itemId,
      baseMinorUnits: base.baseMinorUnits,
      fromLocationId: input.locationId,
      status: "READY",
      ...(lotId === undefined ? {} : { lotId }),
      ...(input.handlingUnitId === undefined
        ? {}
        : { handlingUnitId: input.handlingUnitId }),
    });
    await adjustRollup({
      tenantDb: ctx.tenantDb,
      warehouseId: input.warehouseId,
      metric: "PUTAWAY_READY",
      delta: 1,
      now,
    });
  }

  if (input.exceptionId !== undefined) {
    // One raised exception authorizes one posting; leaving it open would be a
    // standing bypass of the permission that required a second person.
    await ctx.tenantDb.patch("receivingExceptions", input.exceptionId, {
      status: "CONSUMED",
    });
  }

  return {
    written: true as const,
    documentId: receiptLineId,
    replayed: false,
    transactionId: posted.value.result.transactionId,
    classification: assessment?.value.classification ?? "COMPLETE",
    kind,
    stockStatus: landedStatus,
    baseMinorUnits: base.baseMinorUnits,
    plausibleDuplicate: false,
    ...(inspectionId === undefined ? {} : { inspectionId }),
  };
}

const lineArgs = {
  requestId: v.string(),
  warehouseId: v.id("warehouses"),
  receiptId: v.id("receipts"),
  locationId: v.id("locations"),
  itemId: v.id("items"),
  quantity: signedQuantity,
  lotCode: v.optional(v.string()),
  manufactureDate: v.optional(v.string()),
  expirationDate: v.optional(v.string()),
  handlingUnitId: v.optional(v.id("handlingUnits")),
};

/**
 * Receive stock against an open order line.
 *
 * The ordinary path, and the only one that does not need a second person. It
 * refuses anything that is not ordinary — a cancelled line, an item the line did
 * not order, an over-receipt past tolerance — and names which, so the operator
 * knows which exception path to take rather than being told "no".
 */
export const postReceiptLine = mutationWithOrg({
  args: {
    ...lineArgs,
    purchaseOrderLineId: v.id("purchaseOrderLines"),
  },
  returns: postOutcomeValidator,
  permissionCode: "receiving.receipt.post",
  target: { table: "receipts", id: ({ receiptId }) => receiptId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => await postLine(ctx, args),
});

/**
 * The maker-checker facts for posting against a raised exception.
 *
 * The maker is whoever raised the exception, read from the tenant's own row. The
 * evaluator denies when the maker and the actor are the same person, so raising
 * your own exception and receiving against it is refused — which is the whole
 * point of putting an exception behind maker-checker.
 */
async function exceptionPolicy(
  ctx: TenantPolicyContext,
  args: { readonly exceptionId: string },
): Promise<{
  readonly thresholdExceeded: boolean;
  readonly approvalSatisfied: boolean;
  readonly makerUserId?: string;
}> {
  const raised = await ctx.tenantDb.get<ExceptionDocument>(
    "receivingExceptions",
    args.exceptionId,
  );
  if (raised === null || raised.status !== "RAISED") {
    return Object.freeze({
      thresholdExceeded: false,
      approvalSatisfied: false,
    });
  }
  return Object.freeze({
    thresholdExceeded: false,
    approvalSatisfied: true,
    makerUserId: raised.raisedByUserId,
  });
}

/**
 * Raise a receiving exception, so somebody else can post against it.
 *
 * This is what makes `INV-0007-04`'s maker-checker permissions reachable at all.
 * The evaluator denies fail-closed when there is no maker; the raised row is the
 * maker.
 */
export const raiseReceivingException = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    kind: receiptLineKind,
    itemId: v.optional(v.id("items")),
    purchaseOrderId: v.optional(v.id("purchaseOrders")),
    reasonCodeId: v.id("reasonCodes"),
    note: v.optional(v.string()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "receiving.exception.manage",
  target: { table: "receivingExceptions" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    if (args.kind === "ORDERED") {
      // An ordinary receipt is not an exception, and raising one would create a
      // maker for a posting that needs no second person.
      return refusal({ code: "FIELD_INVALID", field: "kind" });
    }
    const reason = await ctx.tenantDb.get("reasonCodes", args.reasonCodeId);
    if (reason === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "reasonCodeId" });
    }
    if (args.itemId !== undefined) {
      const item = await ctx.tenantDb.get("items", args.itemId);
      if (item === null) {
        return refusal({ code: "REFERENCE_NOT_FOUND", field: "itemId" });
      }
    }

    const document = {
      warehouseId: args.warehouseId,
      kind: args.kind,
      reasonCodeId: args.reasonCodeId,
      raisedByUserId: ctx.tenant.actor._id,
      status: "RAISED",
      ...(args.itemId === undefined ? {} : { itemId: args.itemId }),
      ...(args.purchaseOrderId === undefined
        ? {}
        : { purchaseOrderId: args.purchaseOrderId }),
      ...(args.note === undefined ? {} : { note: args.note.trim() }),
    };

    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "receivingExceptions",
        operation: RECEIVING_OPERATIONS.raiseException,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint: document,
      uniqueness: [],
      document,
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/**
 * Receive stock that the order did not lead anybody to expect.
 *
 * Covers unexpected items, cancelled lines, and blind receipts — the kind comes
 * from the *raised exception*, not from the caller, so a handheld cannot pick
 * the cheaper one. `receiving.receipt.unexpected` carries maker-checker, and the
 * maker is the actor who raised the exception.
 */
export const postExceptionReceiptLine = mutationWithOrg({
  args: {
    ...lineArgs,
    exceptionId: v.id("receivingExceptions"),
    purchaseOrderLineId: v.optional(v.id("purchaseOrderLines")),
  },
  returns: postOutcomeValidator,
  permissionCode: "receiving.receipt.unexpected",
  target: {
    table: "receivingExceptions",
    id: ({ exceptionId }) => exceptionId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  policy: exceptionPolicy,
  handler: async (ctx, args) => {
    const raised = await ctx.tenantDb.get<ExceptionDocument>(
      "receivingExceptions",
      args.exceptionId,
    );
    if (raised === null) {
      return refusal({ code: "NOT_FOUND", table: "receivingExceptions" });
    }
    if (raised.status !== "RAISED") {
      return refusal({ code: "EXCEPTION_NOT_OPEN", status: raised.status });
    }
    if (raised.warehouseId !== args.warehouseId) {
      // The exception was raised for a different site; a posting that ignored
      // that would move the approval across warehouses (`INV-0006-04`).
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "exceptionId" });
    }

    return await postLine(ctx, {
      ...args,
      overrideKind: raised.kind as "UNEXPECTED" | "CANCELLED_LINE" | "BLIND",
      exceptionId: args.exceptionId,
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Handling units                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Build a pallet from received lines (`ADR-0007` §9).
 *
 * The handling unit is created and the named receipt lines are attached to it.
 * What is deliberately *not* done here is a ledger posting: the stock is already
 * where it is, in the bucket it was received into, and a pallet is a way of
 * referring to it rather than a movement of it. Posting a movement to "build" a
 * pallet would double the transaction count for no change in balance.
 *
 * Mixed content is permitted and recorded. `handlingUnit.mixedContent` carries a
 * threshold in the catalogue and no policy table exists yet (`RG-030` open), so
 * this entry point declares `handlingUnit.build` and the mixed-content limit is
 * a documented gap rather than a silent allowance.
 */
export const buildHandlingUnit = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    lpn: v.string(),
    locationId: v.id("locations"),
    receiptLineIds: v.array(v.id("receiptLines")),
  },
  returns: writeOutcomeValidator,
  permissionCode: "handlingUnit.build",
  target: { table: "handlingUnits" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const lpn = normalizeField("lpn", args.lpn, CODE_FIELD);
    if (!lpn.ok) return refusal(lpn.error);

    if (args.receiptLineIds.length === 0) {
      return refusal({ code: "FIELD_INVALID", field: "receiptLineIds" });
    }
    // A pallet is a bounded physical thing; an unbounded list here would be an
    // unbounded write inside one transaction.
    if (args.receiptLineIds.length > 50) {
      return refusal({ code: "TOO_MANY_LINES", field: "receiptLineIds" });
    }

    const location = await ctx.tenantDb.get<{
      readonly _id: string;
      readonly orgId: TenantOrgId;
      readonly warehouseId: string;
    }>("locations", args.locationId);
    if (location === null || location.warehouseId !== args.warehouseId) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "locationId" });
    }

    for (const receiptLineId of args.receiptLineIds) {
      const line = await ctx.tenantDb.get("receiptLines", receiptLineId);
      if (line === null) {
        return refusal({
          code: "REFERENCE_NOT_FOUND",
          field: "receiptLineIds",
        });
      }
    }

    const document = {
      warehouseId: args.warehouseId,
      lpn: lpn.value,
      currentLocationId: args.locationId,
      status: "ACTIVE",
    };

    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "handlingUnits",
        operation: RECEIVING_OPERATIONS.buildHandlingUnit,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint: { ...document, receiptLineIds: args.receiptLineIds },
      uniqueness: [
        {
          field: "lpn",
          index: "by_orgId_lpn",
          equality: [{ field: "lpn", value: lpn.value }],
        },
      ],
      document,
    });
    if (!outcome.ok) return refusal(outcome.error);

    if (!outcome.value.replayed) {
      for (const receiptLineId of args.receiptLineIds) {
        await ctx.tenantDb.patch("receiptLines", receiptLineId, {
          handlingUnitId: outcome.value.documentId,
        });
      }
    }
    return written(outcome.value);
  },
});

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `poNumber` is the order number an operator reads; `purchaseOrderId` is the
 * document the screens navigate by.
 *
 * Both are here because they answer different questions. The receiving register
 * used to show the identifier, so the same order appeared as `PO-2601` on the
 * purchasing screen and as an opaque document ID one screen later — two names
 * for one thing, only one of which is on the supplier's paperwork.
 *
 * It is optional twice over: a blind receipt has no order at all, and an order
 * that cannot be read leaves the number absent rather than failing the page.
 * Reading it costs no permission an order-less caller does not already exercise
 * — the identifier was already on the wire, and a number is less than an ID.
 */
const receiptValidator = v.object({
  receiptId: v.id("receipts"),
  warehouseId: v.id("warehouses"),
  receiptNumber: v.string(),
  purchaseOrderId: v.optional(v.id("purchaseOrders")),
  poNumber: v.optional(v.string()),
  occurredAt: v.number(),
  businessDate: v.string(),
});

const receiptLineValidator = v.object({
  receiptLineId: v.id("receiptLines"),
  receiptId: v.id("receipts"),
  itemId: v.id("items"),
  lotId: v.optional(v.id("lots")),
  handlingUnitId: v.optional(v.id("handlingUnits")),
  capturedQuantity: signedQuantity,
  baseMinorUnits: v.number(),
  kind: receiptLineKind,
  classification: receiptClassification,
  stockStatus,
  transactionId: v.id("inventoryTransactions"),
});

/** Receipts at one site, most recent first by index order. */
export const listReceipts = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    ...listArgs,
  },
  returns: pageOf(receiptValidator),
  permissionCode: "receiving.receipt.read",
  target: { table: "receipts" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);

    const page = await ctx.tenantDb
      .byIndex<ReceiptDocument & { readonly occurredAt: number }>(
        "receipts",
        "by_orgId_warehouseId_occurredAt",
        [{ field: "warehouseId", value: args.warehouseId }],
      )
      .page(pageOptions(request.value));

    /*
     * The order number behind each receipt, read once per distinct order.
     *
     * A day's receipts at one dock name few orders between them, and the page is
     * capped, so this is a small bounded number of reads. An order that cannot
     * be read is recorded as "no number" rather than re-read for every receipt
     * that names it.
     */
    const poNumberByOrderId = new Map<string, string | undefined>();
    for (const receipt of page.page) {
      const orderId = receipt.purchaseOrderId;
      if (orderId === undefined || poNumberByOrderId.has(orderId)) continue;
      const order = await ctx.tenantDb.get<OrderDocument>(
        "purchaseOrders",
        orderId,
      );
      poNumberByOrderId.set(orderId, order?.poNumber);
    }

    return {
      ok: true as const,
      items: page.page.map((receipt) => {
        const poNumber =
          receipt.purchaseOrderId === undefined
            ? undefined
            : poNumberByOrderId.get(receipt.purchaseOrderId);
        return {
          receiptId: receipt._id as never,
          warehouseId: receipt.warehouseId as never,
          receiptNumber: receipt.receiptNumber,
          occurredAt: receipt.occurredAt,
          businessDate: receipt.businessDate,
          ...(receipt.purchaseOrderId === undefined
            ? {}
            : { purchaseOrderId: receipt.purchaseOrderId as never }),
          ...(poNumber === undefined ? {} : { poNumber }),
        };
      }),
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});

const receiptDetailValidator = v.union(
  v.object({ found: v.literal(true), receipt: receiptValidator }),
  v.object({ found: v.literal(false) }),
);

/**
 * One receipt, by identifier.
 *
 * The receipt screen needs the order behind the receipt before it can offer the
 * lines that may be received against it, and paging the whole register to find
 * one row would be a read whose cost grows with the site's history.
 *
 * A missing receipt and another tenant's answer identically — `{found:false}` —
 * because `tenantDb.get` refuses a foreign document the same way it refuses a
 * nonexistent one (`INV-0002-03`).
 */
export const getReceipt = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    receiptId: v.id("receipts"),
  },
  returns: receiptDetailValidator,
  permissionCode: "receiving.receipt.read",
  target: { table: "receipts", id: ({ receiptId }) => receiptId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const receipt = await ctx.tenantDb.get<
      ReceiptDocument & {
        readonly occurredAt: number;
      }
    >("receipts", args.receiptId);
    if (receipt === null) return { found: false as const };

    const order =
      receipt.purchaseOrderId === undefined
        ? null
        : await ctx.tenantDb.get<OrderDocument>(
            "purchaseOrders",
            receipt.purchaseOrderId,
          );

    return {
      found: true as const,
      receipt: {
        receiptId: receipt._id as never,
        warehouseId: receipt.warehouseId as never,
        receiptNumber: receipt.receiptNumber,
        occurredAt: receipt.occurredAt,
        businessDate: receipt.businessDate,
        ...(receipt.purchaseOrderId === undefined
          ? {}
          : { purchaseOrderId: receipt.purchaseOrderId as never }),
        ...(order === null ? {} : { poNumber: order.poNumber }),
      },
    };
  },
});

/** The lines of one receipt. */
export const listReceiptLines = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    receiptId: v.id("receipts"),
    ...listArgs,
  },
  returns: pageOf(receiptLineValidator),
  permissionCode: "receiving.receipt.read",
  target: { table: "receipts", id: ({ receiptId }) => receiptId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);

    const receipt = await ctx.tenantDb.get("receipts", args.receiptId);
    if (receipt === null) {
      return pageRefusal("REFERENCE_NOT_FOUND");
    }

    const page = await ctx.tenantDb
      .byIndex<
        {
          readonly _id: string;
          readonly orgId: TenantOrgId;
        } & Record<string, never>
      >("receiptLines", "by_orgId_receiptId", [
        { field: "receiptId", value: args.receiptId },
      ])
      .page(pageOptions(request.value));

    return {
      ok: true as const,
      items: page.page.map((line) => {
        const row = line as unknown as Record<string, unknown>;
        return {
          receiptLineId: line._id as never,
          receiptId: row["receiptId"] as never,
          itemId: row["itemId"] as never,
          capturedQuantity: row["capturedQuantity"] as never,
          baseMinorUnits: row["baseMinorUnits"] as number,
          kind: row["kind"] as never,
          classification: row["classification"] as never,
          stockStatus: row["stockStatus"] as never,
          transactionId: row["transactionId"] as never,
          ...(row["lotId"] === undefined
            ? {}
            : { lotId: row["lotId"] as never }),
          ...(row["handlingUnitId"] === undefined
            ? {}
            : { handlingUnitId: row["handlingUnitId"] as never }),
        };
      }),
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});

/** The page cap, re-exported so a client can size its own loop. */
export const maxReceivingPageSize = MAX_JOB_PAGE_SIZE;
