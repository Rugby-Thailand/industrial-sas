import { api } from "../../../convex/_generated/api";

import { clientRef } from "./clientRef";

export type { ReasonCodeScope } from "../../../convex/lib/validators";

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

export type ItemDetail =
  { readonly found: true; readonly item: ItemRow } | { readonly found: false };

export const getItemRef = clientRef(api.masterData.catalogue.getItem);

export const resolveScanToItemRef = clientRef(
  api.masterData.catalogue.resolveScanToItem,
);

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

export const publishLabelTemplateRef = clientRef(
  api.masterData.writes.publishLabelTemplate,
);
