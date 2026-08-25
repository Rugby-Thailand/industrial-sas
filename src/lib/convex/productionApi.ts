/** Typed browser boundary for production orders and shop-floor reporting. */
import { api } from "../../../convex/_generated/api";

import { clientRef } from "./clientRef";

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

export const listProductionOrdersRef = clientRef(
  api.production.orders.listProductionOrders,
);

export const createProductionOrderRef = clientRef(
  api.production.orders.createProductionOrder,
);

export const releaseProductionOrderRef = clientRef(
  api.production.orders.releaseProductionOrder,
);

export const issueProductionMaterialRef = clientRef(
  api.production.orders.issueProductionMaterial,
);

export const reportProductionOperationRef = clientRef(
  api.production.orders.reportProductionOperation,
);

export const receiveProductionOutputRef = clientRef(
  api.production.orders.receiveProductionOutput,
);

export const decideProductionOutputQualityRef = clientRef(
  api.production.orders.decideProductionOutputQuality,
);
