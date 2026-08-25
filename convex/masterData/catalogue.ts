import { v } from "convex/values";

import { resolveItemScan } from "../lib/itemScanResolution";
import {
  listArgs,
  pageOf,
  pageOptions,
  pageRequestOf,
} from "../lib/listEnvelope";
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
  type JobPageRequest,
} from "../model/inventory/jobPage";
import {
  profileFromRows,
  validateBarcodeAlias,
} from "../model/masterData/catalogueRules";

const masterDataListArgs = {
  status: v.optional(masterDataStatus),
  ...listArgs,
};

const listErrorValidator = v.object({
  code: v.string(),
  received: v.optional(v.string()),
  requested: v.optional(v.number()),
  limit: v.optional(v.number()),
  length: v.optional(v.number()),
});

const refusal = (error: Record<string, unknown>) => ({
  ok: false as const,
  error: { ...error } as { code: string },
});

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
  const page = await tenantDb
    .byIndex<Document>(table, index, equality)
    .page(pageOptions(request));

  return {
    items: page.page,
    nextCursor: page.isDone ? null : page.continueCursor,
    complete: page.isDone,
  };
}

const statusTerms = (
  status: MasterDataStatus | undefined,
  extra: readonly { readonly field: string; readonly value: unknown }[] = [],
) =>
  status === undefined ? extra : [...extra, { field: "status", value: status }];

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

export const listItems = queryWithOrg({
  args: masterDataListArgs,
  returns: pageOf(itemValidator, listErrorValidator),
  permissionCode: "masterData.item.read",
  target: { table: "items" },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
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

export const listWarehouses = queryWithOrg({
  args: listArgs,
  returns: pageOf(warehouseValidator, listErrorValidator),
  permissionCode: "masterData.warehouse.read",
  target: { table: "warehouses" },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
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

export const listLocations = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), ...masterDataListArgs },
  returns: pageOf(locationValidator, listErrorValidator),
  permissionCode: "masterData.location.read",
  target: { table: "locations" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
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

export const RECEIVING_LOCATION_TYPES: readonly string[] = Object.freeze([
  "DOCK",
  "STAGING",
]);

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

export const listLotsForItem = queryWithOrg({
  args: { itemId: v.id("items"), ...masterDataListArgs },
  returns: pageOf(lotValidator, listErrorValidator),
  permissionCode: "masterData.lot.read",
  target: { table: "lots" },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return refusal(request.error);

    const item = await ctx.tenantDb.get<ItemDocument>("items", args.itemId);
    if (item === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", received: "items" });
    }

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

export const listHandlingUnits = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    ...masterDataListArgs,
  },
  returns: pageOf(handlingUnitValidator, listErrorValidator),
  permissionCode: "handlingUnit.read",
  target: { table: "handlingUnits" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return refusal(request.error);

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

export const listReasonCodes = queryWithOrg({
  args: {
    scope: v.optional(reasonCodeScope),
    ...listArgs,
  },
  returns: pageOf(reasonCodeValidator, listErrorValidator),
  permissionCode: "masterData.reasonCode.read",
  target: { table: "reasonCodes" },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
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

export const listOwners = queryWithOrg({
  args: listArgs,
  returns: pageOf(ownerValidator, listErrorValidator),
  permissionCode: "masterData.owner.read",
  target: { table: "owners" },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
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

export const listSuppliers = queryWithOrg({
  args: masterDataListArgs,
  returns: pageOf(supplierValidator, listErrorValidator),
  permissionCode: "masterData.supplier.read",
  target: { table: "suppliers" },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
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

export const listStorageClasses = queryWithOrg({
  args: masterDataListArgs,
  returns: pageOf(storageClassValidator, listErrorValidator),
  permissionCode: "masterData.storageClass.read",
  target: { table: "storageClasses" },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
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

export const listBarcodesForItem = queryWithOrg({
  args: { itemId: v.id("items"), ...masterDataListArgs },
  returns: pageOf(barcodeValidator, listErrorValidator),
  permissionCode: "masterData.item.read",
  target: { table: "itemBarcodes" },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return refusal(request.error);

    const item = await ctx.tenantDb.get<ItemDocument>("items", args.itemId);
    if (item === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", received: "items" });
    }

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

    via: v.union(v.literal("BARCODE"), v.literal("SKU")),
  }),
  v.object({ found: v.literal(false), reason: v.string() }),
);

export const resolveScanToItem = queryWithOrg({
  args: { scan: v.string() },
  returns: scanResolutionValidator,
  permissionCode: "masterData.item.read",
  target: { table: "items" },
  handler: async (ctx, args) => {
    const resolved = await resolveItemScan(ctx.tenantDb, args.scan);
    if (!resolved.found)
      return { found: false as const, reason: resolved.reason };
    return {
      found: true as const,
      itemId: resolved.itemId as never,
      sku: resolved.sku,
      name: resolved.name,
      via: resolved.via,
    };
  },
});

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

export const listItemUoms = queryWithOrg({
  args: { itemId: v.id("items"), ...masterDataListArgs },
  returns: pageOf(itemUomValidator, listErrorValidator),
  permissionCode: "masterData.item.read",
  target: { table: "itemUoms" },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
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

export const MAX_ITEM_UOM_ROWS = 16;

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

export const listLabelTemplates = queryWithOrg({
  args: {
    status: v.optional(labelTemplateStatus),
    ...listArgs,
  },
  returns: pageOf(labelTemplateValidator, listErrorValidator),
  permissionCode: "label.template.read",
  target: { table: "labelTemplates" },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
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

    body: v.string(),
  }),
  v.object({ found: v.literal(false) }),
);

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

export const maxMasterDataPageSize = MAX_JOB_PAGE_SIZE;
