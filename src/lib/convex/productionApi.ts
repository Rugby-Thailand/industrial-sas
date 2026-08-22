import { makeFunctionReference } from "convex/server";

import type { TenantOutcome } from "./ledgerApi";
import type { MasterDataWriteOutcome } from "./masterDataApi";

type WriteResult = TenantOutcome<MasterDataWriteOutcome>;
type WarehouseArgs = { readonly warehouseId: string };
type RequestArgs = WarehouseArgs & { readonly requestId: string };

export interface ProductionOrderRow {
  readonly productionOrderId: string;
  readonly warehouseId: string;
  readonly productionOrderNumber: string;
  readonly factoryPacketId: string;
  readonly customerOrderLineId: string;
  readonly fulfillmentLineId?: string;
  readonly planningSource?: "ROUTED_SHORTAGE" | "LEGACY_PACKET";
  readonly masterCardRevisionId: string;
  readonly revisionNumber: number;
  readonly outputItemId: string;
  readonly outputBaseUom: string;
  readonly targetBaseMinorUnits: number;
  readonly quantities: {
    readonly target: number;
    readonly good: number;
    readonly scrap: number;
    readonly rework: number;
    readonly received: number;
    readonly qcReleased: number;
    readonly qcRejected: number;
  };
  readonly route: readonly {
    readonly sequence: number;
    readonly workCenterCode: string;
    readonly operationCode: string;
    readonly instruction?: string;
  }[];
  readonly status:
    | "DRAFT"
    | "RELEASED"
    | "IN_PROGRESS"
    | "QC_PENDING"
    | "COMPLETE"
    | "CLOSED_REJECTED"
    | "CANCELLED";
  readonly dueAt: number;
}

interface Page<Row> {
  readonly ok: boolean;
  readonly items: readonly Row[];
  readonly nextCursor: string | null;
  readonly complete: boolean;
}

export const listProductionOrdersRef = makeFunctionReference<
  "query",
  WarehouseArgs & {
    readonly status?: ProductionOrderRow["status"];
    readonly maxPageSize?: number;
    readonly cursor?: string;
  },
  TenantOutcome<Page<ProductionOrderRow>>
>("production/orders:listProductionOrders");

export const createProductionOrderRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly factoryPacketId: string;
    readonly productionOrderNumber: string;
    readonly outputItemId: string;
    readonly dueAt: number;
  },
  WriteResult
>("production/orders:createProductionOrder");

export const releaseProductionOrderRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly productionOrderId: string },
  WriteResult
>("production/orders:releaseProductionOrder");

export const issueProductionMaterialRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly productionOrderId: string;
    readonly productionMaterialRequirementId: string;
    readonly sourceBucketKey: string;
    readonly baseMinorUnits: number;
  },
  WriteResult
>("production/orders:issueProductionMaterial");

export const reportProductionOperationRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly productionOrderId: string;
    readonly operationSequence: number;
    readonly goodBaseMinorUnits: number;
    readonly scrapBaseMinorUnits: number;
    readonly reworkBaseMinorUnits: number;
    readonly downtimeMinutes: number;
    readonly downtimeReason?: string;
  },
  WriteResult
>("production/orders:reportProductionOperation");

export const receiveProductionOutputRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly productionOrderId: string;
    readonly outputLotId: string;
    readonly destinationLocationId: string;
    readonly baseMinorUnits: number;
  },
  WriteResult
>("production/orders:receiveProductionOutput");

export const decideProductionOutputQualityRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly productionOutputReceiptId: string;
    readonly decision: "RELEASE" | "REJECT";
    readonly note: string;
  },
  WriteResult
>("production/orders:decideProductionOutputQuality");
