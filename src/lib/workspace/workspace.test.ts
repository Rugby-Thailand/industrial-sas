import { describe, expect, it } from "vitest";

import {
  organizationLabel,
  resolveWorkspace,
  warehouseLabel,
  type WorkspaceSnapshot,
} from "./workspace";

const snapshot: WorkspaceSnapshot = {
  organization: { id: "org_1", name: "Siam Industrial" },
  warehouses: [
    { id: "wh_bpu", code: "BPU", name: "Bang Pu" },
    { id: "wh_lph", code: "LPH", name: "Lamphun" },
  ],
  complete: true,
};

describe("resolveWorkspace", () => {
  it("restores a stored warehouse that is still allowed", () => {
    expect(resolveWorkspace(snapshot, "wh_lph").selectedWarehouseId).toBe(
      "wh_lph",
    );
  });

  it("discards a warehouse outside the current membership", () => {
    expect(
      resolveWorkspace(snapshot, "wh_from_another_membership")
        .selectedWarehouseId,
    ).toBeUndefined();
  });

  it("selects the only allowed warehouse", () => {
    expect(
      resolveWorkspace(
        { ...snapshot, warehouses: [snapshot.warehouses[0]!] },
        undefined,
      ).selectedWarehouseId,
    ).toBe("wh_bpu");
  });

  it("requires a choice when several warehouses are allowed", () => {
    expect(resolveWorkspace(snapshot, undefined).selectedWarehouseId).toBe(
      undefined,
    );
  });

  it("does not claim a complete list when the bounded server read was capped", () => {
    expect(
      resolveWorkspace({ ...snapshot, complete: false }, undefined).complete,
    ).toBe(false);
  });
});

describe("workspace labels", () => {
  it("puts the scannable warehouse code first", () => {
    expect(warehouseLabel(snapshot.warehouses[0]!)).toBe("BPU · Bang Pu");
  });

  it("uses the tenant-owned organization name", () => {
    expect(organizationLabel(snapshot.organization)).toBe("Siam Industrial");
  });
});
