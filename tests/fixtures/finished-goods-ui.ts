import type { FunctionReturnType } from "convex/server";
import type { TenantFunctionOutcome } from "../../convex/lib/tenantFunctions";
import type { refusal, written } from "../../convex/lib/writeEnvelope";
import { zonePreview } from "../../convex/model/finishedGoods/recommendationView";
import type {
  Product,
  Pallet,
  FinishedGoodsRows,
  fgRefs,
} from "@/lib/convex/finishedGoodsApi";

export const finishedGoodProduct: Product = {
  _id: "product-a",
  _creationTime: 1000,
  orgId: "org-a",
  warehouseId: "warehouse-a",
  sku: "FG-001",
  name: "Packaging cartons",
  unit: "pieces",
  storageFormat: "PALLET",
  defaultQuantity: 500,
  storageCondition: "ANY",
  status: "ACTIVE",
  createdAt: 1000,
  createdByUserId: "user-a",
  updatedAt: 1000,
  updatedByUserId: "user-a",
};
export const finishedGoodPallet: Pallet = {
  _id: "pallet-a",
  _creationTime: 1000,
  orgId: "org-a",
  warehouseId: "warehouse-a",
  productId: "product-a",
  code: "P-001",
  quantity: 500,
  lot: "LOT-001",
  status: "AWAITING_MEASUREMENT",
  createdAt: 1000,
  createdByUserId: "user-a",
  updatedAt: 1000,
  updatedByUserId: "user-a",
};
/**
 * Test source rows, in the shape the catalogue renders. The pagination test
 * adapter derives `catalogue:page`/`summary` responses from them.
 */
export type FinishedGoodsList = {
  products: FinishedGoodsRows["products"][number][];
  pallets: FinishedGoodsRows["pallets"][number][];
};
export const finishedGoodsList: FinishedGoodsList = {
  products: [finishedGoodProduct],
  pallets: [
    {
      ...finishedGoodPallet,
      productName: finishedGoodProduct.name,
      sku: finishedGoodProduct.sku,
      unit: finishedGoodProduct.unit,
      storageFormat: finishedGoodProduct.storageFormat,
    },
  ],
};
export const querySuccess = <T>(value: T): TenantFunctionOutcome<T> => ({
  ok: true,
  requestId: "test-query",
  value,
});
/** A read the server refused for this user. */
export const queryDenied = (
  requestId: string,
): TenantFunctionOutcome<never> => ({
  ok: false,
  requestId,
  denial: {
    kind: "AUTHORIZATION_DENIED",
    code: "AUTHORIZATION_DENIED",
    requestId,
    message:
      "This request was denied. Quote the request ID when asking for help.",
  },
});
type WriteOutcome = TenantFunctionOutcome<
  ReturnType<typeof written> | ReturnType<typeof refusal>
>;
export const writeSuccess = (documentId: string): WriteOutcome => ({
  ok: true,
  requestId: "test-write",
  value: { written: true, documentId, replayed: false },
});
export const writeFailure = (code: string, field?: string): WriteOutcome => ({
  ok: true,
  requestId: "test-write",
  value: { written: false, error: { code, ...(field ? { field } : {}) } },
});
// Keep mock envelopes compatible with the client references used by the real UI.
export const savedProductOutcome: FunctionReturnType<
  typeof fgRefs.saveProduct
> = writeSuccess("product-a");
export const createdPalletOutcome: FunctionReturnType<
  typeof fgRefs.createPallet
> = writeSuccess("pallet-a");

import type {
  Destination,
  PalletDetail,
  Placement,
} from "@/lib/convex/finishedGoodsApi";
export const finishedGoodDestination: Destination = {
  zoneId: "zone-a",
  locationId: "location-a",
  locationName: "FG-1",
  locationCode: "BLDG-A-F04-Z01",
  locationQrValue: "ISAS:LOCATION:1:location-a",
  buildingId: "building-a",
  buildingName: "Building A",
  buildingCode: "BLDG-A",
  floorId: "floor-a",
  floorNumber: 4,
  zone: {
    xMm: 4000,
    yMm: 3000,
    widthMm: 2000,
    depthMm: 2000,
    maxStackHeightMm: 3000,
    baseElevationMm: 0,
  },
  support: {
    xMm: 0,
    yMm: 0,
    zMm: 0,
    widthMm: 2000,
    depthMm: 2000,
    heightMm: 3000,
  },
  xMm: 100,
  yMm: 200,
  zMm: 0,
  rotation: 0,
  widthMm: 1000,
  depthMm: 1200,
  heightMm: 1400,
  positionCode: "Proposed",
  checks: {
    boundary: true,
    height: true,
    collision: true,
    storageCondition: "UNKNOWN",
  },
  occupied: [],
  unavailable: [],
};
export const finishedGoodPlacement: Extract<Placement, { mode?: "GEOMETRIC" }> =
  {
    _id: "placement-a",
    _creationTime: 1000,
    orgId: "org-a",
    warehouseId: "warehouse-a",
    palletId: "pallet-a",
    buildingId: "building-a",
    floorId: "floor-a",
    zoneId: "zone-a",
    locationId: "location-a",
    positionCode: "P01",
    qrValue: "ISAS:FG-POSITION:1:warehouse-a:P01",
    xMm: 100,
    yMm: 200,
    zMm: 0,
    widthMm: 1000,
    depthMm: 1200,
    heightMm: 1400,
    rotation: 0,
    status: "RESERVED",
    createdAt: 1000,
    createdByUserId: "user-a",
    updatedAt: 1000,
    updatedByUserId: "user-a",
  };
export const measuredPalletDetail: PalletDetail = {
  stackChildren: [],
  supportPallet: null,
  destinationVerifiedForCurrentUser: false,
  pallet: {
    ...finishedGoodPallet,
    status: "AWAITING_PLACEMENT",
    lengthMm: 1200,
    widthMm: 1000,
    heightMm: 1400,
  },
  product: finishedGoodProduct,
  placement: null,
  destination: null,
};
export const reservedPalletDetail: PalletDetail & {
  placement: typeof finishedGoodPlacement;
} = {
  ...measuredPalletDetail,
  pallet: {
    ...measuredPalletDetail.pallet,
    status: "RESERVED",
    placementId: "placement-a",
  },
  placement: finishedGoodPlacement,
  destination: { ...finishedGoodDestination, positionCode: "P01" },
};

import type { WorkspaceContextValue } from "@/components/providers/WorkspaceProvider";
export const finishedGoodsWorkspace: WorkspaceContextValue = {
  readiness: { kind: "READY_TO_QUERY" },
  organization: { id: "org-a", name: "Warehouse team" },
  warehouses: [{ id: "warehouse-a", code: "QA", name: "QA Warehouse" }],
  selectedWarehouseId: "warehouse-a",
  selectable: true,
  complete: true,
  loading: false,
  failed: false,
  denied: false,
  permissionsReady: true,
  navigationPermissions: [
    "masterData.storageLayout.read",
    "masterData.storageLayout.manage",
  ],
  selectWarehouse: () => {},
};

/**
 * Serve `recommendationZone` for screen tests. A test that mocks it explicitly
 * (a zone preview, null, a denial or loading) gets that; otherwise, as the
 * server does, the zone preview fields of any candidate of that zone in the
 * mocked recommendation (null when none). Other queries pass through.
 */
export function recommendationTestResponse(
  name: string,
  args: unknown,
  query: (name: string, args?: unknown) => unknown,
) {
  if (!name.endsWith(":recommendationZone")) return query(name, args);
  const explicit = query(name, args) as
    { ok?: boolean; value?: unknown } | undefined;
  if (
    !explicit ||
    !explicit.ok ||
    explicit.value === null ||
    (typeof explicit.value === "object" && !("candidates" in explicit.value))
  )
    return explicit;
  const { zoneId } = args as { zoneId: string };
  for (const source of [":recommend", ":recommendMove"]) {
    const outcome = query(`finishedGoods/workflow${source}`) as
      | {
          ok?: boolean;
          value?: {
            candidates?: readonly { zoneId: string }[];
            previewCandidates?: readonly { zoneId: string }[];
          };
        }
      | undefined;
    if (!outcome?.ok) continue;
    const found = [
      ...(outcome.value?.candidates ?? []),
      ...(outcome.value?.previewCandidates ?? []),
    ].find((candidate) => candidate.zoneId === zoneId);
    if (found) return querySuccess(zonePreview(found));
  }
  return querySuccess(null);
}
