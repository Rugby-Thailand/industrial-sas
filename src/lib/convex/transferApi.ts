import { makeFunctionReference } from "convex/server";

import type { TenantOutcome } from "./ledgerApi";
import type { MasterDataWriteOutcome } from "./masterDataApi";

type WriteResult = TenantOutcome<MasterDataWriteOutcome>;
type WarehouseArgs = { readonly warehouseId: string };
type RequestArgs = WarehouseArgs & { readonly requestId: string };

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

interface Page<Row> {
  readonly ok: boolean;
  readonly items: readonly Row[];
  readonly nextCursor: string | null;
  readonly complete: boolean;
}

export const createTransferRequestRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly destinationWarehouseId: string;
    readonly transferNumber: string;
    readonly sourceKind: TransferSummary["sourceKind"];
    readonly sourceReference?: string;
    readonly purpose: string;
  },
  WriteResult
>("transfers/requests:createTransferRequest");

export const addTransferLineRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly transferRequestId: string;
    readonly itemId: string;
    readonly requestedBaseMinorUnits: number;
  },
  WriteResult
>("transfers/requests:addTransferLine");

export const approveTransferRequestRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly transferRequestId: string },
  WriteResult
>("transfers/requests:approveTransferRequest");

export const dispatchTransferLineRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly transferRequestId: string;
    readonly transferLineId: string;
    readonly sourceBucketKey: string;
    readonly baseMinorUnits: number;
    readonly sealNumber?: string;
    readonly carrierName?: string;
  },
  WriteResult
>("transfers/requests:dispatchTransferLine");

export const receiveTransferLineRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly transferRequestId: string;
    readonly transferLineId: string;
    readonly destinationLocationId: string;
    readonly receivedBaseMinorUnits: number;
    readonly discrepancyBaseMinorUnits: number;
    readonly discrepancyKind?: "MISSING" | "DAMAGED" | "WRONG_TAG";
    readonly discrepancyNote?: string;
    readonly stockStatus: "AVAILABLE" | "QC_HOLD" | "QUARANTINE";
  },
  WriteResult
>("transfers/requests:receiveTransferLine");

export const resolveTransferDiscrepancyRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly transferDiscrepancyId: string;
    readonly resolution: "RECEIVED_AT_DESTINATION" | "RETURNED_TO_SOURCE";
    readonly destinationLocationId?: string;
    readonly stockStatus: "AVAILABLE" | "QC_HOLD" | "QUARANTINE";
    readonly resolutionNote: string;
  },
  WriteResult
>("transfers/requests:resolveTransferDiscrepancy");

export const listSourceTransfersRef = makeFunctionReference<
  "query",
  WarehouseArgs & { readonly maxPageSize?: number; readonly cursor?: string },
  TenantOutcome<Page<TransferSummary>>
>("transfers/requests:listSourceTransfers");

export const listDestinationTransfersRef = makeFunctionReference<
  "query",
  WarehouseArgs & { readonly maxPageSize?: number; readonly cursor?: string },
  TenantOutcome<Page<TransferSummary>>
>("transfers/requests:listDestinationTransfers");

export const listTransferWarehousesRef = makeFunctionReference<
  "query",
  WarehouseArgs & { readonly maxPageSize?: number; readonly cursor?: string },
  TenantOutcome<Page<TransferWarehouse>>
>("transfers/requests:listTransferWarehouses");

export const listTransferLinesRef = makeFunctionReference<
  "query",
  WarehouseArgs & { readonly transferRequestId: string },
  TenantOutcome<{
    readonly ok: boolean;
    readonly lines: readonly TransferLine[];
  }>
>("transfers/requests:listTransferLines");

export const listOpenTransferDiscrepanciesRef = makeFunctionReference<
  "query",
  WarehouseArgs & { readonly transferRequestId: string },
  TenantOutcome<{
    readonly ok: boolean;
    readonly discrepancies: readonly TransferDiscrepancy[];
  }>
>("transfers/requests:listOpenTransferDiscrepancies");
