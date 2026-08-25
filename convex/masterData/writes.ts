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

interface ItemDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly sku: string;
  readonly baseUom: string;
  readonly trackingMode: string;
  readonly status: string;
}

const itemUniqueness = (sku: string): readonly UniquenessCheck[] => [
  {
    field: "sku",
    index: "by_orgId_sku",
    equality: [{ field: "sku", value: sku }],
  },
];

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

export const deactivateItem = mutationWithOrg({
  args: { requestId: v.string(), itemId: v.id("items") },
  returns: writeOutcomeValidator,
  permissionCode: "masterData.item.deactivate",
  target: { table: "items", id: ({ itemId }) => itemId },
  policy: async (ctx, args: { readonly itemId: string }) => {
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

const codeUniqueness = (code: string): readonly UniquenessCheck[] => [
  {
    field: "code",
    index: "by_orgId_code",
    equality: [{ field: "code", value: code }],
  },
];

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

interface LabelTemplateRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly code: string;
  readonly version: number;
  readonly status: string;
  readonly draftedByUserId: string;
}

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

export const MAX_TEMPLATE_VERSIONS = 50;

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
