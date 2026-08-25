import type {
  BarcodeRow,
  ItemRow,
  ItemUomRow,
  LabelTemplateRow,
  LocationRow,
  LotRow,
  MasterDataPage,
  ReasonCodeRow,
  StorageClassRow,
  SupplierRow,
} from "@/lib/convex/masterDataApi";

import { previewPage } from "./ledger";

export const PREVIEW_ITEMS: readonly ItemRow[] = Object.freeze([
  Object.freeze({
    itemId: "prv_item_bolt_m8",
    sku: "BOLT-M8-30",
    name: "สลักเกลียว M8 x 30 มม.",
    baseUom: "EA",
    trackingMode: "LOT" as const,
    status: "ACTIVE" as const,
  }),
  Object.freeze({
    itemId: "prv_item_carton_a",
    sku: "CTN-A4",
    name: "กล่องกระดาษลูกฟูก A4",
    baseUom: "EA",
    trackingMode: "NONE" as const,
    status: "ACTIVE" as const,
  }),
  Object.freeze({
    itemId: "prv_item_module_x",
    sku: "MOD-X1",
    name: "โมดูลควบคุม X1",
    baseUom: "EA",
    trackingMode: "LOT" as const,
    status: "ACTIVE" as const,
  }),
  Object.freeze({
    itemId: "prv_item_resin_hd",
    sku: "RESIN-HD",
    name: "เรซินความหนาแน่นสูง",
    baseUom: "L",
    trackingMode: "LOT" as const,
    status: "ACTIVE" as const,
  }),
  Object.freeze({
    itemId: "prv_item_steel_coil",
    sku: "STEEL-COIL",
    name: "เหล็กม้วนรีดร้อน",
    baseUom: "KG",
    trackingMode: "LOT" as const,
    status: "ACTIVE" as const,
  }),

  Object.freeze({
    itemId: "prv_item_retired_gasket",
    sku: "GASKET-OLD",
    name: "ปะเก็นรุ่นเก่า (เลิกใช้)",
    baseUom: "EA",
    trackingMode: "LOT" as const,
    status: "INACTIVE" as const,
  }),
]);

interface PlacedLocation {
  readonly warehouseId: string;
  readonly row: LocationRow;
}

const PLACED_LOCATIONS: readonly PlacedLocation[] = Object.freeze([
  ...[
    { code: "A01-02-1", type: "RACK_BIN" },
    { code: "B04-11-3", type: "RACK_BIN" },
    { code: "C02-01-2", type: "RACK_BIN" },
    { code: "D01-01-1", type: "FLOOR_BLOCK" },
    { code: "DOCK-IN-1", type: "DOCK" },
  ].map((seed) =>
    Object.freeze({
      warehouseId: "prv_wh_bangpoo",
      row: Object.freeze({
        locationId: `prv_loc_${seed.code}`,
        warehouseId: "prv_wh_bangpoo",
        code: seed.code,
        locationType: seed.type,
        status: "ACTIVE" as const,
      }),
    }),
  ),
  ...[
    { code: "F01-03-2", type: "RACK_BIN" },
    { code: "STAGE-OUT", type: "STAGING" },
  ].map((seed) =>
    Object.freeze({
      warehouseId: "prv_wh_lamphun",
      row: Object.freeze({
        locationId: `prv_loc_${seed.code}`,
        warehouseId: "prv_wh_lamphun",
        code: seed.code,
        locationType: seed.type,
        status: "ACTIVE" as const,
      }),
    }),
  ),
]);

export const PREVIEW_LOCATIONS: readonly LocationRow[] = Object.freeze(
  PLACED_LOCATIONS.map((placed) => placed.row),
);

export const PREVIEW_REASON_CODES: readonly ReasonCodeRow[] = Object.freeze([
  Object.freeze({
    reasonCodeId: "prv_reason_cycle_count",
    code: "CYCLE-COUNT",
    name: "ปรับปรุงจากการนับสต็อก",
    scope: "ADJUSTMENT",
    status: "ACTIVE" as const,
  }),
  Object.freeze({
    reasonCodeId: "prv_reason_damage",
    code: "DAMAGE",
    name: "เสียหายระหว่างขนย้าย",
    scope: "SCRAP",
    status: "ACTIVE" as const,
  }),
  Object.freeze({
    reasonCodeId: "prv_reason_data_entry",
    code: "DATA-ENTRY",
    name: "แก้ไขข้อมูลที่บันทึกผิด",
    scope: "REVERSAL",
    status: "ACTIVE" as const,
  }),

  Object.freeze({
    reasonCodeId: "prv_reason_qc_release",
    code: "QC-RELEASE",
    name: "ปล่อยผ่านหลังตรวจสอบคุณภาพ",
    scope: "STATUS_CHANGE",
    status: "ACTIVE" as const,
  }),
]);

export const previewItems = (): readonly ItemRow[] => PREVIEW_ITEMS;

export const previewLocationsFor = (
  warehouseId: string,
): readonly LocationRow[] =>
  PLACED_LOCATIONS.filter((placed) => placed.warehouseId === warehouseId).map(
    (placed) => placed.row,
  );

export const previewReasonCodes = (): readonly ReasonCodeRow[] =>
  PREVIEW_REASON_CODES;

export const PREVIEW_SUPPLIERS: readonly SupplierRow[] = Object.freeze([
  Object.freeze({
    supplierId: "prv_sup_siam_steel",
    code: "SIAM-STEEL",
    name: "สยามสตีล อุตสาหกรรม",
    status: "ACTIVE" as const,
  }),
  Object.freeze({
    supplierId: "prv_sup_thai_poly",
    code: "THAI-POLY",
    name: "ไทยโพลิเมอร์ เทรดดิ้ง",
    status: "ACTIVE" as const,
  }),
  Object.freeze({
    supplierId: "prv_sup_nikom_pack",
    code: "NIKOM-PACK",
    name: "นิคมบรรจุภัณฑ์",
    status: "ACTIVE" as const,
  }),
  // A deactivated supplier, because "no longer bought from" is a state a buyer
  // must be able to tell apart from "never existed".
  Object.freeze({
    supplierId: "prv_sup_old_fastener",
    code: "OLD-FASTENER",
    name: "โรงงานสลักเกลียวเดิม (เลิกใช้)",
    status: "INACTIVE" as const,
  }),
]);

export const PREVIEW_STORAGE_CLASSES: readonly StorageClassRow[] =
  Object.freeze([
    Object.freeze({
      storageClassId: "prv_sc_ambient",
      code: "AMBIENT",
      name: "อุณหภูมิห้อง",
      status: "ACTIVE" as const,
    }),
    Object.freeze({
      storageClassId: "prv_sc_flammable",
      code: "FLAMMABLE",
      name: "วัตถุไวไฟ",
      status: "ACTIVE" as const,
    }),
    Object.freeze({
      storageClassId: "prv_sc_heavy",
      code: "HEAVY-RACK",
      name: "ชั้นวางรับน้ำหนักสูง",
      status: "ACTIVE" as const,
    }),
  ]);

interface ItemScoped<Row> {
  readonly itemId: string;
  readonly row: Row;
}

const PREVIEW_BARCODE_ROWS: readonly ItemScoped<BarcodeRow>[] = Object.freeze([
  Object.freeze({
    itemId: "prv_item_bolt_m8",
    row: Object.freeze({
      barcodeId: "prv_bc_bolt_gtin",
      itemId: "prv_item_bolt_m8",
      barcode: "00614141000036",
      kind: "GTIN" as const,
      status: "ACTIVE" as const,
    }),
  }),
  Object.freeze({
    itemId: "prv_item_bolt_m8",
    row: Object.freeze({
      barcodeId: "prv_bc_bolt_supplier",
      itemId: "prv_item_bolt_m8",
      barcode: "SIAM-B8-30",
      kind: "SUPPLIER" as const,
      status: "ACTIVE" as const,
    }),
  }),
  Object.freeze({
    itemId: "prv_item_bolt_m8",
    row: Object.freeze({
      barcodeId: "prv_bc_bolt_retired",
      itemId: "prv_item_bolt_m8",
      barcode: "OLD-B8",
      kind: "INTERNAL" as const,
      status: "INACTIVE" as const,
    }),
  }),
  Object.freeze({
    itemId: "prv_item_steel_coil",
    row: Object.freeze({
      barcodeId: "prv_bc_coil_internal",
      itemId: "prv_item_steel_coil",
      barcode: "COIL-HR-01",
      kind: "INTERNAL" as const,
      status: "ACTIVE" as const,
    }),
  }),
]);

const PREVIEW_ITEM_UOM_ROWS: readonly ItemScoped<ItemUomRow>[] = Object.freeze([
  Object.freeze({
    itemId: "prv_item_bolt_m8",
    row: Object.freeze({
      itemUomId: "prv_uom_bolt_case",
      itemId: "prv_item_bolt_m8",
      uom: "CASE",
      toBaseNumerator: 12,
      toBaseDenominator: 1,
      status: "ACTIVE" as const,
    }),
  }),
  Object.freeze({
    itemId: "prv_item_bolt_m8",
    row: Object.freeze({
      itemUomId: "prv_uom_bolt_pallet",
      itemId: "prv_item_bolt_m8",
      uom: "PALLET",
      toBaseNumerator: 960,
      toBaseDenominator: 1,
      status: "ACTIVE" as const,
    }),
  }),

  Object.freeze({
    itemId: "prv_item_resin_hd",
    row: Object.freeze({
      itemUomId: "prv_uom_resin_third",
      itemId: "prv_item_resin_hd",
      uom: "THIRD-DRUM",
      toBaseNumerator: 200,
      toBaseDenominator: 3,
      status: "ACTIVE" as const,
    }),
  }),
]);

const PREVIEW_LOT_ROWS: readonly ItemScoped<LotRow>[] = Object.freeze([
  Object.freeze({
    itemId: "prv_item_bolt_m8",
    row: Object.freeze({
      lotId: "prv_lot_bolt_2601",
      itemId: "prv_item_bolt_m8",
      lotCode: "L2601-A",
      manufactureDate: "2026-01-14",
      status: "ACTIVE" as const,
    }),
  }),
  Object.freeze({
    itemId: "prv_item_resin_hd",
    row: Object.freeze({
      lotId: "prv_lot_resin_2603",
      itemId: "prv_item_resin_hd",
      lotCode: "R2603-B",
      manufactureDate: "2026-03-02",
      expirationDate: "2026-09-02",
      status: "ACTIVE" as const,
    }),
  }),
  Object.freeze({
    itemId: "prv_item_resin_hd",
    row: Object.freeze({
      lotId: "prv_lot_resin_2512",
      itemId: "prv_item_resin_hd",
      lotCode: "R2512-A",
      manufactureDate: "2025-12-08",
      expirationDate: "2026-06-08",
      status: "ACTIVE" as const,
    }),
  }),
]);

export const PREVIEW_LABEL_TEMPLATES: readonly LabelTemplateRow[] =
  Object.freeze([
    Object.freeze({
      labelTemplateId: "prv_tpl_lpn_v2",
      code: "LPN-4X6",
      version: 2,
      name: "ป้ายพาเลท 4x6 นิ้ว",
      format: "ZPL" as const,
      status: "ACTIVE" as const,
    }),
    Object.freeze({
      labelTemplateId: "prv_tpl_lpn_v1",
      code: "LPN-4X6",
      version: 1,
      name: "ป้ายพาเลท 4x6 นิ้ว (รุ่นเดิม)",
      format: "ZPL" as const,
      status: "RETIRED" as const,
    }),
    Object.freeze({
      labelTemplateId: "prv_tpl_lot_v1",
      code: "LOT-2X1",
      version: 1,
      name: "ป้ายล็อต 2x1 นิ้ว",
      format: "ZPL" as const,
      status: "DRAFT" as const,
    }),
  ]);

export const previewSuppliers = (): readonly SupplierRow[] => PREVIEW_SUPPLIERS;

export const previewStorageClasses = (): readonly StorageClassRow[] =>
  PREVIEW_STORAGE_CLASSES;

export const previewLabelTemplates = (): readonly LabelTemplateRow[] =>
  PREVIEW_LABEL_TEMPLATES;

const scopedTo = <Row>(
  rows: readonly ItemScoped<Row>[],
  itemId: string,
): readonly Row[] =>
  rows.filter((entry) => entry.itemId === itemId).map((entry) => entry.row);

export const previewBarcodesFor = (itemId: string): readonly BarcodeRow[] =>
  scopedTo(PREVIEW_BARCODE_ROWS, itemId);

export const previewResolveScan = (
  scan: string,
): { readonly itemId: string; readonly sku: string } | undefined => {
  const value = scan.trim().toUpperCase();
  if (value === "") return undefined;

  const barcode = PREVIEW_BARCODE_ROWS.find(
    (placed) => placed.row.barcode === value && placed.row.status === "ACTIVE",
  );
  const itemId =
    barcode?.row.itemId ??
    PREVIEW_ITEMS.find((item) => item.sku.toUpperCase() === value)?.itemId;
  if (itemId === undefined) return undefined;

  const item = PREVIEW_ITEMS.find((row) => row.itemId === itemId);
  return item === undefined || item.status !== "ACTIVE"
    ? undefined
    : { itemId: item.itemId, sku: item.sku };
};

export const previewItemUomsFor = (itemId: string): readonly ItemUomRow[] =>
  scopedTo(PREVIEW_ITEM_UOM_ROWS, itemId);

export const previewLotsFor = (itemId: string): readonly LotRow[] =>
  scopedTo(PREVIEW_LOT_ROWS, itemId);

export const previewItemById = (itemId: string): ItemRow | undefined =>
  PREVIEW_ITEMS.find((item) => item.itemId === itemId);

export const previewMasterDataPage = <Row>(
  rows: readonly Row[],
  maxPageSize: number,
  cursor: string | undefined,
): MasterDataPage<Row> => previewPage(rows, maxPageSize, cursor);
