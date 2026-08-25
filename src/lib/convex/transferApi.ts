import { api } from "../../../convex/_generated/api";

import { clientRef } from "./clientRef";

export interface TransferSummary {
  readonly transferRequestId: string;
  readonly transferNumber: string;
  readonly sourceWarehouseId: string;
  readonly destinationWarehouseId: string;
  readonly sourceKind:
    "SALES_ORDER" | "INVOICE" | "PREPARATION" | "REPLENISHMENT" | "OTHER";
  readonly sourceReference?: string;
  readonly purpose: string;
  readonly status: string;
  readonly lineCount: number;
}

export interface TransferLine {
  readonly transferLineId: string;
  readonly transferRequestId: string;
  readonly lineNumber: number;
  readonly itemId: string;
  readonly baseUom: string;
  readonly quantities: {
    readonly REQUESTED: number;
    readonly DISPATCHED: number;
    readonly RECEIVED: number;
    readonly RETURNED: number;
    readonly DISCREPANCY: number;
    readonly CANCELLED: number;
  };
  readonly sourceBucketKey?: string;
  readonly destinationLocationId?: string;
}

export interface TransferWarehouse {
  readonly warehouseId: string;
  readonly code: string;
  readonly name: string;
}

export interface TransferDiscrepancy {
  readonly transferDiscrepancyId: string;
  readonly transferRequestId: string;
  readonly transferLineId: string;
  readonly kind: "MISSING" | "DAMAGED" | "WRONG_TAG";
  readonly baseUom: string;
  readonly baseMinorUnits: number;
  readonly note: string;
}

export const createTransferRequestRef = clientRef(
  api.transfers.requests.createTransferRequest,
);

export const addTransferLineRef = clientRef(
  api.transfers.requests.addTransferLine,
);

export const approveTransferRequestRef = clientRef(
  api.transfers.requests.approveTransferRequest,
);

export const dispatchTransferLineRef = clientRef(
  api.transfers.requests.dispatchTransferLine,
);

export const receiveTransferLineRef = clientRef(
  api.transfers.requests.receiveTransferLine,
);

export const resolveTransferDiscrepancyRef = clientRef(
  api.transfers.requests.resolveTransferDiscrepancy,
);

export const listSourceTransfersRef = clientRef(
  api.transfers.requests.listSourceTransfers,
);

export const listDestinationTransfersRef = clientRef(
  api.transfers.requests.listDestinationTransfers,
);

export const listTransferWarehousesRef = clientRef(
  api.transfers.requests.listTransferWarehouses,
);

export const listTransferLinesRef = clientRef(
  api.transfers.requests.listTransferLines,
);

export const listOpenTransferDiscrepanciesRef = clientRef(
  api.transfers.requests.listOpenTransferDiscrepancies,
);
