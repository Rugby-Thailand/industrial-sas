/** Typed browser boundary for Path A fulfillment and transport. */
import { api } from "../../../convex/_generated/api";

import { clientRef, type RefValue } from "./clientRef";

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

export interface CapturedPodRow {
  readonly proofOfDeliveryId: string;
  readonly shipmentId: string;
  readonly tripId: string;
  readonly recipientName: string;
  readonly transportFileId: string;
  readonly capturedByUserId: string;
  readonly capturedAt: number;
}

/* -------------------------------------------------------------------------- */
/* Orders and routing                                                          */
/* -------------------------------------------------------------------------- */

export const listFulfillmentOrdersRef = clientRef(
  api.fulfillment.orders.listFulfillmentOrders,
);

export const listFulfillmentLinesRef = clientRef(
  api.fulfillment.orders.listFulfillmentLines,
);

export const routeCustomerOrderLineRef = clientRef(
  api.fulfillment.orders.routeCustomerOrderLine,
);

export const releaseFulfillmentOrderRef = clientRef(
  api.fulfillment.orders.releaseFulfillmentOrder,
);

export const allocateFulfillmentLineRef = clientRef(
  api.fulfillment.reservations.allocateFulfillmentLine,
);

export const cancelFulfillmentLineRemainderRef = clientRef(
  api.fulfillment.reservations.cancelFulfillmentLineRemainder,
);

/* -------------------------------------------------------------------------- */
/* Picking                                                                     */
/* -------------------------------------------------------------------------- */

export const createPickWaveRef = clientRef(
  api.fulfillment.pickPlanning.createPickWave,
);

export const releasePickWaveRef = clientRef(
  api.fulfillment.pickPlanning.releasePickWave,
);

export const listAvailablePickTasksRef = clientRef(
  api.fulfillment.pickExecution.listAvailablePickTasks,
);

export const listPickTasksByStatusRef = clientRef(
  api.fulfillment.pickExecution.listPickTasksByStatus,
);

export const getPickTaskRef = clientRef(
  api.fulfillment.pickExecution.getPickTask,
);

export type PickTaskView = RefValue<typeof getPickTaskRef>;

export const startPickTaskRef = clientRef(
  api.fulfillment.pickExecution.startPickTask,
);

export const recordPickEventRef = clientRef(
  api.fulfillment.pickExecution.recordPickEvent,
);

export const submitPickTaskRef = clientRef(
  api.fulfillment.pickExecution.submitPickTask,
);

export const checkPickTaskRef = clientRef(
  api.fulfillment.pickExecution.checkPickTask,
);

export const packPickTaskRef = clientRef(
  api.fulfillment.pickExecution.packPickTask,
);

export const stagePickTaskRef = clientRef(
  api.fulfillment.pickExecution.stagePickTask,
);

export const issuePickTaskRef = clientRef(
  api.fulfillment.pickExecution.issuePickTask,
);

export const reverseIssuedPickTaskRef = clientRef(
  api.fulfillment.pickExecution.reverseIssuedPickTask,
);

/* -------------------------------------------------------------------------- */
/* Shipments, trips and delivery                                               */
/* -------------------------------------------------------------------------- */

export const createShipmentRef = clientRef(
  api.fulfillment.shipments.createShipment,
);

export const releaseShipmentRef = clientRef(
  api.fulfillment.shipments.releaseShipment,
);

export const listShipmentsRef = clientRef(
  api.fulfillment.shipments.listShipments,
);

export const createTripRef = clientRef(api.fulfillment.tripPlanning.createTrip);

export const assignShipmentToTripRef = clientRef(
  api.fulfillment.tripPlanning.assignShipmentToTrip,
);

export const releaseTripRef = clientRef(
  api.fulfillment.tripPlanning.releaseTrip,
);

export const listTripsRef = clientRef(api.fulfillment.tripPlanning.listTrips);

export const startTripLoadingRef = clientRef(
  api.fulfillment.tripExecution.startTripLoading,
);

export const scanPackageLoadedRef = clientRef(
  api.fulfillment.tripExecution.scanPackageLoaded,
);

export const sealTripRef = clientRef(api.fulfillment.tripExecution.sealTrip);

export const gateOutRef = clientRef(api.fulfillment.tripExecution.gateOut);

export const departTripRef = clientRef(
  api.fulfillment.tripExecution.departTrip,
);

export const authorizeTransportFileUploadRef = clientRef(
  api.fulfillment.transportFiles.authorizeTransportFileUpload,
);

export const attachTransportFileRef = clientRef(
  api.fulfillment.transportFiles.attachTransportFile,
);

export const captureProofOfDeliveryRef = clientRef(
  api.fulfillment.delivery.captureProofOfDelivery,
);

export const recordFailedDeliveryRef = clientRef(
  api.fulfillment.delivery.recordFailedDelivery,
);

export const returnFailedShipmentToWarehouseRef = clientRef(
  api.fulfillment.delivery.returnFailedShipmentToWarehouse,
);

export const listCapturedProofsOfDeliveryRef = clientRef(
  api.fulfillment.delivery.listCapturedProofsOfDelivery,
);

export const reviewProofOfDeliveryRef = clientRef(
  api.fulfillment.delivery.reviewProofOfDelivery,
);
