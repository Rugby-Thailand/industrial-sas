/**
 * Typed references to the master-data read functions, and their wire types.
 *
 * References come from the committed Convex-generated interface. The named row
 * types remain the presentation interface consumed by generic tables and forms.
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
import { api } from "../../../convex/_generated/api";

import { clientRef } from "./clientRef";

export type { ReasonCodeScope } from "../../../convex/lib/validators";

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

export const listItemsRef = clientRef(api.masterData.catalogue.listItems);
export const listLocationsRef = clientRef(
  api.masterData.catalogue.listLocations,
);
export const listReasonCodesRef = clientRef(
  api.masterData.catalogue.listReasonCodes,
);
export const listHandlingUnitsRef = clientRef(
  api.masterData.catalogue.listHandlingUnits,
);

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

/** One item, or `{found:false}` — which is also the answer for another tenant's. */
export type ItemDetail =
  { readonly found: true; readonly item: ItemRow } | { readonly found: false };

export const getItemRef = clientRef(api.masterData.catalogue.getItem);

export const resolveScanToItemRef = clientRef(
  api.masterData.catalogue.resolveScanToItem,
);

/**
 * The locations a receipt line may be posted to.
 *
 * No truncation flag: the read is served by an index whose prefix includes the
 * location type, so rack volume cannot hide a dock and the answer is the whole
 * answer.
 */
export const listReceivingLocationsRef = clientRef(
  api.masterData.catalogue.listReceivingLocations,
);
export const listLotsForItemRef = clientRef(
  api.masterData.catalogue.listLotsForItem,
);
export const listSuppliersRef = clientRef(
  api.masterData.catalogue.listSuppliers,
);
export const listStorageClassesRef = clientRef(
  api.masterData.catalogue.listStorageClasses,
);
export const listBarcodesForItemRef = clientRef(
  api.masterData.catalogue.listBarcodesForItem,
);
export const listItemUomsRef = clientRef(api.masterData.catalogue.listItemUoms);
export const listLabelTemplatesRef = clientRef(
  api.masterData.catalogue.listLabelTemplates,
);

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

export const createItemRef = clientRef(api.masterData.writes.createItem);
export const updateItemRef = clientRef(api.masterData.writes.updateItem);
export const deactivateItemRef = clientRef(
  api.masterData.writes.deactivateItem,
);
export const createLocationRef = clientRef(
  api.masterData.writes.createLocation,
);

/**
 * Locations are warehouse-scoped, and the warehouse travels in the arguments.
 *
 * Not because the client is trusted with it — the wrapper revalidates the
 * membership against the location it is about to touch (`INV-0006-04`) — but
 * because a site-scoped write has to say which site it means, and the answer is
 * the one the shell has selected rather than one derived from the row.
 */
export const updateLocationRef = clientRef(
  api.masterData.writes.updateLocation,
);
export const createLotRef = clientRef(api.masterData.writes.createLot);
export const createSupplierRef = clientRef(
  api.masterData.writes.createSupplier,
);
export const updateSupplierRef = clientRef(
  api.masterData.writes.updateSupplier,
);
export const createStorageClassRef = clientRef(
  api.masterData.writes.createStorageClass,
);
export const updateStorageClassRef = clientRef(
  api.masterData.writes.updateStorageClass,
);
export const createBarcodeRef = clientRef(api.masterData.writes.createBarcode);
export const deactivateBarcodeRef = clientRef(
  api.masterData.writes.deactivateBarcode,
);
export const createItemUomRef = clientRef(api.masterData.writes.createItemUom);
export const draftLabelTemplateRef = clientRef(
  api.masterData.writes.draftLabelTemplate,
);
export const deactivateItemUomRef = clientRef(
  api.masterData.writes.deactivateItemUom,
);

/**
 * Publishing is the repository's one genuine maker-checker control.
 *
 * The drafter cannot publish their own draft — the policy compares the stored
 * `draftedByUserId` against the actor (`INV-0006-05`) — and the client is told
 * only that it was denied, with a request ID. That is deliberate: distinguishing
 * "needs a second person" from "you lack the permission" in the payload would
 * make the screen a permission oracle (`INV-0002-07`).
 */
export const publishLabelTemplateRef = clientRef(
  api.masterData.writes.publishLabelTemplate,
);
