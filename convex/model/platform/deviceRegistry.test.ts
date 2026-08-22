import { describe, expect, it } from "vitest";

import {
  MAX_DEVICE_LABEL_LENGTH,
  decideInstallationBinding,
  normalizeDeviceLabel,
  normalizeInstallationId,
  planDeviceRegistration,
  planDeviceRename,
  planDeviceRetirement,
} from "./deviceRegistry";

const device = {
  deviceId: "device_1",
  label: "Dock 1 handheld",
  status: "ACTIVE" as const,
};

describe("device label", () => {
  it("keeps internal spacing and case", () => {
    const label = normalizeDeviceLabel("  Dock 1 handheld  ");
    expect(label.ok && label.value).toBe("Dock 1 handheld");
  });

  it("accepts a Thai label and composes it", () => {
    const label = normalizeDeviceLabel("เครื่องอ่านท่าเรือ 1");
    expect(label.ok).toBe(true);
    expect(label.ok && label.value.normalize("NFC")).toBe(
      label.ok ? label.value : "",
    );
  });

  it("refuses an empty label", () => {
    expect(normalizeDeviceLabel("   ")).toEqual({
      ok: false,
      error: { code: "LABEL_REQUIRED" },
    });
  });

  it("refuses a control character rather than stripping it", () => {
    const label = normalizeDeviceLabel("Dock\u0000handheld");
    expect(label.ok).toBe(false);
    expect(!label.ok && label.error.code).toBe("LABEL_INVALID_CHARACTER");
  });

  it("refuses a label past the bound", () => {
    const label = normalizeDeviceLabel("x".repeat(MAX_DEVICE_LABEL_LENGTH + 1));
    expect(!label.ok && label.error.code).toBe("LABEL_TOO_LONG");
  });
});

describe("installation id", () => {
  it("accepts a UUID-shaped value unchanged", () => {
    const id = normalizeInstallationId("018f2b1c-2b7e-7c2e-9a1b-6b3d5e6f7a8b");
    expect(id.ok && id.value).toBe("018f2b1c-2b7e-7c2e-9a1b-6b3d5e6f7a8b");
  });

  it("refuses a short value", () => {
    expect(normalizeInstallationId("abc").ok).toBe(false);
  });

  it("refuses punctuation outside the alphabet", () => {
    expect(normalizeInstallationId("install ation-1").ok).toBe(false);
    expect(normalizeInstallationId("installation:1").ok).toBe(false);
  });

  it("refuses a value past the bound before checking its alphabet", () => {
    const id = normalizeInstallationId("a".repeat(65));
    expect(!id.ok && id.error.code).toBe("INSTALLATION_ID_TOO_LONG");
  });
});

describe("registration", () => {
  it("registers an active device with its installation", () => {
    const plan = planDeviceRegistration({
      label: "Dock 1 handheld",
      deviceType: "HANDHELD",
      installationId: "installation-0001",
      now: 1_700_000_000_000,
    });
    expect(plan.ok && plan.value).toEqual({
      label: "Dock 1 handheld",
      deviceType: "HANDHELD",
      status: "ACTIVE",
      installationId: "installation-0001",
      lastSeenAt: 1_700_000_000_000,
    });
  });

  it("registers without an installation, which is not a failure", () => {
    const plan = planDeviceRegistration({
      label: "Office workstation",
      deviceType: "WORKSTATION",
      now: 1,
    });
    expect(plan.ok).toBe(true);
    expect(plan.ok && "installationId" in plan.value).toBe(false);
  });

  it("refuses an unknown device type", () => {
    const plan = planDeviceRegistration({
      label: "Robot",
      deviceType: "DRONE",
      now: 1,
    });
    expect(!plan.ok && plan.error.code).toBe("DEVICE_TYPE_INVALID");
  });

  it("refuses an impossible clock", () => {
    const plan = planDeviceRegistration({
      label: "Dock 1",
      deviceType: "HANDHELD",
      now: Number.NaN,
    });
    expect(!plan.ok && plan.error.code).toBe("CLOCK_INVALID");
  });
});

describe("installation binding", () => {
  it("binds a free installation to an active device", () => {
    const decision = decideInstallationBinding({
      device,
      installationId: "installation-0002",
    });
    expect(decision.ok && decision.value).toEqual({
      kind: "BIND",
      deviceId: "device_1",
      installationId: "installation-0002",
    });
  });

  it("reports an existing binding rather than rewriting it", () => {
    const decision = decideInstallationBinding({
      device: { ...device, installationId: "installation-0002" },
      installationId: "installation-0002",
      boundToDeviceId: "device_1",
    });
    expect(decision.ok && decision.value.kind).toBe("ALREADY_BOUND");
  });

  it("refuses an installation already bound to another device", () => {
    const decision = decideInstallationBinding({
      device,
      installationId: "installation-0002",
      boundToDeviceId: "device_2",
    });
    expect(!decision.ok && decision.error.code).toBe(
      "INSTALLATION_ALREADY_BOUND",
    );
  });

  it("refuses to bind anything to a retired device", () => {
    const decision = decideInstallationBinding({
      device: { ...device, status: "RETIRED" },
      installationId: "installation-0002",
    });
    expect(!decision.ok && decision.error.code).toBe("DEVICE_RETIRED");
  });
});

describe("rename and retire", () => {
  it("renames an active device", () => {
    const plan = planDeviceRename({ device, label: " Dock 2 handheld " });
    expect(plan.ok && plan.value).toEqual({ label: "Dock 2 handheld" });
  });

  it("refuses to rename a retired device", () => {
    const plan = planDeviceRename({
      device: { ...device, status: "RETIRED" },
      label: "Dock 2",
    });
    expect(!plan.ok && plan.error.code).toBe("DEVICE_RETIRED");
  });

  it("retires a device and releases its installation", () => {
    const plan = planDeviceRetirement({
      device: { ...device, installationId: "installation-0002" },
      now: 42,
    });
    expect(plan.ok && plan.value).toEqual({
      status: "RETIRED",
      retiredAt: 42,
      releasesInstallation: true,
    });
  });

  it("reports no installation to release when there was none", () => {
    const plan = planDeviceRetirement({ device, now: 42 });
    expect(plan.ok && plan.value.releasesInstallation).toBe(false);
  });

  it("refuses to retire twice, so the first instant stays evidence", () => {
    const plan = planDeviceRetirement({
      device: { ...device, status: "RETIRED" },
      now: 43,
    });
    expect(!plan.ok && plan.error.code).toBe("DEVICE_ALREADY_RETIRED");
  });
});
