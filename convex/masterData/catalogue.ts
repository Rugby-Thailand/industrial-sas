/**
 * The master-data read surface.
 *
 * Bounded, resumable reads over the reference tables the ledger depends on —
 * items, warehouses, locations, lots, handling units, owners, and reason codes,
 * plus the five entities added later: suppliers, item barcodes, alternate item
 * UOMs, storage classes, and label templates. Every one is registered through
 * `queryWithOrg`,
 * which is the only registration path this repository permits, and every one
 * declares a **read** permission rather than borrowing a `manage` code: reading
 * the item catalogue must not require the right to change it
 * (`ADR-0006` §2, least privilege). Two of those read codes —
 * `masterData.reasonCode.read` and `masterData.owner.read` — were added to the
 * catalogue with this module, because using `.manage` for a list would have been
 * the easy wrong answer.
 *
 * ### Why this module is reads only
 *
 * The ledger refuses a posting whose item, location, lot, handling unit, or
 * owner does not belong to the tenant (`INV-0003-04`, `INV-0005-02`), and these
 * functions are how a supervisor tells an empty catalogue from a denial.
 *
 * Creating and editing lives in `writes.ts`, not here, and the split is not
 * cosmetic: a write needs an idempotency namespace, a uniqueness check the
 * schema cannot enforce (Convex has no unique constraint — see
 * `UNIQUENESS_CONTRACTS`), and an audit trail. Keeping the read surface free of
 * all three is what makes it obvious that nothing in this file can mutate.
 *
 * Two single-document reads (`getItem`, `getLabelTemplate`) are here rather than
 * in a separate module because they are reads: both go through `tenantDb.get`,
 * so a foreign document answers exactly what a nonexistent one answers
 * (`INV-0002-03`).
 *
 * ### Scope
 *
 * `locations` and `handlingUnits` are warehouse-scoped, so their functions take
 * a `warehouseId` the wrapper revalidates against the actor's membership before
 * the handler runs (`INV-0006-04`). The rest are organization-scoped: an item or
 * a lot belongs to the tenant, not to a site.
 *
 * ### Paging
 *
 * Every list is a `JobPageRequest` over an `orgId`-first index, capped at
 * `MAX_JOB_PAGE_SIZE` and **refused** above it rather than clamped, exactly as
 * the ledger's own reads are. There is no `collect` here and no unpaged variant,
 * because a tenant with 5,000 SKUs (D-01) is the small case.
 *
 * ### Status filtering
 *
 * `status` is an optional argument served by a status-first index where one
 * exists, so "active items only" is an indexed read rather than a filter over a
 * scan. Omitting it returns every status, which is what an administrator
 * auditing a deactivation needs.
 */
import { v, type Validator } from "convex/values";

import type {
  TenantDocumentAccess,
  TenantOrgId,
  TenantOwnedDocument,
} from "../lib/tenantDb";
import { queryWithOrg } from "../lib/tenantFunctions";
import {
  barcodeKind,
  itemTrackingMode,
  labelTemplateFormat,
  labelTemplateStatus,
  locationType,
  masterDataStatus,
  reasonCodeScope,
  type LabelTemplateStatus,
  type MasterDataStatus,
} from "../lib/validators";
import {
  MAX_JOB_PAGE_SIZE,
  makeJobPageRequest,
  type JobPageRequest,
} from "../model/inventory/jobPage";
import {
  profileFromRows,
  validateBarcodeAlias,
} from "../model/masterData/catalogueRules";

/* -------------------------------------------------------------------------- */
/* Shared shapes                                                               */
/* -------------------------------------------------------------------------- */

/** The arguments every master-data list takes. */
const listArgs = {
  status: v.optional(masterDataStatus),
  maxPageSize: v.optional(v.number()),
  cursor: v.optional(v.string()),
};

/** The refusal shape, matching the ledger's so a client has one error union. */
const listErrorValidator = v.object({
  code: v.string(),
  received: v.optional(v.string()),
  requested: v.optional(v.number()),
  limit: v.optional(v.number()),
  length: v.optional(v.number()),
});

/**
 * The wire shape of a master-data page: the rows, the cursor, completion — or a
 * refusal. Generic over the row validator so each entity keeps its own,
 * type-checked, rather than sharing a widened one.
 */
const pageOf = <Row extends Validator<unknown, "required", string>>(
  rowValidator: Row,
) =>
  v.union(
    v.object({
      ok: v.literal(true),
      items: v.array(rowValidator),
      nextCursor: v.union(v.string(), v.null()),
      complete: v.boolean(),
    }),
    v.object({ ok: v.literal(false), error: listErrorValidator }),
  );

/** A refusal, flattened for the wire. */
const refusal = (error: Record<string, unknown>) => ({
  ok: false as const,
  error: { ...error } as { code: string },
});

/**
 * Turn the optional page arguments into a validated request.
 *
 * Shared so every list refuses an over-large page and a malformed cursor by the
 * same rule and with the same code. A caller that asked for 5,000 rows finds
 * out, rather than silently receiving a hundred.
 */
function pageRequest(args: {
  readonly maxPageSize?: number;
  readonly cursor?: string;
}) {
  return makeJobPageRequest({
    ...(args.maxPageSize === undefined
      ? {}
      : { maxPageSize: args.maxPageSize }),
    ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
  });
}

/**
 * Read one page through a tenant-bound index.
 *
 * The `status` argument decides *which index*, never a post-read filter: a
 * filter over an unbounded scan is exactly what `INV-0002-05` forbids, and the
 * status-first indexes exist so this choice is available.
 */
async function readPage<Document extends TenantOwnedDocument>(
  tenantDb: TenantDocumentAccess,
  table: Parameters<TenantDocumentAccess["byIndex"]>[0],
  index: string,
  equality: readonly { readonly field: string; readonly value: unknown }[],
  request: JobPageRequest,
): Promise<{
  readonly items: readonly Document[];
  readonly nextCursor: string | null;
  readonly complete: boolean;
}> {
  const page = await tenantDb.byIndex<Document>(table, index, equality).page({
    limit: request.maxPageSize,
    ...(request.cursor === null ? {} : { cursor: request.cursor }),
  });

  return {
    items: page.page,
    nextCursor: page.isDone ? null : page.continueCursor,
    complete: page.isDone,
  };
}

/** The equality terms for an optional status, in index-prefix order. */
const statusTerms = (
  status: MasterDataStatus | undefined,
  extra: readonly { readonly field: string; readonly value: unknown }[] = [],
) =>
  status === undefined ? extra : [...extra, { field: "status", value: status }];

/* -------------------------------------------------------------------------- */
/* Items                                                                       */
/* -------------------------------------------------------------------------- */

const itemValidator = v.object({
  itemId: v.id("items"),
  sku: v.string(),
  name: v.string(),
  baseUom: v.string(),
  trackingMode: itemTrackingMode,
  status: masterDataStatus,
});

interface ItemDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly sku: string;
  readonly name: string;
  readonly baseUom: string;
  readonly trackingMode: "NONE" | "LOT" | "LOT_SERIAL";
  readonly status: MasterDataStatus;
}

/**
 * The tenant's items, by SKU.
 *
 * Ordered by the index, which is `(orgId, sku)` or `(orgId, status, sku)`. SKU
 * order is byte order, not Thai collation — the SKU is a code identifier and
 * stays English (`D-06`); the *name* may be Thai and is deliberately not the
 * sort key, because Thai collation (`ADR-0010` §4) has no implementation here
 * yet and byte-ordering Thai would be worse than ordering by a code.
 */
export const listItems = queryWithOrg({
  args: listArgs,
  returns: pageOf(itemValidator),
  permissionCode: "masterData.item.read",
  target: { table: "items" },
  handler: async (ctx, args) => {
    const request = pageRequest(args);
    if (!request.ok) return refusal(request.error);

    const page = await readPage<ItemDocument>(
      ctx.tenantDb,
      "items",
      args.status === undefined ? "by_orgId_sku" : "by_orgId_status_sku",
      statusTerms(args.status),
      request.value,
    );

    return {
      ok: true as const,
      items: page.items.map((item) => ({
        itemId: item._id as never,
        sku: item.sku,
        name: item.name,
        baseUom: item.baseUom,
        trackingMode: item.trackingMode,
        status: item.status,
      })),
      nextCursor: page.nextCursor,
      complete: page.complete,
    };
  },
});

const itemDetailValidator = v.union(
  v.object({ found: v.literal(true), item: itemValidator }),
  v.object({ found: v.literal(false) }),
);

/**
 * One item, by identifier.
 *
 * The maintenance screen for an item needs its base UOM before it can label a
 * conversion table, and paging the whole register to find one row would be a
 * read whose cost grows with the catalogue.
 *
 * A missing item and another tenant's item answer identically — `{found:false}`
 * — because `tenantDb.get` refuses a foreign document the same way it refuses a
 * nonexistent one (`INV-0002-03`). An answer that distinguished them would
 * confirm that an identifier exists somewhere, which is the whole of what an
 * enumeration attack needs.
 */
export const getItem = queryWithOrg({
  args: { itemId: v.id("items") },
  returns: itemDetailValidator,
  permissionCode: "masterData.item.read",
  target: { table: "items", id: ({ itemId }) => itemId },
  handler: async (ctx, args) => {
    const row = await ctx.tenantDb.get<ItemDocument>("items", args.itemId);
    if (row === null) return { found: false as const };

    return {
      found: true as const,
      item: {
        itemId: row._id as never,
        sku: row.sku,
        name: row.name,
        baseUom: row.baseUom,
        trackingMode: row.trackingMode,
        status: row.status,
      },
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Warehouses                                                                  */
/* -------------------------------------------------------------------------- */

const warehouseValidator = v.object({
  warehouseId: v.id("warehouses"),
  code: v.string(),
  name: v.string(),
  status: v.string(),
});

interface WarehouseDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

/**
 * The tenant's warehouses.
 *
 * Organization-scoped on purpose, and this is the one place that matters: the
 * *warehouse selector* needs this list, and a warehouse-scoped permission
 * cannot serve it — an actor would have to already know a warehouse to ask
 * which warehouses exist. The rows returned are still the tenant's own, and a
 * warehouse the actor may not act in is still refused by every operation that
 * takes one (`INV-0006-04`); knowing a site exists is not knowing its stock.
 */
export const listWarehouses = queryWithOrg({
  args: {
    maxPageSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: pageOf(warehouseValidator),
  permissionCode: "masterData.warehouse.read",
  target: { table: "warehouses" },
  handler: async (ctx, args) => {
    const request = pageRequest(args);
    if (!request.ok) return refusal(request.error);

    const page = await readPage<WarehouseDocument>(
      ctx.tenantDb,
      "warehouses",
      "by_orgId_code",
      [],
      request.value,
    );

    return {
      ok: true as const,
      items: page.items.map((warehouse) => ({
        warehouseId: warehouse._id as never,
        code: warehouse.code,
        name: warehouse.name,
        status: warehouse.status,
      })),
      nextCursor: page.nextCursor,
      complete: page.complete,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Locations                                                                   */
/* -------------------------------------------------------------------------- */

const locationValidator = v.object({
  locationId: v.id("locations"),
  warehouseId: v.id("warehouses"),
  code: v.string(),
  locationType,
  status: masterDataStatus,
});

interface LocationDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly code: string;
  readonly locationType: string;
  readonly status: MasterDataStatus;
}

/** One warehouse's locations, by code. Warehouse-scoped (`INV-0006-04`). */
export const listLocations = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), ...listArgs },
  returns: pageOf(locationValidator),
  permissionCode: "masterData.location.read",
  target: { table: "locations" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequest(args);
    if (!request.ok) return refusal(request.error);

    const page = await readPage<LocationDocument>(
      ctx.tenantDb,
      "locations",
      args.status === undefined
        ? "by_orgId_warehouseId_code"
        : "by_orgId_warehouseId_status_code",
      statusTerms(args.status, [
        { field: "warehouseId", value: args.warehouseId },
      ]),
      request.value,
    );

    return {
      ok: true as const,
      items: page.items.map((location) => ({
        locationId: location._id as never,
        warehouseId: location.warehouseId as never,
        code: location.code,
        locationType: location.locationType as never,
        status: location.status,
      })),
      nextCursor: page.nextCursor,
      complete: page.complete,
    };
  },
});

/**
 * The location types stock may be *received to*.
 *
 * A dock and a staging lane are working surfaces, which is exactly why they are
 * the right answer here and the wrong one for putaway: receiving puts a pallet
 * down where it was unloaded, and putaway moves it off. Receiving straight to a
 * rack would make the putaway task a fiction.
 */
export const RECEIVING_LOCATION_TYPES: readonly string[] = Object.freeze([
  "DOCK",
  "STAGING",
]);

/**
 * How many locations of one receiving type a single read answers with.
 *
 * A site has a handful of docks and staging lanes, not a hundred; the cap is the
 * bounded-read contract rather than a real ceiling anybody meets. It is a `take`
 * over an index whose prefix already includes the type, so the read never touches
 * the racks — which is the whole point of the index.
 */
export const MAX_RECEIVING_LOCATIONS_PER_TYPE = 50;

export const listReceivingLocations = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.union(
    v.object({ ok: v.literal(true), items: v.array(locationValidator) }),
    v.object({ ok: v.literal(false), error: listErrorValidator }),
  ),
  permissionCode: "masterData.location.read",
  target: { table: "locations" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    /*
     * One indexed read per receiving type, not one scan filtered afterwards.
     * The type is in the index prefix, so a warehouse with a thousand racks
     * costs nothing here — and, more importantly, cannot hide its own dock.
     *
     * Two reads rather than one because `RECEIVING_LOCATION_TYPES` is a set and
     * an index prefix is a single value. Two bounded reads is the honest shape
     * of that question; the alternative is the scan this replaced.
     */
    const found: LocationDocument[] = [];
    for (const locationType of RECEIVING_LOCATION_TYPES) {
      const rows = await ctx.tenantDb
        .byIndex<LocationDocument>(
          "locations",
          "by_orgId_warehouseId_status_locationType_code",
          [
            { field: "warehouseId", value: args.warehouseId },
            { field: "status", value: "ACTIVE" },
            { field: "locationType", value: locationType },
          ],
        )
        .take(MAX_RECEIVING_LOCATIONS_PER_TYPE);
      found.push(...rows);
    }

    return {
      ok: true as const,
      items: found.map((row) => ({
        locationId: row._id as never,
        warehouseId: row.warehouseId as never,
        code: row.code,
        locationType: row.locationType as never,
        status: row.status,
      })),
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Lots                                                                        */
/* -------------------------------------------------------------------------- */

const lotValidator = v.object({
  lotId: v.id("lots"),
  itemId: v.id("items"),
  lotCode: v.string(),
  manufactureDate: v.optional(v.string()),
  expirationDate: v.optional(v.string()),
  bestBeforeDate: v.optional(v.string()),
  status: masterDataStatus,
});

interface LotDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly itemId: string;
  readonly lotCode: string;
  readonly manufactureDate?: string;
  readonly expirationDate?: string;
  readonly bestBeforeDate?: string;
  readonly status: MasterDataStatus;
}

/**
 * One item's lots, by lot code.
 *
 * `itemId` is required rather than optional. A tenant-wide lot list would be an
 * unbounded read of the largest table in this group, and every screen that wants
 * lots wants one item's lots — a receiving line, an expiry review, a FEFO
 * explanation. The item is revalidated as the tenant's own by the accessor
 * before the index is read.
 */
export const listLotsForItem = queryWithOrg({
  args: { itemId: v.id("items"), ...listArgs },
  returns: pageOf(lotValidator),
  permissionCode: "masterData.lot.read",
  target: { table: "lots" },
  handler: async (ctx, args) => {
    const request = pageRequest(args);
    if (!request.ok) return refusal(request.error);

    /*
     * The item is read first, through the tenant-bound accessor, so another
     * tenant's item ID answers the same "no such item" a nonexistent one does
     * (`INV-0002-03`) rather than an empty page that would confirm the ID
     * parses.
     */
    const item = await ctx.tenantDb.get<ItemDocument>("items", args.itemId);
    if (item === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", received: "items" });
    }

    /*
     * The status is an index term, never a predicate over the page.
     *
     * Filtering after the read was the earlier shape, and it was wrong in a way
     * that looked bounded: a page is drawn *before* the predicate runs, so a
     * request for one item's `ACTIVE` lots returned however many of that page
     * happened to be active — frequently fewer than `maxPageSize`, and zero
     * whenever a page held only archived rows. `complete` and `nextCursor`
     * described the unfiltered read, so an empty page still said "more to come",
     * and a screen that renders one page showed "no lots" for an item that has
     * them.
     *
     * Both index shapes are declared, so the status-carrying one is used when a
     * status was asked for and the plain one when it was not; neither branch
     * scans (`INV-0002-04`).
     */
    const page = await readPage<LotDocument>(
      ctx.tenantDb,
      "lots",
      args.status === undefined
        ? "by_orgId_itemId_lotCode"
        : "by_orgId_itemId_status_lotCode",
      statusTerms(args.status, [{ field: "itemId", value: args.itemId }]),
      request.value,
    );

    return {
      ok: true as const,
      items: page.items.map((lot) => ({
        lotId: lot._id as never,
        itemId: lot.itemId as never,
        lotCode: lot.lotCode,
        ...(lot.manufactureDate === undefined
          ? {}
          : { manufactureDate: lot.manufactureDate }),
        ...(lot.expirationDate === undefined
          ? {}
          : { expirationDate: lot.expirationDate }),
        ...(lot.bestBeforeDate === undefined
          ? {}
          : { bestBeforeDate: lot.bestBeforeDate }),
        status: lot.status,
      })),
      nextCursor: page.nextCursor,
      complete: page.complete,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Handling units                                                              */
/* -------------------------------------------------------------------------- */

const handlingUnitValidator = v.object({
  handlingUnitId: v.id("handlingUnits"),
  warehouseId: v.id("warehouses"),
  lpn: v.string(),
  currentLocationId: v.optional(v.id("locations")),
  widthMm: v.optional(v.number()),
  depthMm: v.optional(v.number()),
  heightMm: v.optional(v.number()),
  status: masterDataStatus,
});

interface HandlingUnitDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly lpn: string;
  readonly currentLocationId?: string;
  readonly widthMm?: number;
  readonly depthMm?: number;
  readonly heightMm?: number;
  readonly status: MasterDataStatus;
}

/** One warehouse's handling units, by LPN. Warehouse-scoped. */
export const listHandlingUnits = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    status: v.optional(masterDataStatus),
    maxPageSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: pageOf(handlingUnitValidator),
  permissionCode: "handlingUnit.read",
  target: { table: "handlingUnits" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequest(args);
    if (!request.ok) return refusal(request.error);

    /*
     * The only index available is `(orgId, warehouseId, status, lpn)`, so a
     * status is required to use it as a prefix. Without one the read would be
     * a scan; with `ACTIVE` as the default the answer would silently omit
     * archived units. The honest resolution is to read each status the schema
     * declares — a bounded, fixed number of indexed reads — and this function
     * asks for one status at a time, defaulting to `ACTIVE`, which is stated in
     * the argument rather than hidden in the handler.
     */
    const status: MasterDataStatus = args.status ?? "ACTIVE";
    const page = await readPage<HandlingUnitDocument>(
      ctx.tenantDb,
      "handlingUnits",
      "by_orgId_warehouseId_status_lpn",
      [
        { field: "warehouseId", value: args.warehouseId },
        { field: "status", value: status },
      ],
      request.value,
    );

    return {
      ok: true as const,
      items: page.items.map((unit) => ({
        handlingUnitId: unit._id as never,
        warehouseId: unit.warehouseId as never,
        lpn: unit.lpn,
        ...(unit.currentLocationId === undefined
          ? {}
          : { currentLocationId: unit.currentLocationId as never }),
        ...(unit.widthMm === undefined ? {} : { widthMm: unit.widthMm }),
        ...(unit.depthMm === undefined ? {} : { depthMm: unit.depthMm }),
        ...(unit.heightMm === undefined ? {} : { heightMm: unit.heightMm }),
        status: unit.status,
      })),
      nextCursor: page.nextCursor,
      complete: page.complete,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Reason codes                                                                */
/* -------------------------------------------------------------------------- */

const reasonCodeValidator = v.object({
  reasonCodeId: v.id("reasonCodes"),
  code: v.string(),
  name: v.string(),
  scope: reasonCodeScope,
  status: masterDataStatus,
});

interface ReasonCodeDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly code: string;
  readonly name: string;
  readonly scope: string;
  readonly status: MasterDataStatus;
}

/**
 * The tenant's reason codes, optionally for one scope.
 *
 * A reason code is the audit evidence on an adjustment, a scrap, and a reversal
 * (`ADR-0003` §5), so every screen that shows one of those needs to resolve it
 * to a name. That is why `masterData.reasonCode.read` is granted to every role
 * that reads master data at all, while `.manage` stays with administrators.
 */
export const listReasonCodes = queryWithOrg({
  args: {
    scope: v.optional(reasonCodeScope),
    maxPageSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: pageOf(reasonCodeValidator),
  permissionCode: "masterData.reasonCode.read",
  target: { table: "reasonCodes" },
  handler: async (ctx, args) => {
    const request = pageRequest(args);
    if (!request.ok) return refusal(request.error);

    const page = await readPage<ReasonCodeDocument>(
      ctx.tenantDb,
      "reasonCodes",
      args.scope === undefined ? "by_orgId_code" : "by_orgId_scope_code",
      args.scope === undefined ? [] : [{ field: "scope", value: args.scope }],
      request.value,
    );

    return {
      ok: true as const,
      items: page.items.map((reason) => ({
        reasonCodeId: reason._id as never,
        code: reason.code,
        name: reason.name,
        scope: reason.scope as never,
        status: reason.status,
      })),
      nextCursor: page.nextCursor,
      complete: page.complete,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Owners                                                                      */
/* -------------------------------------------------------------------------- */

const ownerValidator = v.object({
  ownerId: v.id("owners"),
  code: v.string(),
  name: v.string(),
  status: masterDataStatus,
});

interface OwnerDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly code: string;
  readonly name: string;
  readonly status: MasterDataStatus;
}

/**
 * The tenant's stock owners.
 *
 * Consigned stock is disabled by `organizations.settings.consignedStockEnabled`
 * and the ledger refuses an `ownerId` while it is off (D-11). This list is still
 * readable, and returning an empty page for a tenant that has never enabled the
 * feature is the correct answer — not an error, because "no owners" and "owners
 * are off" are different questions and the second one is the organization
 * settings read, not this.
 */
export const listOwners = queryWithOrg({
  args: {
    maxPageSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: pageOf(ownerValidator),
  permissionCode: "masterData.owner.read",
  target: { table: "owners" },
  handler: async (ctx, args) => {
    const request = pageRequest(args);
    if (!request.ok) return refusal(request.error);

    const page = await readPage<OwnerDocument>(
      ctx.tenantDb,
      "owners",
      "by_orgId_code",
      [],
      request.value,
    );

    return {
      ok: true as const,
      items: page.items.map((owner) => ({
        ownerId: owner._id as never,
        code: owner.code,
        name: owner.name,
        status: owner.status,
      })),
      nextCursor: page.nextCursor,
      complete: page.complete,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Suppliers                                                                   */
/* -------------------------------------------------------------------------- */

const supplierValidator = v.object({
  supplierId: v.id("suppliers"),
  code: v.string(),
  name: v.string(),
  status: masterDataStatus,
});

interface SupplierDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly code: string;
  readonly name: string;
  readonly status: MasterDataStatus;
}

/** The tenant's suppliers, by code. */
export const listSuppliers = queryWithOrg({
  args: listArgs,
  returns: pageOf(supplierValidator),
  permissionCode: "masterData.supplier.read",
  target: { table: "suppliers" },
  handler: async (ctx, args) => {
    const request = pageRequest(args);
    if (!request.ok) return refusal(request.error);

    const page = await readPage<SupplierDocument>(
      ctx.tenantDb,
      "suppliers",
      args.status === undefined ? "by_orgId_code" : "by_orgId_status_code",
      statusTerms(args.status),
      request.value,
    );

    return {
      ok: true as const,
      items: page.items.map((supplier) => ({
        supplierId: supplier._id as never,
        code: supplier.code,
        name: supplier.name,
        status: supplier.status,
      })),
      nextCursor: page.nextCursor,
      complete: page.complete,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Storage classes                                                             */
/* -------------------------------------------------------------------------- */

const storageClassValidator = v.object({
  storageClassId: v.id("storageClasses"),
  code: v.string(),
  name: v.string(),
  status: masterDataStatus,
});

interface StorageClassDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly code: string;
  readonly name: string;
  readonly status: MasterDataStatus;
}

/**
 * The tenant's storage classes, by code.
 *
 * Organization-scoped, with its own read code rather than borrowing
 * `masterData.location.read`. A class means the same thing at every site (D-13),
 * so a warehouse-scoped permission would force a site selection before an
 * administrator could see organization-level data — and would make the answer
 * depend on which site they happened to have chosen.
 */
export const listStorageClasses = queryWithOrg({
  args: listArgs,
  returns: pageOf(storageClassValidator),
  permissionCode: "masterData.storageClass.read",
  target: { table: "storageClasses" },
  handler: async (ctx, args) => {
    const request = pageRequest(args);
    if (!request.ok) return refusal(request.error);

    const page = await readPage<StorageClassDocument>(
      ctx.tenantDb,
      "storageClasses",
      args.status === undefined ? "by_orgId_code" : "by_orgId_status_code",
      statusTerms(args.status),
      request.value,
    );

    return {
      ok: true as const,
      items: page.items.map((storageClass) => ({
        storageClassId: storageClass._id as never,
        code: storageClass.code,
        name: storageClass.name,
        status: storageClass.status,
      })),
      nextCursor: page.nextCursor,
      complete: page.complete,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Item barcodes                                                               */
/* -------------------------------------------------------------------------- */

const barcodeValidator = v.object({
  barcodeId: v.id("itemBarcodes"),
  itemId: v.id("items"),
  barcode: v.string(),
  kind: barcodeKind,
  status: masterDataStatus,
});

interface BarcodeDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly itemId: string;
  readonly barcode: string;
  readonly kind: string;
  readonly status: MasterDataStatus;
}

/**
 * One item's scannable aliases.
 *
 * Scoped to an item on purpose. A tenant-wide barcode list would be a scan
 * dictionary, and the operation that wants one — resolving a scan — is a
 * *lookup by barcode*, which is a different, single-row read
 * (`resolveBarcode`).
 */
export const listBarcodesForItem = queryWithOrg({
  args: { itemId: v.id("items"), ...listArgs },
  returns: pageOf(barcodeValidator),
  permissionCode: "masterData.item.read",
  target: { table: "itemBarcodes" },
  handler: async (ctx, args) => {
    const request = pageRequest(args);
    if (!request.ok) return refusal(request.error);

    const item = await ctx.tenantDb.get<ItemDocument>("items", args.itemId);
    if (item === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", received: "items" });
    }

    /* The status is an index term, not a predicate over the page; see
     * `listLotsForItem` above for what filtering afterwards did to `complete`. */
    const page = await readPage<BarcodeDocument>(
      ctx.tenantDb,
      "itemBarcodes",
      args.status === undefined
        ? "by_orgId_itemId_barcode"
        : "by_orgId_itemId_status_barcode",
      statusTerms(args.status, [{ field: "itemId", value: args.itemId }]),
      request.value,
    );

    return {
      ok: true as const,
      items: page.items.map((row) => ({
        barcodeId: row._id as never,
        itemId: row.itemId as never,
        barcode: row.barcode,
        kind: row.kind as never,
        status: row.status,
      })),
      nextCursor: page.nextCursor,
      complete: page.complete,
    };
  },
});

const barcodeResolutionValidator = v.union(
  v.object({
    found: v.literal(true),
    barcodeId: v.id("itemBarcodes"),
    itemId: v.id("items"),
    sku: v.string(),
    name: v.string(),
    kind: barcodeKind,
  }),
  v.object({ found: v.literal(false), reason: v.string() }),
);

/**
 * Resolve one scanned string to the item it names.
 *
 * The single-row read the receiving flow will need. It answers
 * `{ found: false }` for a barcode this tenant has never registered **and** for
 * one that belongs to an inactive alias — one answer, because "no such barcode"
 * and "a barcode you may not use" are the same instruction to an operator, and
 * distinguishing them would make the function an oracle over the catalogue.
 *
 * The scanned value is normalized through the same kernel that stored it, so a
 * scan with a wedge terminator resolves and one with a wrong GTIN check digit
 * does not — the alias would never have been stored under that value.
 */
export const resolveBarcode = queryWithOrg({
  args: { barcode: v.string(), kind: barcodeKind },
  returns: barcodeResolutionValidator,
  permissionCode: "masterData.item.read",
  target: { table: "itemBarcodes" },
  handler: async (ctx, args) => {
    const alias = validateBarcodeAlias({
      barcode: args.barcode,
      kind: args.kind,
    });
    if (!alias.ok) {
      return { found: false as const, reason: alias.error.code };
    }

    const row = await ctx.tenantDb
      .byIndex<BarcodeDocument>("itemBarcodes", "by_orgId_barcode", [
        { field: "barcode", value: alias.value.barcode },
      ])
      .unique();

    if (row === null || row.status !== "ACTIVE") {
      return { found: false as const, reason: "UNKNOWN_BARCODE" };
    }

    const item = await ctx.tenantDb.get<ItemDocument>("items", row.itemId);
    if (item === null) {
      return { found: false as const, reason: "UNKNOWN_BARCODE" };
    }

    return {
      found: true as const,
      barcodeId: row._id as never,
      itemId: row.itemId as never,
      sku: item.sku,
      name: item.name,
      kind: row.kind as never,
    };
  },
});

const scanResolutionValidator = v.union(
  v.object({
    found: v.literal(true),
    itemId: v.id("items"),
    sku: v.string(),
    name: v.string(),
    /** Which rung answered, so the screen can say what it recognised. */
    via: v.union(v.literal("BARCODE"), v.literal("SKU")),
  }),
  v.object({ found: v.literal(false), reason: v.string() }),
);

/**
 * Resolve one typed or scanned string to the item it names.
 *
 * The read that lets a capture form stop asking for a document ID. An operator
 * at a dock has a carton with a barcode on it and a packing note with a SKU on
 * it; they do not have, and cannot obtain, the item's Convex ID. A capture field
 * that took one was a field only somebody with database access could fill.
 *
 * `resolveBarcode` above is the narrower, kind-checked read used when the caller
 * already knows the symbology it holds. This one is the *counter* read: it takes
 * whatever the wedge typed and tries the two rungs a receiving screen can offer
 * from local master data.
 *
 * Two rungs, in this order:
 *
 * 1. **A registered active barcode.** Unique per tenant (`by_orgId_barcode`), so
 *    the read is a single indexed lookup rather than a scan.
 * 2. **An active item's SKU** (`by_orgId_sku`), because a delivery note carries
 *    the SKU and not the label.
 *
 * The barcode wins a tie: the thing physically on the carton beats the thing
 * written about it. Case is folded because a person typing and a wedge scanner
 * disagree about it and the stored forms are canonical.
 *
 * Deliberately *not* the full scan ladder of
 * `convex/model/identifiers/scanResolution.ts`. That kernel decides what a
 * string **is** — GS1, LPN, GTIN, SKU — and needs a tenant namespace policy to
 * do it. This decides what a string **refers to** among items, which is the
 * whole question a receiving item field asks. Binding the ladder's LPN and GS1
 * rungs to handling-unit and lot lookups is a larger contract and stays open.
 *
 * One answer for every miss (`INV-0002-03`, `INV-0002-07`): an unregistered
 * scan, a withdrawn barcode, a deactivated item, and another tenant's barcode
 * are indistinguishable. "No such thing" and "not one you may use" are the same
 * instruction to an operator, and telling them apart would make this an oracle
 * over a catalogue the caller cannot read.
 */
export const resolveScanToItem = queryWithOrg({
  args: { scan: v.string() },
  returns: scanResolutionValidator,
  permissionCode: "masterData.item.read",
  target: { table: "items" },
  handler: async (ctx, args) => {
    const scan = args.scan.trim();
    if (scan === "") {
      // Named separately because it is the one miss the *caller* caused, and an
      // empty field is a different message from an unrecognised carton.
      return { found: false as const, reason: "EMPTY_SCAN" };
    }

    const answer = (item: ItemDocument | null, via: "BARCODE" | "SKU") =>
      item === null || item.status !== "ACTIVE"
        ? null
        : {
            found: true as const,
            itemId: item._id as never,
            sku: item.sku,
            name: item.name,
            via,
          };

    const barcode = await ctx.tenantDb
      .byIndex<BarcodeDocument>("itemBarcodes", "by_orgId_barcode", [
        { field: "barcode", value: scan.toUpperCase() },
      ])
      .unique();

    if (barcode !== null && barcode.status === "ACTIVE") {
      const viaBarcode = answer(
        await ctx.tenantDb.get<ItemDocument>("items", barcode.itemId),
        "BARCODE",
      );
      if (viaBarcode !== null) return viaBarcode;
    }

    const bySku = await ctx.tenantDb
      .byIndex<ItemDocument>("items", "by_orgId_sku", [
        { field: "sku", value: scan.toUpperCase() },
      ])
      .unique();

    return (
      answer(bySku, "SKU") ?? { found: false as const, reason: "UNKNOWN_SCAN" }
    );
  },
});

/* -------------------------------------------------------------------------- */
/* Alternate item UOMs                                                         */
/* -------------------------------------------------------------------------- */

const itemUomValidator = v.object({
  itemUomId: v.id("itemUoms"),
  itemId: v.id("items"),
  uom: v.string(),
  toBaseNumerator: v.number(),
  toBaseDenominator: v.number(),
  status: masterDataStatus,
});

interface ItemUomDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly itemId: string;
  readonly uom: string;
  readonly toBaseNumerator: number;
  readonly toBaseDenominator: number;
  readonly status: MasterDataStatus;
}

const uomProfileValidator = v.union(
  v.object({
    ok: v.literal(true),
    itemId: v.id("items"),
    baseUom: v.string(),
    alternates: v.array(
      v.object({
        uom: v.string(),
        toBaseNumerator: v.number(),
        toBaseDenominator: v.number(),
      }),
    ),
  }),
  v.object({ ok: v.literal(false), error: listErrorValidator }),
);

/** One item's declared alternate units, paged. */
export const listItemUoms = queryWithOrg({
  args: { itemId: v.id("items"), ...listArgs },
  returns: pageOf(itemUomValidator),
  permissionCode: "masterData.item.read",
  target: { table: "itemUoms" },
  handler: async (ctx, args) => {
    const request = pageRequest(args);
    if (!request.ok) return refusal(request.error);

    const item = await ctx.tenantDb.get<ItemDocument>("items", args.itemId);
    if (item === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", received: "items" });
    }

    const page = await readPage<ItemUomDocument>(
      ctx.tenantDb,
      "itemUoms",
      args.status === undefined
        ? "by_orgId_itemId_uom"
        : "by_orgId_itemId_status_uom",
      statusTerms(args.status, [{ field: "itemId", value: args.itemId }]),
      request.value,
    );

    return {
      ok: true as const,
      items: page.items.map((row) => ({
        itemUomId: row._id as never,
        itemId: row.itemId as never,
        uom: row.uom,
        toBaseNumerator: row.toBaseNumerator,
        toBaseDenominator: row.toBaseDenominator,
        status: row.status,
      })),
      nextCursor: page.nextCursor,
      complete: page.complete,
    };
  },
});

/**
 * One item's whole conversion profile, rebuilt through the kernel.
 *
 * A **bounded** read: `MAX_ITEM_UOM_ROWS` alternates, because a profile is only
 * meaningful complete and an item with more declared units than that is a data
 * problem rather than a paging problem. The rows are handed to
 * `profileFromRows`, which delegates to `makeItemUomProfile` — so a stored table
 * the kernel would refuse is refused here, rather than surfacing as a wrong
 * conversion at a dock.
 *
 * Only `ACTIVE` alternates are included. A retired unit must stop being offered
 * for capture, and leaving it in the profile would keep it convertible.
 */
export const getItemUomProfile = queryWithOrg({
  args: { itemId: v.id("items") },
  returns: uomProfileValidator,
  permissionCode: "masterData.item.read",
  target: { table: "itemUoms" },
  handler: async (ctx, args) => {
    const item = await ctx.tenantDb.get<ItemDocument>("items", args.itemId);
    if (item === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", received: "items" });
    }

    const rows = await ctx.tenantDb
      .byIndex<ItemUomDocument>("itemUoms", "by_orgId_itemId_status_uom", [
        { field: "itemId", value: args.itemId },
        { field: "status", value: "ACTIVE" },
      ])
      .take(MAX_ITEM_UOM_ROWS);

    const profile = profileFromRows({
      itemKey: item.sku,
      baseUom: item.baseUom,
      rows: rows.map((row) => ({
        uom: row.uom,
        toBaseNumerator: row.toBaseNumerator,
        toBaseDenominator: row.toBaseDenominator,
      })),
    });
    if (!profile.ok) {
      return refusal({ code: profile.error.code });
    }

    return {
      ok: true as const,
      itemId: args.itemId,
      baseUom: profile.value.baseUom,
      alternates: profile.value.alternates.map((conversion) => ({
        uom: conversion.uom,
        toBaseNumerator: conversion.toBase.numerator,
        toBaseDenominator: conversion.toBase.denominator,
      })),
    };
  },
});

/**
 * The most alternate units one item may declare.
 *
 * A profile is only meaningful complete, so this read is a bounded `take`
 * rather than a page. Sixteen is far above any real packaging hierarchy — each,
 * inner, case, layer, pallet is five — and comfortably under the accessor's own
 * cap, so the read can never be refused for being too large.
 */
export const MAX_ITEM_UOM_ROWS = 16;

/* -------------------------------------------------------------------------- */
/* Label templates                                                             */
/* -------------------------------------------------------------------------- */

const labelTemplateValidator = v.object({
  labelTemplateId: v.id("labelTemplates"),
  code: v.string(),
  version: v.number(),
  name: v.string(),
  format: labelTemplateFormat,
  status: labelTemplateStatus,
});

interface LabelTemplateDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly code: string;
  readonly version: number;
  readonly name: string;
  readonly format: string;
  readonly body: string;
  readonly status: LabelTemplateStatus;
}

/**
 * The tenant's label template versions.
 *
 * The **body is not returned.** A list is for choosing a template, and shipping
 * every version's payload to render a table would be an unbounded response for
 * no reader. `getLabelTemplate` returns one version's body when something
 * actually needs it.
 */
export const listLabelTemplates = queryWithOrg({
  args: {
    status: v.optional(labelTemplateStatus),
    maxPageSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: pageOf(labelTemplateValidator),
  permissionCode: "label.template.read",
  target: { table: "labelTemplates" },
  handler: async (ctx, args) => {
    const request = pageRequest(args);
    if (!request.ok) return refusal(request.error);

    const page = await readPage<LabelTemplateDocument>(
      ctx.tenantDb,
      "labelTemplates",
      args.status === undefined
        ? "by_orgId_code_version"
        : "by_orgId_status_code",
      args.status === undefined
        ? []
        : [{ field: "status", value: args.status }],
      request.value,
    );

    return {
      ok: true as const,
      items: page.items.map((row) => ({
        labelTemplateId: row._id as never,
        code: row.code,
        version: row.version,
        name: row.name,
        format: row.format as never,
        status: row.status,
      })),
      nextCursor: page.nextCursor,
      complete: page.complete,
    };
  },
});

const labelTemplateDetailValidator = v.union(
  v.object({
    found: v.literal(true),
    labelTemplateId: v.id("labelTemplates"),
    code: v.string(),
    version: v.number(),
    name: v.string(),
    format: labelTemplateFormat,
    status: labelTemplateStatus,
    /** The payload source. Stored and returned; never rendered or printed here. */
    body: v.string(),
  }),
  v.object({ found: v.literal(false) }),
);

/**
 * One template version, with its payload.
 *
 * The payload is returned as **text**, and nothing in this repository renders,
 * transmits, or prints it. A screen that shows it shows source in a monospaced
 * block, labelled as such. The printer transport is `INT-04` and does not exist;
 * physical print verification is `RG-004` and has not happened.
 */
export const getLabelTemplate = queryWithOrg({
  args: { labelTemplateId: v.id("labelTemplates") },
  returns: labelTemplateDetailValidator,
  permissionCode: "label.template.read",
  target: {
    table: "labelTemplates",
    id: ({ labelTemplateId }) => labelTemplateId,
  },
  handler: async (ctx, args) => {
    const row = await ctx.tenantDb.get<LabelTemplateDocument>(
      "labelTemplates",
      args.labelTemplateId,
    );
    if (row === null) return { found: false as const };

    return {
      found: true as const,
      labelTemplateId: row._id as never,
      code: row.code,
      version: row.version,
      name: row.name,
      format: row.format as never,
      status: row.status,
      body: row.body,
    };
  },
});

/** The page-size cap, re-exported so a client can size its own loop. */
export const maxMasterDataPageSize = MAX_JOB_PAGE_SIZE;
