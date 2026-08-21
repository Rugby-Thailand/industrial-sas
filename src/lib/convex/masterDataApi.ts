/**
 * Typed references to the master-data read functions, and their wire types.
 *
 * The same reasoning as `ledgerApi.ts`: `convex/_generated/` is a git-ignored
 * artifact of `convex dev`, absent in CI and on any machine that has not
 * provisioned a deployment, so the browser names server functions through
 * `makeFunctionReference` and a drift test re-reads the server module to prove
 * the names still resolve.
 *
 * Reads and writes are both declared. A write reference carries a `requestId`
 * in its argument type rather than as an afterthought: the key is what makes a
 * retry a replay instead of a duplicate row, so a caller that could forget it
 * would be a caller that could double-write.
 *
 * Only the writes that have a caller are declared. A reference with no UI is a
 * reference nothing type-checks against, which is how a rename survives a build
 * and fails in a warehouse instead.
 */
import { makeFunctionReference } from "convex/server";

import type { TenantOutcome } from "./ledgerApi";

/** A refusal from a master-data list. Narrower than the ledger's. */
export interface MasterDataErrorPayload {
  readonly code: string;
  readonly received?: string;
  readonly requested?: number;
  readonly limit?: number;
  readonly length?: number;
}

export type MasterDataPage<Row> =
  | {
      readonly ok: true;
      readonly items: readonly Row[];
      readonly nextCursor: string | null;
      readonly complete: boolean;
    }
  | { readonly ok: false; readonly error: MasterDataErrorPayload };

export type MasterDataStatus = "ACTIVE" | "INACTIVE";

export interface ItemRow {
  readonly itemId: string;
  readonly sku: string;
  readonly name: string;
  readonly baseUom: string;
  readonly trackingMode: "NONE" | "LOT" | "LOT_SERIAL";
  readonly status: MasterDataStatus;
}

export interface LocationRow {
  readonly locationId: string;
  readonly warehouseId: string;
  readonly code: string;
  readonly locationType: string;
  readonly status: MasterDataStatus;
}

export interface HandlingUnitRow {
  readonly handlingUnitId: string;
  readonly warehouseId: string;
  readonly lpn: string;
  readonly currentLocationId?: string;
  readonly widthMm?: number;
  readonly depthMm?: number;
  readonly heightMm?: number;
  readonly status: MasterDataStatus;
}

export interface ReasonCodeRow {
  readonly reasonCodeId: string;
  readonly code: string;
  readonly name: string;
  readonly scope: string;
  readonly status: MasterDataStatus;
}

export type MasterDataListArgs = {
  readonly status?: MasterDataStatus;
  readonly maxPageSize?: number;
  readonly cursor?: string;
};

export type WarehouseScopedListArgs = MasterDataListArgs & {
  readonly warehouseId: string;
};

export const MASTER_DATA_FUNCTION_PATHS = Object.freeze({
  listItems: "masterData/catalogue:listItems",
  listLocations: "masterData/catalogue:listLocations",
  listReasonCodes: "masterData/catalogue:listReasonCodes",
  listHandlingUnits: "masterData/catalogue:listHandlingUnits",
});

export const listItemsRef = makeFunctionReference<
  "query",
  MasterDataListArgs,
  TenantOutcome<MasterDataPage<ItemRow>>
>(MASTER_DATA_FUNCTION_PATHS.listItems);

export const listLocationsRef = makeFunctionReference<
  "query",
  WarehouseScopedListArgs,
  TenantOutcome<MasterDataPage<LocationRow>>
>(MASTER_DATA_FUNCTION_PATHS.listLocations);

export const listReasonCodesRef = makeFunctionReference<
  "query",
  {
    readonly scope?: string;
    readonly maxPageSize?: number;
    readonly cursor?: string;
  },
  TenantOutcome<MasterDataPage<ReasonCodeRow>>
>(MASTER_DATA_FUNCTION_PATHS.listReasonCodes);

export const listHandlingUnitsRef = makeFunctionReference<
  "query",
  WarehouseScopedListArgs,
  TenantOutcome<MasterDataPage<HandlingUnitRow>>
>(MASTER_DATA_FUNCTION_PATHS.listHandlingUnits);

/* -------------------------------------------------------------------------- */
/* The five Phase 2 entities                                                   */
/* -------------------------------------------------------------------------- */

export interface SupplierRow {
  readonly supplierId: string;
  readonly code: string;
  readonly name: string;
  readonly status: MasterDataStatus;
}

export interface StorageClassRow {
  readonly storageClassId: string;
  readonly code: string;
  readonly name: string;
  readonly status: MasterDataStatus;
}

export type BarcodeKind = "GTIN" | "SSCC" | "INTERNAL" | "SUPPLIER";

export interface BarcodeRow {
  readonly barcodeId: string;
  readonly itemId: string;
  readonly barcode: string;
  readonly kind: BarcodeKind;
  readonly status: MasterDataStatus;
}

export interface ItemUomRow {
  readonly itemUomId: string;
  readonly itemId: string;
  readonly uom: string;
  readonly toBaseNumerator: number;
  readonly toBaseDenominator: number;
  readonly status: MasterDataStatus;
}

export type LabelTemplateFormat = "ZPL" | "PDF";
export type LabelTemplateStatus = "DRAFT" | "ACTIVE" | "RETIRED";

export interface LabelTemplateRow {
  readonly labelTemplateId: string;
  readonly code: string;
  readonly version: number;
  readonly name: string;
  readonly format: LabelTemplateFormat;
  readonly status: LabelTemplateStatus;
}

export interface LotRow {
  readonly lotId: string;
  readonly itemId: string;
  readonly lotCode: string;
  readonly manufactureDate?: string;
  readonly expirationDate?: string;
  readonly bestBeforeDate?: string;
  readonly status: MasterDataStatus;
}

export type ItemScopedListArgs = MasterDataListArgs & {
  readonly itemId: string;
};

export const ENTITY_FUNCTION_PATHS = Object.freeze({
  getItem: "masterData/catalogue:getItem",
  resolveScanToItem: "masterData/catalogue:resolveScanToItem",
  listReceivingLocations: "masterData/catalogue:listReceivingLocations",
  listLotsForItem: "masterData/catalogue:listLotsForItem",
  listSuppliers: "masterData/catalogue:listSuppliers",
  listStorageClasses: "masterData/catalogue:listStorageClasses",
  listBarcodesForItem: "masterData/catalogue:listBarcodesForItem",
  listItemUoms: "masterData/catalogue:listItemUoms",
  listLabelTemplates: "masterData/catalogue:listLabelTemplates",
});

/** One item, or `{found:false}` — which is also the answer for another tenant's. */
export type ItemDetail =
  { readonly found: true; readonly item: ItemRow } | { readonly found: false };

export const getItemRef = makeFunctionReference<
  "query",
  { readonly itemId: string },
  TenantOutcome<ItemDetail>
>(ENTITY_FUNCTION_PATHS.getItem);

/**
 * What a scanned or typed string turned out to name.
 *
 * One miss for every reason it could miss (`INV-0002-03`): an unregistered
 * barcode, a withdrawn one, a deactivated item, and another tenant's label are
 * indistinguishable here, because they are the same instruction to an operator.
 */
export type ScanResolution =
  | {
      readonly found: true;
      readonly itemId: string;
      readonly sku: string;
      readonly name: string;
      readonly via: "BARCODE" | "SKU";
    }
  | { readonly found: false; readonly reason: string };

export const resolveScanToItemRef = makeFunctionReference<
  "query",
  { readonly scan: string },
  TenantOutcome<ScanResolution>
>(ENTITY_FUNCTION_PATHS.resolveScanToItem);

/**
 * The locations a receipt line may be posted to.
 *
 * No truncation flag: the read is served by an index whose prefix includes the
 * location type, so rack volume cannot hide a dock and the answer is the whole
 * answer.
 */
export type ReceivingLocationsOutcome =
  | { readonly ok: true; readonly items: readonly LocationRow[] }
  | { readonly ok: false; readonly error: MasterDataErrorPayload };

export const listReceivingLocationsRef = makeFunctionReference<
  "query",
  { readonly warehouseId: string },
  TenantOutcome<ReceivingLocationsOutcome>
>(ENTITY_FUNCTION_PATHS.listReceivingLocations);

export const listLotsForItemRef = makeFunctionReference<
  "query",
  ItemScopedListArgs,
  TenantOutcome<MasterDataPage<LotRow>>
>(ENTITY_FUNCTION_PATHS.listLotsForItem);

export const listSuppliersRef = makeFunctionReference<
  "query",
  MasterDataListArgs,
  TenantOutcome<MasterDataPage<SupplierRow>>
>(ENTITY_FUNCTION_PATHS.listSuppliers);

export const listStorageClassesRef = makeFunctionReference<
  "query",
  MasterDataListArgs,
  TenantOutcome<MasterDataPage<StorageClassRow>>
>(ENTITY_FUNCTION_PATHS.listStorageClasses);

export const listBarcodesForItemRef = makeFunctionReference<
  "query",
  ItemScopedListArgs,
  TenantOutcome<MasterDataPage<BarcodeRow>>
>(ENTITY_FUNCTION_PATHS.listBarcodesForItem);

export const listItemUomsRef = makeFunctionReference<
  "query",
  ItemScopedListArgs,
  TenantOutcome<MasterDataPage<ItemUomRow>>
>(ENTITY_FUNCTION_PATHS.listItemUoms);

export const listLabelTemplatesRef = makeFunctionReference<
  "query",
  {
    readonly status?: LabelTemplateStatus;
    readonly maxPageSize?: number;
    readonly cursor?: string;
  },
  TenantOutcome<MasterDataPage<LabelTemplateRow>>
>(ENTITY_FUNCTION_PATHS.listLabelTemplates);

/* -------------------------------------------------------------------------- */
/* Write references                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What every master-data mutation answers.
 *
 * `written: false` carries a **field name** and a reason code, never the value
 * that was refused: the server declines to say which SKU collided, and the
 * client must not invent it either.
 */
export type MasterDataWriteOutcome =
  | {
      readonly written: true;
      readonly documentId: string;
      readonly replayed: boolean;
    }
  | {
      readonly written: false;
      readonly error: {
        readonly code: string;
        readonly field?: string;
        readonly reason?: string;
        readonly table?: string;
        readonly requestId?: string;
      };
    };

export const WRITE_FUNCTION_PATHS = Object.freeze({
  createItem: "masterData/writes:createItem",
  updateItem: "masterData/writes:updateItem",
  deactivateItem: "masterData/writes:deactivateItem",
  createLocation: "masterData/writes:createLocation",
  updateLocation: "masterData/writes:updateLocation",
  createLot: "masterData/writes:createLot",
  createSupplier: "masterData/writes:createSupplier",
  updateSupplier: "masterData/writes:updateSupplier",
  createStorageClass: "masterData/writes:createStorageClass",
  updateStorageClass: "masterData/writes:updateStorageClass",
  createBarcode: "masterData/writes:createBarcode",
  deactivateBarcode: "masterData/writes:deactivateBarcode",
  createItemUom: "masterData/writes:createItemUom",
  deactivateItemUom: "masterData/writes:deactivateItemUom",
  draftLabelTemplate: "masterData/writes:draftLabelTemplate",
  publishLabelTemplate: "masterData/writes:publishLabelTemplate",
});

const writeRef = <Args extends Record<string, unknown>>(path: string) =>
  makeFunctionReference<
    "mutation",
    Args,
    TenantOutcome<MasterDataWriteOutcome>
  >(path);

export const createItemRef = writeRef<{
  requestId: string;
  sku: string;
  name: string;
  baseUom: string;
  trackingMode: "NONE" | "LOT" | "LOT_SERIAL";
}>(WRITE_FUNCTION_PATHS.createItem);

export const updateItemRef = writeRef<{
  requestId: string;
  itemId: string;
  name?: string;
  trackingMode?: "NONE" | "LOT" | "LOT_SERIAL";
}>(WRITE_FUNCTION_PATHS.updateItem);

export const deactivateItemRef = writeRef<{
  requestId: string;
  itemId: string;
}>(WRITE_FUNCTION_PATHS.deactivateItem);

export const createLocationRef = writeRef<{
  requestId: string;
  warehouseId: string;
  code: string;
  locationType: string;
}>(WRITE_FUNCTION_PATHS.createLocation);

/**
 * Locations are warehouse-scoped, and the warehouse travels in the arguments.
 *
 * Not because the client is trusted with it — the wrapper revalidates the
 * membership against the location it is about to touch (`INV-0006-04`) — but
 * because a site-scoped write has to say which site it means, and the answer is
 * the one the shell has selected rather than one derived from the row.
 */
export const updateLocationRef = writeRef<{
  requestId: string;
  warehouseId: string;
  locationId: string;
  locationType?: string;
  status?: MasterDataStatus;
}>(WRITE_FUNCTION_PATHS.updateLocation);

export const createLotRef = writeRef<{
  requestId: string;
  itemId: string;
  lotCode: string;
  expirationDate?: string;
}>(WRITE_FUNCTION_PATHS.createLot);

export const createSupplierRef = writeRef<{
  requestId: string;
  code: string;
  name: string;
}>(WRITE_FUNCTION_PATHS.createSupplier);

export const updateSupplierRef = writeRef<{
  requestId: string;
  supplierId: string;
  name?: string;
  status?: MasterDataStatus;
}>(WRITE_FUNCTION_PATHS.updateSupplier);

export const createStorageClassRef = writeRef<{
  requestId: string;
  code: string;
  name: string;
}>(WRITE_FUNCTION_PATHS.createStorageClass);

export const updateStorageClassRef = writeRef<{
  requestId: string;
  storageClassId: string;
  name?: string;
  status?: MasterDataStatus;
}>(WRITE_FUNCTION_PATHS.updateStorageClass);

export const createBarcodeRef = writeRef<{
  requestId: string;
  itemId: string;
  barcode: string;
  kind: BarcodeKind;
}>(WRITE_FUNCTION_PATHS.createBarcode);

export const deactivateBarcodeRef = writeRef<{
  requestId: string;
  barcodeId: string;
}>(WRITE_FUNCTION_PATHS.deactivateBarcode);

export const createItemUomRef = writeRef<{
  requestId: string;
  itemId: string;
  uom: string;
  toBaseNumerator: number;
  toBaseDenominator: number;
}>(WRITE_FUNCTION_PATHS.createItemUom);

export const draftLabelTemplateRef = writeRef<{
  requestId: string;
  code: string;
  name: string;
  format: LabelTemplateFormat;
  body: string;
}>(WRITE_FUNCTION_PATHS.draftLabelTemplate);

export const deactivateItemUomRef = writeRef<{
  requestId: string;
  itemUomId: string;
}>(WRITE_FUNCTION_PATHS.deactivateItemUom);

/**
 * Publishing is the repository's one genuine maker-checker control.
 *
 * The drafter cannot publish their own draft — the policy compares the stored
 * `draftedByUserId` against the actor (`INV-0006-05`) — and the client is told
 * only that it was denied, with a request ID. That is deliberate: distinguishing
 * "needs a second person" from "you lack the permission" in the payload would
 * make the screen a permission oracle (`INV-0002-07`).
 */
export const publishLabelTemplateRef = writeRef<{
  requestId: string;
  labelTemplateId: string;
}>(WRITE_FUNCTION_PATHS.publishLabelTemplate);
