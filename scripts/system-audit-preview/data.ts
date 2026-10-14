import type {
  StorageZoneRow,
  StorageBuildingRow,
  StorageFloorRow,
} from "@/lib/convex/storageLayoutApi";
export const params = new URLSearchParams(location.search);
export const locale = params.get("locale") === "th" ? "th" : "en";
export const distinct = params.get("identity") === "distinct";
export const occupied = params.get("inventory") === "occupied";
export const zone: StorageZoneRow = {
  zoneId: "audit-zone",
  locationId: "audit-location",
  code: "DEMO-F02-Z01",
  label: distinct ? "Demo finished goods" : "DEMO-F02-Z01",
  qrValue: "DEMO:LOCATION:1:audit-location",
  mode: params.has("positions") ? "FLOOR_POSITIONS" : "SIMPLE",
  revision: "1:100",
  xMm: 1000,
  yMm: 1000,
  widthMm: 4000,
  depthMm: 4000,
  maxStackHeightMm: 3000,
  positions: params.has("positions")
    ? [
        {
          positionId: "audit-position-1",
          locationId: "audit-exact-1",
          code: "DEMO-POS1",
          label: "DEMO-POS1",
          qrValue: "DEMO:POSITION:1",
          kind: "FLOOR",
          isDefault: false,
          breadcrumb: "",
          placements: [],
        },
        {
          positionId: "audit-position-2",
          locationId: "audit-exact-2",
          code: "DEMO-POS2",
          label: "Demo bay 2",
          qrValue: "DEMO:POSITION:2",
          kind: "FLOOR",
          isDefault: false,
          breadcrumb: "",
          placements: [],
        },
      ]
    : [],
  placements: occupied
    ? [
        {
          placementId: "audit-placement",
          handlingUnitId: "audit-pallet",
          lpn: "DEMO-P001",
          status: "STORED",
          levelIndex: 1,
          widthMm: 1000,
          depthMm: 1000,
          heightMm: 1000,
          orientation: "DEFAULT",
          xMm: 0,
          yMm: 0,
          zMm: 0,
          placedAt: 1,
          productName: "Demo product",
        },
      ]
    : [],
};
export const building: StorageBuildingRow = {
  buildingId: "audit-building",
  warehouseId: "audit-warehouse",
  code: "DEMO",
  name: "Demo warehouse",
  widthMm: 12000,
  depthMm: 10000,
  defaultFloorHeightMm: 3500,
  floorCount: 2,
  totalHeightMm: 7000,
  grossAreaSqMm: 240000000,
  reservedAreaSqMm: 0,
  usableAreaSqMm: 240000000,
  status: "ACTIVE",
  version: 1,
};
export const floors: StorageFloorRow[] = [1, 2].map((floorNumber) => ({
  floorId: `audit-floor-${floorNumber}`,
  floorNumber,
  widthMm: 12000,
  depthMm: 10000,
  heightMm: 3500,
  grossAreaSqMm: 120000000,
  reservedAreaSqMm: 0,
  usableAreaSqMm: 120000000,
  version: 1,
  storageZones: floorNumber === 2 ? [zone] : [],
  reservedBlocks: [],
}));
export const catalogueRow = {
  warehouseId: "audit-warehouse",
  zoneId: zone.zoneId,
  label: zone.label,
  code: zone.code,
  qrValue: zone.qrValue,
  buildingId: "audit-building",
  buildingName: building.name,
  buildingCode: building.code,
  floorNumber: 2,
  status: "ACTIVE",
  widthMm: 4000,
  depthMm: 4000,
  heightMm: 3000,
  positions: [],
  placements: [],
};
export const namedRow = {
  _id: "audit-named",
  location: {
    locationId: "audit-named-location",
    code: "DEMO-NAMED",
    name: distinct ? "Demo receiving" : "DEMO-NAMED",
    buildingId: "audit-building",
    buildingName: building.name,
    floorNumber: 2,
  },
};
export const record = {
  id: "audit-record",
  customer: undefined,
  deliveryDate: undefined,
  manufacturingDate: undefined,
  factoryQuantity: undefined,
  customerQuantity: undefined,
  storageFormat: undefined,
  updatedAt: Date.parse("2026-10-14T02:00:00Z"),
  version: 1,
  factoryOrder: "DEMO-ORDER",
  productBarcodeText: "DEMO-PRODUCT",
  partName: "Demo product",
  quantity: 20,
  locationCode: zone.code,
  locationName: zone.label,
  locationText: zone.code,
  mapped: true,
  buildingName: building.name,
  floorNumber: 2,
  createdAt: Date.parse("2026-10-14T02:00:00Z"),
  source: "MANUAL" as const,
  imageUrl: undefined,
};
const outcome = (value: unknown) => ({
  ok: true,
  requestId: "audit-query",
  value,
});
const page = (rows: unknown[]) =>
  outcome({
    status: "ready",
    page: rows,
    items: rows,
    isDone: true,
    continueCursor: "",
    complete: true,
  });
export function answer(name: string) {
  if (name.endsWith(":getStorageBuildingLayout"))
    return outcome({ found: true, building, floors });
  if (name.endsWith(":getStorageBuildingInventory"))
    return outcome({ found: true, zones: [] });
  if (name.endsWith(":layoutReadiness"))
    return outcome({
      found: true,
      version: building.version,
      ready: true,
      issues: [],
    });
  if (name.includes("locationCatalogue") && name.endsWith(":options"))
    return page([{ ...catalogueRow, floorCount: 2 }]);
  if (name.includes("locationCatalogue") && name.endsWith(":detail"))
    return outcome(catalogueRow);
  if (name.includes("locationCatalogue")) return page([catalogueRow]);
  if (name.includes("jobScanLocations") && name.endsWith(":searchPage"))
    return outcome({
      status: "ready",
      items: [
        {
          locationId: "audit-location",
          code: zone.code,
          name: zone.label,
          zoneId: zone.zoneId,
          buildingId: "audit-building",
          buildingName: building.name,
          floorNumber: 2,
        },
      ],
      isDone: true,
      continueCursor: "",
    });
  if (name.includes("jobScanLocations") && name.endsWith(":resolve"))
    return outcome({ ok: false, error: { code: "LOCATION_NOT_FOUND" } });
  if (name.includes("jobScanLocations")) return page([namedRow]);
  if (name.endsWith(":profile"))
    return outcome({
      linked: true,
      employed: true,
      timezone: "Asia/Bangkok",
      employee: {
        id: "audit-employee",
        code: "DEMO-EMP01",
        displayName: "Demo employee",
        status: "ACTIVE",
        employmentStartDate: "2026-01-01",
        site: { code: "DEMO-HQ", name: "Demo headquarters" },
        supervisorName: "Demo supervisor",
      },
    });
  return page([]);
}
