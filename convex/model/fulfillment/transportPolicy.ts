import { isSafeInt } from "../guards";
import { fail, ok, type Result } from "../result";

export type ShipmentStatus =
  | "DRAFT"
  | "READY_TO_LOAD"
  | "LOADING"
  | "LOADED"
  | "GATED_OUT"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "DELIVERY_FAILED"
  | "RETURNED"
  | "CANCELLED";

export type TripStatus =
  | "DRAFT"
  | "READY_TO_LOAD"
  | "LOADING"
  | "SEALED"
  | "GATED_OUT"
  | "IN_TRANSIT"
  | "COMPLETE"
  | "CANCELLED";

export interface LoadProgress {
  readonly expectedPackages: number;
  readonly loadedPackages: number;
}

export type TransportError =
  | {
      readonly code: "INVALID_COUNT";
      readonly field: string;
      readonly value: number;
    }
  | {
      readonly code: "ILLEGAL_TRANSITION";
      readonly entity: "SHIPMENT" | "TRIP";
      readonly status: string;
      readonly action: string;
    }
  | {
      readonly code: "LOAD_INCOMPLETE";
      readonly expectedPackages: number;
      readonly loadedPackages: number;
    }
  | { readonly code: "PACKAGE_ALREADY_LOADED" }
  | { readonly code: "PACKAGE_NOT_EXPECTED" }
  | { readonly code: "SEAL_REQUIRED" }
  | { readonly code: "POD_REQUIRED" }
  | { readonly code: "FAILURE_REASON_REQUIRED" };

const nonNegative = (value: number) => isSafeInt(value) && value >= 0;

export function startTripLoading(
  tripStatus: TripStatus,
  shipmentStatus: ShipmentStatus,
): Result<
  { readonly trip: TripStatus; readonly shipment: ShipmentStatus },
  TransportError
> {
  if (tripStatus !== "READY_TO_LOAD" || shipmentStatus !== "READY_TO_LOAD") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      entity: tripStatus !== "READY_TO_LOAD" ? "TRIP" : "SHIPMENT",
      status: tripStatus !== "READY_TO_LOAD" ? tripStatus : shipmentStatus,
      action: "START_LOADING",
    });
  }
  return ok(Object.freeze({ trip: "LOADING", shipment: "LOADING" }));
}

export function recordLoadedPackage(input: {
  readonly progress: LoadProgress;
  readonly expected: boolean;
  readonly alreadyLoaded: boolean;
}): Result<LoadProgress, TransportError> {
  const { expectedPackages, loadedPackages } = input.progress;
  if (!nonNegative(expectedPackages) || !nonNegative(loadedPackages)) {
    return fail({
      code: "INVALID_COUNT",
      field: !nonNegative(expectedPackages)
        ? "expectedPackages"
        : "loadedPackages",
      value: !nonNegative(expectedPackages) ? expectedPackages : loadedPackages,
    });
  }
  if (!input.expected) return fail({ code: "PACKAGE_NOT_EXPECTED" });
  if (input.alreadyLoaded) return fail({ code: "PACKAGE_ALREADY_LOADED" });
  if (loadedPackages >= expectedPackages)
    return fail({ code: "PACKAGE_NOT_EXPECTED" });
  return ok(
    Object.freeze({ expectedPackages, loadedPackages: loadedPackages + 1 }),
  );
}

export function sealLoadedTrip(
  status: TripStatus,
  progress: LoadProgress,
  sealNumber: string,
): Result<"SEALED", TransportError> {
  if (status !== "LOADING") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      entity: "TRIP",
      status,
      action: "SEAL",
    });
  }
  if (progress.expectedPackages !== progress.loadedPackages) {
    return fail({ code: "LOAD_INCOMPLETE", ...progress });
  }
  if (sealNumber.trim().length === 0) return fail({ code: "SEAL_REQUIRED" });
  return ok("SEALED");
}

export function gateOutTrip(input: {
  readonly tripStatus: TripStatus;
  readonly shipmentStatus: ShipmentStatus;
  readonly sealNumber?: string;
}): Result<
  { readonly trip: "GATED_OUT"; readonly shipment: "GATED_OUT" },
  TransportError
> {
  if (input.tripStatus !== "SEALED" || input.shipmentStatus !== "LOADED") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      entity: input.tripStatus !== "SEALED" ? "TRIP" : "SHIPMENT",
      status:
        input.tripStatus !== "SEALED" ? input.tripStatus : input.shipmentStatus,
      action: "GATE_OUT",
    });
  }
  if ((input.sealNumber ?? "").trim().length === 0)
    return fail({ code: "SEAL_REQUIRED" });
  return ok(Object.freeze({ trip: "GATED_OUT", shipment: "GATED_OUT" }));
}

export function departTrip(
  tripStatus: TripStatus,
  shipmentStatus: ShipmentStatus,
): Result<
  { readonly trip: "IN_TRANSIT"; readonly shipment: "IN_TRANSIT" },
  TransportError
> {
  if (tripStatus !== "GATED_OUT" || shipmentStatus !== "GATED_OUT") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      entity: tripStatus !== "GATED_OUT" ? "TRIP" : "SHIPMENT",
      status: tripStatus !== "GATED_OUT" ? tripStatus : shipmentStatus,
      action: "DEPART",
    });
  }
  return ok(Object.freeze({ trip: "IN_TRANSIT", shipment: "IN_TRANSIT" }));
}

export function completeDelivery(input: {
  readonly shipmentStatus: ShipmentStatus;
  readonly accepted: boolean;
  readonly podEvidenceId?: string;
  readonly failureReason?: string;
}): Result<"DELIVERED" | "DELIVERY_FAILED", TransportError> {
  if (input.shipmentStatus !== "IN_TRANSIT") {
    return fail({
      code: "ILLEGAL_TRANSITION",
      entity: "SHIPMENT",
      status: input.shipmentStatus,
      action: "COMPLETE_DELIVERY",
    });
  }
  if (input.accepted && (input.podEvidenceId ?? "").trim().length === 0) {
    return fail({ code: "POD_REQUIRED" });
  }
  if (!input.accepted && (input.failureReason ?? "").trim().length === 0) {
    return fail({ code: "FAILURE_REASON_REQUIRED" });
  }
  return ok(input.accepted ? "DELIVERED" : "DELIVERY_FAILED");
}
