/**
 * The master-data write surface.
 *
 * Six mutations over the reference entities the inbound flows need first: items,
 * locations, and lots. Everything else in the catalogue is read-only until a
 * flow needs to write it — a mutation with no caller is an unproved code path
 * with a permission attached.
 *
 * Every one is registered through `mutationWithOrg`, declares a **manage**
 * permission distinct from the entity's read code, and delegates the invariant
 * work to `convex/lib/masterDataStore.ts`: normalize, fingerprint, check
 * idempotency, check uniqueness, write, audit, index. This file owns the
 * argument shapes, the permission declarations, the wire envelope, and the
 * per-entity uniqueness contracts — nothing else.
 *
 * ### Why `requestId` is an argument and `occurredAt` is not
 *
 * The request ID is minted by the client *at intent time*, before the network
 * call, so a retry after a stall is the same request (`INV-0009-01`). The clock
 * is the server's, always: a client-supplied instant would let a handheld
 * backdate an edit into a closed period, and the audit row's `occurredAt` is
 * evidence.
 *
 * ### What no mutation here does
 *
 * **Delete.** Master data is deactivated, never removed: a ledger line, a lot,
 * and an audit row all reference an item by ID (`INV-0003-04`), and deleting the
 * item turns every one of them into a dangling pointer. `deactivateItem` sets
 * `status` and nothing else, and it carries its own maker-checker permission
 * because withdrawing a SKU from receiving is a decision with a second pair of
 * eyes on it.
 *
 * **Change an item's base UOM.** `ADR-0004` stores every quantity in integer
 * minor units *of the item's base UOM*; changing it would silently reinterpret
 * every balance and every ledger line already posted. It is absent from the
 * update arguments, not validated against — there is no field to send.
 */
import { v } from "convex/values";

import {
  CODE_FIELD,
  LOT_CODE_FIELD,
  createMasterDataRow,
  normalizeDisplayName,
  normalizeField,
  updateMasterDataRow,
  type MasterDataError,
  type UniquenessCheck,
} from "../lib/masterDataStore";
import type { TenantOrgId } from "../lib/tenantDb";
import { parseBusinessDate } from "../model/time/businessDate";
import {
  fail as failResult,
  ok as okResult,
  type Result,
} from "../model/result";
import { mutationWithOrg } from "../lib/tenantFunctions";
import {
  refusal,
  writeContextOf as contextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import {
  barcodeKind,
  itemTrackingMode,
  labelTemplateFormat,
  locationType,
  masterDataStatus,
} from "../lib/validators";
import {
  nextTemplateVersion,
  validateAlternateConversion,
  validateBarcodeAlias,
  validateLabelBody,
} from "../model/masterData/catalogueRules";

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The logical operation names, which are half of every idempotency key.
 *
 * Code-owned and stable: renaming one makes every in-flight retry look like a
 * fresh request. They are deliberately *not* the permission codes — one
 * permission may guard several operations, and the idempotency namespace has to
 * separate them.
 */
export const MASTER_DATA_OPERATIONS = Object.freeze({
  createItem: "masterData.item.create",
  updateItem: "masterData.item.update",
  deactivateItem: "masterData.item.deactivate",
  createLocation: "masterData.location.create",
  updateLocation: "masterData.location.update",
  createLot: "masterData.lot.create",
  createSupplier: "masterData.supplier.create",
  updateSupplier: "masterData.supplier.update",
  createStorageClass: "masterData.storageClass.create",
  updateStorageClass: "masterData.storageClass.update",
  createBarcode: "masterData.barcode.create",
  deactivateBarcode: "masterData.barcode.deactivate",
  createItemUom: "masterData.itemUom.create",
  deactivateItemUom: "masterData.itemUom.deactivate",
  draftLabelTemplate: "masterData.labelTemplate.draft",
  publishLabelTemplate: "masterData.labelTemplate.publish",
});

/* -------------------------------------------------------------------------- */
/* Items                                                                       */
/* -------------------------------------------------------------------------- */

interface ItemDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly sku: string;
  readonly baseUom: string;
  readonly trackingMode: string;
  readonly status: string;
}

/** The one uniqueness contract on `items`: `(orgId, sku)`. */
const itemUniqueness = (sku: string): readonly UniquenessCheck[] => [
  {
    field: "sku",
    index: "by_orgId_sku",
    equality: [{ field: "sku", value: sku }],
  },
];

/**
 * Create an item.
 *
 * `baseUom` is normalized as a code and stored as given thereafter: it is the
 * unit every quantity of this item is expressed in (`ADR-0004`, D-08), and the
 * ledger refuses a posting whose quantity UOM is not it.
 *
 * `LOT_SERIAL` is accepted here and its *flows* stay off (D-09, `INV-0005-08`):
 * the schema is serial-ready, the ledger refuses a serial outright, and the item
 * screen marks the mode as unavailable. Refusing the mode at creation would make
 * the schema's readiness untestable.
 */
export const createItem = mutationWithOrg({
  args: {
    requestId: v.string(),
    sku: v.string(),
    name: v.string(),
    baseUom: v.string(),
    trackingMode: itemTrackingMode,
  },
  returns: writeOutcomeValidator,
  permissionCode: "masterData.item.manage",
  target: { table: "items" },
  handler: async (ctx, args) => {
    const sku = normalizeField("sku", args.sku, CODE_FIELD);
    if (!sku.ok) return refusal(sku.error);
    const name = normalizeDisplayName("name", args.name);
    if (!name.ok) return refusal(name.error);
    const baseUom = normalizeField("baseUom", args.baseUom, CODE_FIELD);
    if (!baseUom.ok) return refusal(baseUom.error);

    const outcome = await createMasterDataRow({
      ...contextOf(ctx, {
        table: "items",
        operation: MASTER_DATA_OPERATIONS.createItem,
        requestId: args.requestId,
      }),
      fingerprint: {
        operation: MASTER_DATA_OPERATIONS.createItem,
        requestId: args.requestId,
        sku: sku.value,
        name: name.value,
        baseUom: baseUom.value,
        trackingMode: args.trackingMode,
      },
      uniqueness: itemUniqueness(sku.value),
      document: {
        sku: sku.value,
        name: name.value,
        baseUom: baseUom.value,
        trackingMode: args.trackingMode,
        status: "ACTIVE",
      },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/**
 * Rename an item, or change its tracking mode.
 *
 * The SKU is **not** updatable and neither is the base UOM. A SKU is the key the
 * ledger, the scan resolver, and every supplier document resolve against;
 * changing it in place would rewrite the meaning of history rather than record a
 * change. A tenant that needs a different SKU deactivates this item and creates
 * another, which leaves both visible.
 */
export const updateItem = mutationWithOrg({
  args: {
    requestId: v.string(),
    itemId: v.id("items"),
    name: v.optional(v.string()),
    trackingMode: v.optional(itemTrackingMode),
  },
  returns: writeOutcomeValidator,
  permissionCode: "masterData.item.manage",
  target: { table: "items", id: ({ itemId }) => itemId },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};

    if (args.name !== undefined) {
      const name = normalizeDisplayName("name", args.name);
      if (!name.ok) return refusal(name.error);
      patch["name"] = name.value;
    }
    if (args.trackingMode !== undefined) {
      patch["trackingMode"] = args.trackingMode;
    }

    const outcome = await updateMasterDataRow({
      ...contextOf(ctx, {
        table: "items",
        operation: MASTER_DATA_OPERATIONS.updateItem,
        requestId: args.requestId,
      }),
      documentId: args.itemId,
      fingerprint: {
        operation: MASTER_DATA_OPERATIONS.updateItem,
        requestId: args.requestId,
        itemId: args.itemId,
        ...patch,
      },
      // The SKU cannot change here, so no uniqueness key can be violated.
      uniqueness: [],
      patch,
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/**
 * Withdraw an item from use.
 *
 * A separate mutation with a separate permission — `masterData.item.deactivate`
 * carries maker-checker (catalogue §2) — because deactivating a SKU stops every
 * future receipt of it, and the catalogue treats that as a decision needing a
 * second pair of eyes rather than an ordinary edit.
 *
 * It sets `status` and nothing else. Existing stock, lots, and ledger history are
 * untouched: an inactive item is one that may not be *received*, not one that
 * never existed.
 */
export const deactivateItem = mutationWithOrg({
  args: { requestId: v.string(), itemId: v.id("items") },
  returns: writeOutcomeValidator,
  permissionCode: "masterData.item.deactivate",
  target: { table: "items", id: ({ itemId }) => itemId },
  policy: async (ctx, args: { readonly itemId: string }) => {
    /*
     * Maker-checker on a deactivation: the maker is whoever last wrote this
     * item, read from the tenant's own audit trail rather than from the request.
     * Absent a prior write — an item seeded at provisioning — there is no maker,
     * so `approvalSatisfied` is true and the evaluator allows a single actor to
     * proceed. That is the honest reading: separation of duties separates two
     * *people*, and there is no first person to separate from.
     *
     * `thresholdExceeded: false` because no threshold policy table exists
     * (`RG-030`); "nothing exceeds an unconfigured threshold" is the only honest
     * reading of an absent policy, and it is stated here rather than hidden.
     */
    const priorWrite = await ctx.tenantDb
      .byIndex<{
        readonly orgId: TenantOrgId;
        readonly actorUserId?: string;
        readonly entityId?: string;
      }>("auditEvents", "by_orgId_entityTable_entityId_occurredAt", [
        { field: "entityTable", value: "items" },
        { field: "entityId", value: args.itemId },
      ])
      .first();

    const maker = priorWrite?.actorUserId;
    return Object.freeze({
      thresholdExceeded: false,
      approvalSatisfied: true,
      ...(maker === undefined ? {} : { makerUserId: maker }),
    });
  },
  handler: async (ctx, args) => {
    const outcome = await updateMasterDataRow({
      ...contextOf(ctx, {
        table: "items",
        operation: MASTER_DATA_OPERATIONS.deactivateItem,
        requestId: args.requestId,
      }),
      documentId: args.itemId,
      fingerprint: {
        operation: MASTER_DATA_OPERATIONS.deactivateItem,
        requestId: args.requestId,
        itemId: args.itemId,
      },
      uniqueness: [],
      patch: { status: "INACTIVE" },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/* -------------------------------------------------------------------------- */
/* Locations                                                                   */
/* -------------------------------------------------------------------------- */

/** `(orgId, warehouseId, code)`: a location code is unique within its site. */
const locationUniqueness = (
  warehouseId: string,
  code: string,
): readonly UniquenessCheck[] => [
  {
    field: "code",
    index: "by_orgId_warehouseId_code",
    equality: [
      { field: "warehouseId", value: warehouseId },
      { field: "code", value: code },
    ],
  },
];

/**
 * Create a location inside one warehouse.
 *
 * Warehouse-scoped, so the wrapper revalidates the warehouse against the actor's
 * membership before the handler runs (`INV-0006-04`) — a location cannot be
 * created in a site the actor may not act in, and the refusal for a foreign
 * warehouse is the same one a nonexistent warehouse produces.
 *
 * `warehouseId` never changes afterwards (`INV-0005-01`), which is why there is
 * no update mutation that accepts one: a ledger posting proves a location
 * belongs to the header's warehouse through this field, and moving it would
 * retroactively invalidate postings that were correct when made.
 */
export const createLocation = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    code: v.string(),
    locationType,
  },
  returns: writeOutcomeValidator,
  permissionCode: "masterData.location.manage",
  target: { table: "locations" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const code = normalizeField("code", args.code, CODE_FIELD);
    if (!code.ok) return refusal(code.error);

    const outcome = await createMasterDataRow({
      ...contextOf(ctx, {
        table: "locations",
        operation: MASTER_DATA_OPERATIONS.createLocation,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint: {
        operation: MASTER_DATA_OPERATIONS.createLocation,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
        code: code.value,
        locationType: args.locationType,
      },
      uniqueness: locationUniqueness(args.warehouseId, code.value),
      document: {
        warehouseId: args.warehouseId,
        code: code.value,
        locationType: args.locationType,
        status: "ACTIVE",
      },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/**
 * Change a location's type or status.
 *
 * Not its code and not its warehouse. Re-parenting a location is
 * `masterData.location.reparent`, a distinct permission carrying step-up and
 * maker-checker, and there is no hierarchy to re-parent within yet.
 */
export const updateLocation = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    locationId: v.id("locations"),
    locationType: v.optional(locationType),
    status: v.optional(masterDataStatus),
  },
  returns: writeOutcomeValidator,
  permissionCode: "masterData.location.manage",
  target: { table: "locations", id: ({ locationId }) => locationId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.locationType !== undefined) {
      patch["locationType"] = args.locationType;
    }
    if (args.status !== undefined) patch["status"] = args.status;

    const outcome = await updateMasterDataRow({
      ...contextOf(ctx, {
        table: "locations",
        operation: MASTER_DATA_OPERATIONS.updateLocation,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: args.locationId,
      fingerprint: {
        operation: MASTER_DATA_OPERATIONS.updateLocation,
        requestId: args.requestId,
        locationId: args.locationId,
        ...patch,
      },
      uniqueness: [],
      patch,
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/* -------------------------------------------------------------------------- */
/* Lots                                                                        */
/* -------------------------------------------------------------------------- */

/** `(orgId, itemId, lotCode)`: a lot code is unique within its item. */
const lotUniqueness = (
  itemId: string,
  lotCode: string,
): readonly UniquenessCheck[] => [
  {
    field: "lotCode",
    index: "by_orgId_itemId_lotCode",
    equality: [
      { field: "itemId", value: itemId },
      { field: "lotCode", value: lotCode },
    ],
  },
];

/**
 * Create a lot of one item.
 *
 * The item is read through the tenant-bound accessor first, so another tenant's
 * item ID answers `REFERENCE_NOT_FOUND` — the same answer an ID that never
 * existed produces (`INV-0002-03`) — rather than creating an orphan lot.
 *
 * A lot may only be created for an item that is lot-tracked. An item declared
 * `NONE` has no lots by definition (D-09), and a lot pointing at one would be a
 * row the ledger refuses on every posting, discovered at the dock rather than
 * here.
 *
 * The three dates are `YYYY-MM-DD` business dates in the organization's timezone
 * (D-05, `G-105`), never instants. They are validated by the business-date kernel
 * at the point they are *used* — by rotation and expiry — and stored as given
 * here; storing an unparseable date is refused by `parseBusinessDate` below so a
 * malformed value cannot reach FEFO.
 */
export const createLot = mutationWithOrg({
  args: {
    requestId: v.string(),
    itemId: v.id("items"),
    lotCode: v.string(),
    manufactureDate: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    bestBeforeDate: v.optional(v.string()),
  },
  returns: writeOutcomeValidator,
  /*
   * `masterData.lot.create`, not `.manage`. The catalogue documents `.manage` as
   * *correcting* a lot's dates and codes, and gives it maker-checker for a good
   * reason: changing an expiration date changes what FEFO picks and what the
   * expiry job reclassifies, so it wants a second pair of eyes.
   *
   * Creating a lot is not that. It happens at the dock, once per batch, by the
   * operator holding the goods. Reusing `.manage` here would have made lot
   * creation impossible — the evaluator denies maker-checker whenever the maker
   * and the actor are the same person, and at creation there is no other person.
   * A read code standing in for a write, or a correction code standing in for a
   * creation, are the same mistake in opposite directions.
   */
  permissionCode: "masterData.lot.create",
  target: { table: "lots" },
  handler: async (ctx, args) => {
    const lotCode = normalizeField("lotCode", args.lotCode, LOT_CODE_FIELD);
    if (!lotCode.ok) return refusal(lotCode.error);

    const item = await ctx.tenantDb.get<ItemDocument>("items", args.itemId);
    if (item === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "itemId" });
    }
    if (item.trackingMode === "NONE") {
      return refusal({
        code: "FIELD_INVALID",
        field: "itemId",
        reason: "ITEM_NOT_LOT_TRACKED",
      });
    }

    const dates = validateLotDates(args);
    if (!dates.ok) return refusal(dates.error);

    const outcome = await createMasterDataRow({
      ...contextOf(ctx, {
        table: "lots",
        operation: MASTER_DATA_OPERATIONS.createLot,
        requestId: args.requestId,
      }),
      fingerprint: {
        operation: MASTER_DATA_OPERATIONS.createLot,
        requestId: args.requestId,
        itemId: args.itemId,
        lotCode: lotCode.value,
        ...dates.value,
      },
      uniqueness: lotUniqueness(args.itemId, lotCode.value),
      document: {
        itemId: args.itemId,
        lotCode: lotCode.value,
        ...dates.value,
        status: "ACTIVE",
      },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/**
 * Validate the three optional business dates.
 *
 * Through `parseBusinessDate`, the same strict kernel the ledger uses: `2026-8-3`
 * and `2026-08-03T00:00:00Z` are both refused, because a lenient date parser is
 * how a shelf life silently shifts by a day.
 */
function validateLotDates(args: {
  readonly manufactureDate?: string;
  readonly expirationDate?: string;
  readonly bestBeforeDate?: string;
}): Result<Record<string, string>, MasterDataError> {
  const fields = [
    ["manufactureDate", args.manufactureDate],
    ["expirationDate", args.expirationDate],
    ["bestBeforeDate", args.bestBeforeDate],
  ] as const;

  const stored: Record<string, string> = {};
  for (const [field, raw] of fields) {
    if (raw === undefined) continue;
    const parsed = parseBusinessDate(raw);
    if (!parsed.ok) {
      return failResult({
        code: "FIELD_INVALID",
        field,
        reason: parsed.error.code,
      });
    }
    stored[field] = raw;
  }
  return okResult(stored);
}

/* -------------------------------------------------------------------------- */
/* Suppliers                                                                   */
/* -------------------------------------------------------------------------- */

/** `(orgId, code)`: a supplier code is unique per organization. */
const codeUniqueness = (code: string): readonly UniquenessCheck[] => [
  {
    field: "code",
    index: "by_orgId_code",
    equality: [{ field: "code", value: code }],
  },
];

/** Create a supplier. */
export const createSupplier = mutationWithOrg({
  args: { requestId: v.string(), code: v.string(), name: v.string() },
  returns: writeOutcomeValidator,
  permissionCode: "masterData.supplier.manage",
  target: { table: "suppliers" },
  handler: async (ctx, args) => {
    const code = normalizeField("code", args.code, CODE_FIELD);
    if (!code.ok) return refusal(code.error);
    const name = normalizeDisplayName("name", args.name);
    if (!name.ok) return refusal(name.error);

    const outcome = await createMasterDataRow({
      ...contextOf(ctx, {
        table: "suppliers",
        operation: MASTER_DATA_OPERATIONS.createSupplier,
        requestId: args.requestId,
      }),
      fingerprint: {
        operation: MASTER_DATA_OPERATIONS.createSupplier,
        requestId: args.requestId,
        code: code.value,
        name: name.value,
      },
      uniqueness: codeUniqueness(code.value),
      document: { code: code.value, name: name.value, status: "ACTIVE" },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/**
 * Rename a supplier, or withdraw it.
 *
 * The code is not updatable, for the same reason a SKU is not: it is the key a
 * lot's provenance and a supplier barcode will resolve against, and changing it
 * in place rewrites the meaning of anything that already cites it.
 */
export const updateSupplier = mutationWithOrg({
  args: {
    requestId: v.string(),
    supplierId: v.id("suppliers"),
    name: v.optional(v.string()),
    status: v.optional(masterDataStatus),
  },
  returns: writeOutcomeValidator,
  permissionCode: "masterData.supplier.manage",
  target: { table: "suppliers", id: ({ supplierId }) => supplierId },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const name = normalizeDisplayName("name", args.name);
      if (!name.ok) return refusal(name.error);
      patch["name"] = name.value;
    }
    if (args.status !== undefined) patch["status"] = args.status;

    const outcome = await updateMasterDataRow({
      ...contextOf(ctx, {
        table: "suppliers",
        operation: MASTER_DATA_OPERATIONS.updateSupplier,
        requestId: args.requestId,
      }),
      documentId: args.supplierId,
      fingerprint: {
        operation: MASTER_DATA_OPERATIONS.updateSupplier,
        requestId: args.requestId,
        supplierId: args.supplierId,
        ...patch,
      },
      uniqueness: [],
      patch,
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/* -------------------------------------------------------------------------- */
/* Storage classes                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Create a storage class.
 *
 * Organization-scoped with its own permission. A class means the same thing at
 * every site (D-13), so defining one per warehouse would let two sites disagree
 * about what it permits — the disagreement a putaway compatibility rule cannot
 * survive.
 */
export const createStorageClass = mutationWithOrg({
  args: { requestId: v.string(), code: v.string(), name: v.string() },
  returns: writeOutcomeValidator,
  permissionCode: "masterData.storageClass.manage",
  target: { table: "storageClasses" },
  handler: async (ctx, args) => {
    const code = normalizeField("code", args.code, CODE_FIELD);
    if (!code.ok) return refusal(code.error);
    const name = normalizeDisplayName("name", args.name);
    if (!name.ok) return refusal(name.error);

    const outcome = await createMasterDataRow({
      ...contextOf(ctx, {
        table: "storageClasses",
        operation: MASTER_DATA_OPERATIONS.createStorageClass,
        requestId: args.requestId,
      }),
      fingerprint: {
        operation: MASTER_DATA_OPERATIONS.createStorageClass,
        requestId: args.requestId,
        code: code.value,
        name: name.value,
      },
      uniqueness: codeUniqueness(code.value),
      document: { code: code.value, name: name.value, status: "ACTIVE" },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/** Rename a storage class, or withdraw it from use. */
export const updateStorageClass = mutationWithOrg({
  args: {
    requestId: v.string(),
    storageClassId: v.id("storageClasses"),
    name: v.optional(v.string()),
    status: v.optional(masterDataStatus),
  },
  returns: writeOutcomeValidator,
  permissionCode: "masterData.storageClass.manage",
  target: {
    table: "storageClasses",
    id: ({ storageClassId }) => storageClassId,
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const name = normalizeDisplayName("name", args.name);
      if (!name.ok) return refusal(name.error);
      patch["name"] = name.value;
    }
    if (args.status !== undefined) patch["status"] = args.status;

    const outcome = await updateMasterDataRow({
      ...contextOf(ctx, {
        table: "storageClasses",
        operation: MASTER_DATA_OPERATIONS.updateStorageClass,
        requestId: args.requestId,
      }),
      documentId: args.storageClassId,
      fingerprint: {
        operation: MASTER_DATA_OPERATIONS.updateStorageClass,
        requestId: args.requestId,
        storageClassId: args.storageClassId,
        ...patch,
      },
      uniqueness: [],
      patch,
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/* -------------------------------------------------------------------------- */
/* Item barcodes                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Register a scannable alias for an item.
 *
 * Uniqueness is on `(orgId, barcode)` — **not** on `(orgId, itemId, barcode)`.
 * A scanned string must resolve to at most one item, or the receiving screen has
 * to ask an operator which SKU they meant while they are holding the carton.
 *
 * The value is normalized and checked against the kind it claims through
 * `validateBarcodeAlias`, which delegates a `GTIN`'s check digit to the same
 * kernel the scan resolver uses. A row the resolver would never produce is one
 * no scan can ever match, so it is refused here rather than stored as a dead
 * entry an operator would blame the scanner for.
 */
export const createBarcode = mutationWithOrg({
  args: {
    requestId: v.string(),
    itemId: v.id("items"),
    barcode: v.string(),
    kind: barcodeKind,
  },
  returns: writeOutcomeValidator,
  permissionCode: "masterData.item.manage",
  target: { table: "itemBarcodes" },
  handler: async (ctx, args) => {
    const alias = validateBarcodeAlias({
      barcode: args.barcode,
      kind: args.kind,
    });
    if (!alias.ok) {
      return refusal({
        code: "FIELD_INVALID",
        field: "barcode",
        reason: alias.error.code,
      });
    }

    const item = await ctx.tenantDb.get<ItemDocument>("items", args.itemId);
    if (item === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "itemId" });
    }

    const outcome = await createMasterDataRow({
      ...contextOf(ctx, {
        table: "itemBarcodes",
        operation: MASTER_DATA_OPERATIONS.createBarcode,
        requestId: args.requestId,
      }),
      fingerprint: {
        operation: MASTER_DATA_OPERATIONS.createBarcode,
        requestId: args.requestId,
        itemId: args.itemId,
        barcode: alias.value.barcode,
        kind: alias.value.kind,
      },
      uniqueness: [
        {
          field: "barcode",
          index: "by_orgId_barcode",
          equality: [{ field: "barcode", value: alias.value.barcode }],
        },
      ],
      document: {
        itemId: args.itemId,
        barcode: alias.value.barcode,
        kind: alias.value.kind,
        status: "ACTIVE",
      },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/**
 * Withdraw a barcode alias.
 *
 * Deactivated, never deleted: a receipt posted last month resolved through this
 * alias, and removing the row would make that history unexplainable. An inactive
 * alias stops resolving (`resolveBarcode` answers `UNKNOWN_BARCODE`) while
 * keeping the unique key occupied, which is correct — the value still means what
 * it meant, it just may not be used.
 */
export const deactivateBarcode = mutationWithOrg({
  args: { requestId: v.string(), barcodeId: v.id("itemBarcodes") },
  returns: writeOutcomeValidator,
  permissionCode: "masterData.item.manage",
  target: { table: "itemBarcodes", id: ({ barcodeId }) => barcodeId },
  handler: async (ctx, args) => {
    const outcome = await updateMasterDataRow({
      ...contextOf(ctx, {
        table: "itemBarcodes",
        operation: MASTER_DATA_OPERATIONS.deactivateBarcode,
        requestId: args.requestId,
      }),
      documentId: args.barcodeId,
      fingerprint: {
        operation: MASTER_DATA_OPERATIONS.deactivateBarcode,
        requestId: args.requestId,
        barcodeId: args.barcodeId,
      },
      uniqueness: [],
      patch: { status: "INACTIVE" },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/* -------------------------------------------------------------------------- */
/* Alternate item UOMs                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Declare an alternate packaging unit and its exact factor to the base UOM.
 *
 * The factor is two integers, because `ADR-0004` is exact and a float is not:
 * a case of twelve is `12/1`, and a drum decanted into three is `1/3`, which no
 * float represents. `validateAlternateConversion` reduces it through
 * `makeRatio`, so `24/2` and `12/1` become the same stored row rather than two
 * spellings of one factor.
 *
 * The item's own base UOM is refused as an alternate here rather than left to
 * the profile rebuild: at create time there is no profile yet, and discovering
 * the clash only when the table is next read would mean storing a row that can
 * never be read back.
 */
export const createItemUom = mutationWithOrg({
  args: {
    requestId: v.string(),
    itemId: v.id("items"),
    uom: v.string(),
    toBaseNumerator: v.number(),
    toBaseDenominator: v.number(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "masterData.item.manage",
  target: { table: "itemUoms" },
  handler: async (ctx, args) => {
    const item = await ctx.tenantDb.get<ItemDocument>("items", args.itemId);
    if (item === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "itemId" });
    }

    const conversion = validateAlternateConversion({
      uom: args.uom,
      baseUom: item.baseUom,
      toBaseNumerator: args.toBaseNumerator,
      toBaseDenominator: args.toBaseDenominator,
    });
    if (!conversion.ok) {
      return refusal({
        code: "FIELD_INVALID",
        field: "field" in conversion.error ? conversion.error.field : "uom",
        reason: conversion.error.code,
      });
    }

    const outcome = await createMasterDataRow({
      ...contextOf(ctx, {
        table: "itemUoms",
        operation: MASTER_DATA_OPERATIONS.createItemUom,
        requestId: args.requestId,
      }),
      fingerprint: {
        operation: MASTER_DATA_OPERATIONS.createItemUom,
        requestId: args.requestId,
        itemId: args.itemId,
        uom: conversion.value.uom,
        toBaseNumerator: conversion.value.toBaseNumerator,
        toBaseDenominator: conversion.value.toBaseDenominator,
      },
      uniqueness: [
        {
          field: "uom",
          index: "by_orgId_itemId_uom",
          equality: [
            { field: "itemId", value: args.itemId },
            { field: "uom", value: conversion.value.uom },
          ],
        },
      ],
      document: {
        itemId: args.itemId,
        uom: conversion.value.uom,
        toBaseNumerator: conversion.value.toBaseNumerator,
        toBaseDenominator: conversion.value.toBaseDenominator,
        status: "ACTIVE",
      },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/**
 * Retire an alternate unit.
 *
 * A factor is never edited in place. A quantity captured last week in `CASE` was
 * converted with the factor that was current then, and the ledger stored the
 * *result* in base units — so changing the factor cannot corrupt history, but it
 * can make two receipts of "one case" mean different amounts with nothing on the
 * screen to say so. Retiring and declaring a new unit leaves both visible.
 */
export const deactivateItemUom = mutationWithOrg({
  args: { requestId: v.string(), itemUomId: v.id("itemUoms") },
  returns: writeOutcomeValidator,
  permissionCode: "masterData.item.manage",
  target: { table: "itemUoms", id: ({ itemUomId }) => itemUomId },
  handler: async (ctx, args) => {
    const outcome = await updateMasterDataRow({
      ...contextOf(ctx, {
        table: "itemUoms",
        operation: MASTER_DATA_OPERATIONS.deactivateItemUom,
        requestId: args.requestId,
      }),
      documentId: args.itemUomId,
      fingerprint: {
        operation: MASTER_DATA_OPERATIONS.deactivateItemUom,
        requestId: args.requestId,
        itemUomId: args.itemUomId,
      },
      uniqueness: [],
      patch: { status: "INACTIVE" },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/* -------------------------------------------------------------------------- */
/* Label templates                                                             */
/* -------------------------------------------------------------------------- */

interface LabelTemplateRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly code: string;
  readonly version: number;
  readonly status: string;
  readonly draftedByUserId: string;
}

/**
 * Author a new DRAFT version of a label template.
 *
 * `label.template.draft` carries no flags, because drafting is authoring: it
 * produces a row nothing prints from. Publishing is the controlled step, and it
 * is a **different permission held by a different person** — see
 * `publishLabelTemplate`.
 *
 * The version is derived server-side from the existing versions of this code,
 * never supplied: a client-chosen version would let two drafts claim one number,
 * and a printed label cites the version as evidence.
 *
 * `body` is stored as text. Nothing here renders, transmits, or prints it.
 */
export const draftLabelTemplate = mutationWithOrg({
  args: {
    requestId: v.string(),
    code: v.string(),
    name: v.string(),
    format: labelTemplateFormat,
    body: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "label.template.draft",
  target: { table: "labelTemplates" },
  handler: async (ctx, args) => {
    const code = normalizeField("code", args.code, CODE_FIELD);
    if (!code.ok) return refusal(code.error);
    const name = normalizeDisplayName("name", args.name);
    if (!name.ok) return refusal(name.error);

    const body = validateLabelBody(args.body);
    if (!body.ok) {
      return refusal({
        code: "FIELD_INVALID",
        field: "body",
        reason: body.error.code,
      });
    }

    /*
     * A bounded read of this code's existing versions. `MAX_TEMPLATE_VERSIONS`
     * is the depth one draft may look back over; a template with more history
     * than that needs a paged view rather than a deeper scan here.
     */
    const existing = await ctx.tenantDb
      .byIndex<LabelTemplateRow>("labelTemplates", "by_orgId_code_version", [
        { field: "code", value: code.value },
      ])
      .take(MAX_TEMPLATE_VERSIONS);

    const version = nextTemplateVersion(existing.map((row) => row.version));
    if (!version.ok) {
      return refusal({
        code: "FIELD_INVALID",
        field: "version",
        reason: version.error.code,
      });
    }

    const outcome = await createMasterDataRow({
      ...contextOf(ctx, {
        table: "labelTemplates",
        operation: MASTER_DATA_OPERATIONS.draftLabelTemplate,
        requestId: args.requestId,
      }),
      fingerprint: {
        operation: MASTER_DATA_OPERATIONS.draftLabelTemplate,
        requestId: args.requestId,
        code: code.value,
        name: name.value,
        format: args.format,
        body: body.value,
      },
      uniqueness: [
        {
          field: "version",
          index: "by_orgId_code_version",
          equality: [
            { field: "code", value: code.value },
            { field: "version", value: version.value },
          ],
        },
      ],
      document: {
        code: code.value,
        version: version.value,
        name: name.value,
        format: args.format,
        body: body.value,
        status: "DRAFT",
        draftedByUserId: ctx.tenant.actor._id,
      },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/**
 * The deepest version history one draft looks back over. Bounded, like every
 * read here; comfortably under the accessor's own cap.
 */
export const MAX_TEMPLATE_VERSIONS = 50;

/**
 * Publish a drafted template version.
 *
 * **The repository's first genuine maker-checker workflow.**
 * `label.template.manage` carries maker-checker and step-up (catalogue §2), and
 * the policy below supplies the maker from the row's own `draftedByUserId`. The
 * evaluator then denies when the drafter and the publisher are the same person
 * (`INV-0006-05`), which is exactly the separation of duties a document that
 * becomes audit evidence deserves: one person writes the label, another approves
 * what will be printed on every carton.
 *
 * That also means a **single actor cannot publish**, by design. The denial is
 * the system working, and it commits its audit row.
 *
 * Step-up is a second, independent gate: the evaluator additionally requires a
 * recent reverification (`REVERIFICATION_REQUIRED`), which needs a Clerk
 * instance to produce. Both denials are recorded.
 */
export const publishLabelTemplate = mutationWithOrg({
  args: {
    requestId: v.string(),
    labelTemplateId: v.id("labelTemplates"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "label.template.manage",
  target: {
    table: "labelTemplates",
    id: ({ labelTemplateId }) => labelTemplateId,
  },
  policy: async (ctx, args: { readonly labelTemplateId: string }) => {
    /*
     * The maker is the drafter, read from the row rather than re-derived from
     * the audit trail: a stored field is checkable, and an audit scan would make
     * the decision depend on retention.
     *
     * A row this tenant does not own reads as `null`, which yields no maker and
     * therefore a denial — the same answer a foreign ID gets everywhere else.
     *
     * `thresholdExceeded: false` because no threshold policy table exists
     * (`RG-030`); "nothing exceeds an unconfigured threshold" is the only honest
     * reading of an absent policy.
     */
    const row = await ctx.tenantDb.get<LabelTemplateRow>(
      "labelTemplates",
      args.labelTemplateId,
    );
    if (row === null) {
      return Object.freeze({
        thresholdExceeded: false,
        approvalSatisfied: false,
      });
    }
    return Object.freeze({
      thresholdExceeded: false,
      approvalSatisfied: true,
      makerUserId: row.draftedByUserId,
    });
  },
  handler: async (ctx, args) => {
    const row = await ctx.tenantDb.get<LabelTemplateRow>(
      "labelTemplates",
      args.labelTemplateId,
    );
    if (row === null)
      return refusal({ code: "NOT_FOUND", table: "labelTemplates" });

    if (row.status !== "DRAFT") {
      return refusal({
        code: "FIELD_INVALID",
        field: "status",
        reason: "NOT_A_DRAFT",
      });
    }

    const outcome = await updateMasterDataRow({
      ...contextOf(ctx, {
        table: "labelTemplates",
        operation: MASTER_DATA_OPERATIONS.publishLabelTemplate,
        requestId: args.requestId,
      }),
      documentId: args.labelTemplateId,
      fingerprint: {
        operation: MASTER_DATA_OPERATIONS.publishLabelTemplate,
        requestId: args.requestId,
        labelTemplateId: args.labelTemplateId,
      },
      uniqueness: [],
      patch: {
        status: "ACTIVE",
        publishedByUserId: ctx.tenant.actor._id,
      },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});
