/** Typed browser boundary for Path A fulfillment and transport. */
import { makeFunctionReference } from "convex/server";

import type { TenantOutcome } from "./ledgerApi";
import type { MasterDataWriteOutcome } from "./masterDataApi";

type WriteResult = TenantOutcome<MasterDataWriteOutcome>;
type WarehouseArgs = { readonly warehouseId: string };
type RequestArgs = WarehouseArgs & { readonly requestId: string };

export interface FulfillmentOrderRow {
  readonly fulfillmentOrderId: string;
  readonly fulfillmentNumber: string;
  readonly customerOrderId: string;
  readonly customerId: string;
  readonly warehouseId: string;
  readonly status: string;
  readonly routeDecision: "AVAILABLE_STOCK" | "PRODUCTION" | "MIXED";
  readonly routeVersion: number;
  readonly allowPartial: boolean;
  readonly requestedDeliveryAt?: number;
  readonly shipTo: {
    readonly name: string;
    readonly addressLine1: string;
    readonly province: string;
    readonly countryCode: string;
  };
}

export interface FulfillmentLineRow {
  readonly fulfillmentLineId: string;
  readonly fulfillmentOrderId: string;
  readonly itemId: string;
  readonly baseUom: string;
  readonly orderedBaseMinorUnits: number;
  readonly routeDecision?: "AVAILABLE_STOCK" | "PRODUCTION";
  readonly routeVersion?: number;
  readonly routedAt?: number;
  readonly productionShortageBaseMinorUnits?: number;
  readonly availableStockPlannedBaseMinorUnits?: number;
  readonly status: string;
  readonly quantities: Readonly<Record<string, number>>;
}

export interface PickTaskQueueRow {
  readonly pickTaskId: string;
  readonly taskNumber: number;
  readonly pickWaveId: string;
  readonly fulfillmentOrderId: string;
  readonly fulfillmentLineId: string;
  readonly warehouseId: string;
  readonly status: string;
  readonly lineCount: number;
}

export interface PickTaskLineView {
  readonly pickTaskLineId: string;
  readonly lineNumber: number;
  readonly itemId: string;
  readonly locationId: string;
  readonly lotId?: string;
  readonly baseUom: string;
  readonly plannedBaseMinorUnits: number;
  readonly pickedBaseMinorUnits: number;
  readonly shortBaseMinorUnits: number;
  readonly damagedBaseMinorUnits: number;
  readonly status: string;
}

export interface PickTaskView {
  readonly found: boolean;
  readonly pickTaskId?: string;
  readonly taskNumber?: number;
  readonly status?: string;
  readonly lineCount?: number;
  readonly eventCount?: number;
  readonly lines?: readonly PickTaskLineView[];
}

export interface ShipmentView {
  readonly found: boolean;
  readonly shipmentId?: string;
  readonly shipmentNumber?: string;
  readonly fulfillmentOrderId?: string;
  readonly warehouseId?: string;
  readonly status?: string;
  readonly expectedPackageCount?: number;
  readonly loadedPackageCount?: number;
  readonly tripId?: string;
}

export interface TripView {
  readonly found: boolean;
  readonly tripId?: string;
  readonly tripNumber?: string;
  readonly warehouseId?: string;
  readonly status?: string;
  readonly vehicleRegistration?: string;
  readonly driverName?: string;
  readonly expectedShipmentCount?: number;
  readonly expectedPackageCount?: number;
  readonly loadedPackageCount?: number;
  readonly sealNumber?: string;
}

export const listFulfillmentOrdersRef = makeFunctionReference<
  "query",
  WarehouseArgs & { readonly maxPageSize?: number; readonly cursor?: string },
  TenantOutcome<{
    readonly ok: boolean;
    readonly items: readonly FulfillmentOrderRow[];
    readonly nextCursor: string | null;
    readonly complete: boolean;
  }>
>("fulfillment/orders:listFulfillmentOrders");

export const listFulfillmentLinesRef = makeFunctionReference<
  "query",
  WarehouseArgs & {
    readonly fulfillmentOrderId: string;
    readonly maxPageSize?: number;
    readonly cursor?: string;
  },
  TenantOutcome<{
    readonly ok: boolean;
    readonly items: readonly FulfillmentLineRow[];
    readonly nextCursor: string | null;
    readonly complete: boolean;
  }>
>("fulfillment/orders:listFulfillmentLines");

export const routeCustomerOrderLineRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly fulfillmentNumber: string;
    readonly customerOrderLineId: string;
    readonly itemId: string;
    readonly allowPartial: boolean;
    readonly requestedDeliveryAt?: number;
    readonly shipTo: {
      readonly name: string;
      readonly addressLine1: string;
      readonly addressLine2?: string;
      readonly district?: string;
      readonly province: string;
      readonly postalCode?: string;
      readonly countryCode: string;
      readonly recipientName?: string;
      readonly recipientPhone?: string;
    };
  },
  WriteResult
>("fulfillment/orders:routeCustomerOrderLine");

export const releaseFulfillmentOrderRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly fulfillmentOrderId: string },
  WriteResult
>("fulfillment/orders:releaseFulfillmentOrder");

export const allocateFulfillmentLineRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly fulfillmentLineId: string;
    readonly strategy: "FIFO" | "FEFO";
    readonly asOfBusinessDate: string;
    readonly requestedBaseMinorUnits: number;
  },
  WriteResult
>("fulfillment/reservations:allocateFulfillmentLine");

export const cancelFulfillmentLineRemainderRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly fulfillmentLineId: string;
    readonly reason: string;
  },
  WriteResult
>("fulfillment/reservations:cancelFulfillmentLineRemainder");

export const createPickWaveRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly fulfillmentOrderId: string;
    readonly waveNumber: string;
  },
  WriteResult
>("fulfillment/pickPlanning:createPickWave");

export const releasePickWaveRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly pickWaveId: string },
  WriteResult
>("fulfillment/pickPlanning:releasePickWave");

export const listAvailablePickTasksRef = makeFunctionReference<
  "query",
  WarehouseArgs,
  TenantOutcome<{ readonly tasks: readonly PickTaskQueueRow[] }>
>("fulfillment/pickExecution:listAvailablePickTasks");

export const listPickTasksByStatusRef = makeFunctionReference<
  "query",
  WarehouseArgs & { readonly status: string },
  TenantOutcome<{ readonly tasks: readonly PickTaskQueueRow[] }>
>("fulfillment/pickExecution:listPickTasksByStatus");

export const getPickTaskRef = makeFunctionReference<
  "query",
  WarehouseArgs & { readonly pickTaskId: string },
  TenantOutcome<PickTaskView>
>("fulfillment/pickExecution:getPickTask");

export const startPickTaskRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly pickTaskId: string },
  WriteResult
>("fulfillment/pickExecution:startPickTask");

export const recordPickEventRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly pickTaskId: string;
    readonly pickTaskLineId: string;
    readonly kind: "PICK" | "SHORT" | "DAMAGED";
    readonly baseMinorUnits: number;
    readonly scannedLocationId?: string;
    readonly scannedItemId?: string;
    readonly scannedLotId?: string;
    readonly reason?: string;
  },
  WriteResult
>("fulfillment/pickExecution:recordPickEvent");

export const submitPickTaskRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly pickTaskId: string },
  WriteResult
>("fulfillment/pickExecution:submitPickTask");

export const checkPickTaskRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly pickTaskId: string },
  WriteResult
>("fulfillment/pickExecution:checkPickTask");

export const packPickTaskRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly pickTaskId: string; readonly packageNumber: string },
  WriteResult
>("fulfillment/pickExecution:packPickTask");

export const stagePickTaskRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly pickTaskId: string;
    readonly stagingLocationId: string;
  },
  WriteResult
>("fulfillment/pickExecution:stagePickTask");

export const issuePickTaskRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly pickTaskId: string },
  WriteResult
>("fulfillment/pickExecution:issuePickTask");

export const reverseIssuedPickTaskRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly pickTaskId: string;
    readonly reasonCodeId: string;
    readonly installationId?: string;
  },
  WriteResult
>("fulfillment/pickExecution:reverseIssuedPickTask");

export const createShipmentRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly fulfillmentOrderId: string;
    readonly shipmentNumber: string;
  },
  WriteResult
>("fulfillment/shipments:createShipment");

export const releaseShipmentRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly shipmentId: string },
  WriteResult
>("fulfillment/shipments:releaseShipment");

export const listShipmentsRef = makeFunctionReference<
  "query",
  WarehouseArgs & { readonly maxPageSize?: number; readonly cursor?: string },
  TenantOutcome<{
    readonly ok: boolean;
    readonly items: readonly ShipmentView[];
    readonly nextCursor: string | null;
    readonly complete: boolean;
  }>
>("fulfillment/shipments:listShipments");

export const createTripRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly tripNumber: string;
    readonly vehicleRegistration: string;
    readonly driverName: string;
    readonly driverPhone?: string;
  },
  WriteResult
>("fulfillment/tripPlanning:createTrip");

export const assignShipmentToTripRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly tripId: string; readonly shipmentId: string },
  WriteResult
>("fulfillment/tripPlanning:assignShipmentToTrip");

export const releaseTripRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly tripId: string },
  WriteResult
>("fulfillment/tripPlanning:releaseTrip");

export const listTripsRef = makeFunctionReference<
  "query",
  WarehouseArgs & { readonly maxPageSize?: number; readonly cursor?: string },
  TenantOutcome<{
    readonly ok: boolean;
    readonly items: readonly TripView[];
    readonly nextCursor: string | null;
    readonly complete: boolean;
  }>
>("fulfillment/tripPlanning:listTrips");

export const startTripLoadingRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly tripId: string },
  WriteResult
>("fulfillment/tripExecution:startTripLoading");

export const scanPackageLoadedRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly tripId: string; readonly packageNumber: string },
  WriteResult
>("fulfillment/tripExecution:scanPackageLoaded");

export const sealTripRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly tripId: string; readonly sealNumber: string },
  WriteResult
>("fulfillment/tripExecution:sealTrip");

export const gateOutRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly tripId: string; readonly gatePassNumber: string },
  WriteResult
>("fulfillment/tripExecution:gateOut");

export const departTripRef = makeFunctionReference<
  "mutation",
  RequestArgs & { readonly tripId: string },
  WriteResult
>("fulfillment/tripExecution:departTrip");

export const authorizeTransportFileUploadRef = makeFunctionReference<
  "mutation",
  WarehouseArgs & {
    readonly shipmentId: string;
    readonly kind:
      "POD" | "GATE_EVIDENCE" | "DELIVERY_NOTE" | "DOCUMENT_RETURN";
  },
  TenantOutcome<
    | { readonly uploadGrantId: string; readonly expiresAt: number }
    | { readonly written: false; readonly error: { readonly code: string } }
  >
>("fulfillment/transportFiles:authorizeTransportFileUpload");

export const attachTransportFileRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly shipmentId: string;
    readonly uploadGrantId: string;
    readonly fileName: string;
    readonly kind:
      "POD" | "GATE_EVIDENCE" | "DELIVERY_NOTE" | "DOCUMENT_RETURN";
    readonly contentType: string;
    readonly byteSize: number;
    readonly contentDigest: string;
    readonly uploadThingKey: string;
  },
  WriteResult
>("fulfillment/transportFiles:attachTransportFile");

export const captureProofOfDeliveryRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly shipmentId: string;
    readonly transportFileId: string;
    readonly recipientName: string;
    readonly recipientNote?: string;
    readonly capturedAt: number;
    readonly latitudeE6?: number;
    readonly longitudeE6?: number;
  },
  WriteResult
>("fulfillment/delivery:captureProofOfDelivery");

export const recordFailedDeliveryRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly shipmentId: string;
    readonly reason: string;
    readonly capturedAt: number;
  },
  WriteResult
>("fulfillment/delivery:recordFailedDelivery");

export const returnFailedShipmentToWarehouseRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly shipmentId: string;
    readonly returnLocationId: string;
    readonly reason: string;
  },
  WriteResult
>("fulfillment/delivery:returnFailedShipmentToWarehouse");

export interface CapturedPodRow {
  readonly proofOfDeliveryId: string;
  readonly shipmentId: string;
  readonly tripId: string;
  readonly recipientName: string;
  readonly transportFileId: string;
  readonly capturedByUserId: string;
  readonly capturedAt: number;
}

export const listCapturedProofsOfDeliveryRef = makeFunctionReference<
  "query",
  WarehouseArgs & { readonly maxPageSize?: number; readonly cursor?: string },
  TenantOutcome<{
    readonly ok: boolean;
    readonly items: readonly CapturedPodRow[];
    readonly nextCursor: string | null;
    readonly complete: boolean;
  }>
>("fulfillment/delivery:listCapturedProofsOfDelivery");

export const reviewProofOfDeliveryRef = makeFunctionReference<
  "mutation",
  RequestArgs & {
    readonly proofOfDeliveryId: string;
    readonly accept: boolean;
    readonly rejectionReason?: string;
  },
  WriteResult
>("fulfillment/delivery:reviewProofOfDelivery");
