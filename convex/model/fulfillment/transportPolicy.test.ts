import { describe, expect, it } from "vitest";

import {
  completeDelivery,
  departTrip,
  gateOutTrip,
  recordLoadedPackage,
  sealLoadedTrip,
  startTripLoading,
} from "./transportPolicy";

describe("transport lifecycle", () => {
  it("requires every expected package before sealing and gate-out", () => {
    expect(startTripLoading("READY_TO_LOAD", "READY_TO_LOAD")).toEqual({
      ok: true,
      value: { trip: "LOADING", shipment: "LOADING" },
    });
    const first = recordLoadedPackage({
      progress: { expectedPackages: 2, loadedPackages: 0 },
      expected: true,
      alreadyLoaded: false,
    });
    expect(first).toMatchObject({ ok: true, value: { loadedPackages: 1 } });
    expect(
      sealLoadedTrip(
        "LOADING",
        { expectedPackages: 2, loadedPackages: 1 },
        "S-1",
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "LOAD_INCOMPLETE" },
    });
    expect(
      sealLoadedTrip(
        "LOADING",
        { expectedPackages: 2, loadedPackages: 2 },
        "S-1",
      ),
    ).toEqual({
      ok: true,
      value: "SEALED",
    });
    expect(
      gateOutTrip({
        tripStatus: "SEALED",
        shipmentStatus: "LOADED",
        sealNumber: "S-1",
      }),
    ).toMatchObject({ ok: true });
  });

  it("refuses duplicate and wrong-vehicle package scans", () => {
    expect(
      recordLoadedPackage({
        progress: { expectedPackages: 1, loadedPackages: 0 },
        expected: false,
        alreadyLoaded: false,
      }),
    ).toMatchObject({ ok: false, error: { code: "PACKAGE_NOT_EXPECTED" } });
    expect(
      recordLoadedPackage({
        progress: { expectedPackages: 1, loadedPackages: 0 },
        expected: true,
        alreadyLoaded: true,
      }),
    ).toMatchObject({ ok: false, error: { code: "PACKAGE_ALREADY_LOADED" } });
  });

  it("requires POD for acceptance and a reason for failure", () => {
    expect(departTrip("GATED_OUT", "GATED_OUT")).toMatchObject({ ok: true });
    expect(
      completeDelivery({ shipmentStatus: "IN_TRANSIT", accepted: true }),
    ).toMatchObject({ ok: false, error: { code: "POD_REQUIRED" } });
    expect(
      completeDelivery({
        shipmentStatus: "IN_TRANSIT",
        accepted: true,
        podEvidenceId: "pod-1",
      }),
    ).toEqual({ ok: true, value: "DELIVERED" });
    expect(
      completeDelivery({ shipmentStatus: "IN_TRANSIT", accepted: false }),
    ).toMatchObject({ ok: false, error: { code: "FAILURE_REASON_REQUIRED" } });
  });
});
