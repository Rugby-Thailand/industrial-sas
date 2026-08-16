import { describe, expect, it } from "vitest";

import {
  organizationLabel,
  PREVIEW_ORGANIZATION,
  resolveWorkspace,
  warehouseLabel,
  type WarehouseOption,
} from "./workspace";

import { resolveAppEnvironment } from "../environment";
import { PREVIEW_WAREHOUSES } from "../preview/ledgerPreview";

const server = resolveAppEnvironment({
  convexUrl: "https://example.convex.cloud",
  clerkPublishableKey: "pk_test_Zm9vLWJhci0xMy5jbGVyay5hY2NvdW50cy5kZXYk",
});
const preview = resolveAppEnvironment({
  localPreviewFlag: "1",
  nodeEnv: "development",
});

describe("resolveWorkspace in server mode", () => {
  /*
   * The important assertion in this block is the absence: with no server read
   * for the actor's warehouses — that read needs a resolved tenant, which needs
   * a verified token — there is nothing honest to offer, and offering an empty
   * dropdown would look like a tenant with no sites.
   */
  it("offers nothing to select and says so", () => {
    const state = resolveWorkspace(server, undefined);

    expect(state.source).toBe("SERVER");
    expect(state.selectable).toBe(false);
    expect(state.warehouses).toEqual([]);
    expect(state.organization).toBeUndefined();
    expect(state.selectedWarehouseId).toBeUndefined();
  });

  it("ignores a stored warehouse, which cannot be validated without a tenant", () => {
    const state = resolveWorkspace(server, "wh_from_a_previous_session");
    expect(state.selectedWarehouseId).toBeUndefined();
  });
});

describe("resolveWorkspace in preview mode", () => {
  it("offers the synthetic organization and its warehouses", () => {
    const state = resolveWorkspace(preview, undefined);

    expect(state.source).toBe("PREVIEW");
    expect(state.selectable).toBe(true);
    expect(state.organization).toEqual(PREVIEW_ORGANIZATION);
    expect(state.warehouses).toEqual(PREVIEW_WAREHOUSES);
  });

  it("restores a stored warehouse that is still available", () => {
    const stored = PREVIEW_WAREHOUSES[1]?.id ?? "";
    expect(resolveWorkspace(preview, stored).selectedWarehouseId).toBe(stored);
  });

  it("discards a stored warehouse that is not in the available list", () => {
    // Stale or someone else's. Keeping it would send every read to a warehouse
    // the server will refuse.
    expect(
      resolveWorkspace(preview, "wh_belonging_to_another_tenant")
        .selectedWarehouseId,
    ).toBeUndefined();
  });

  it("leaves the choice open when more than one warehouse exists", () => {
    expect(PREVIEW_WAREHOUSES.length).toBeGreaterThan(1);
    expect(resolveWorkspace(preview, undefined).selectedWarehouseId).toBe(
      undefined,
    );
  });
});

describe("labels", () => {
  const warehouse: WarehouseOption = {
    id: "wh_1",
    code: "BPU",
    nameTh: "คลังบางปู",
    nameEn: "Bang Pu plant store",
  };

  it("puts the scannable code first in both languages", () => {
    expect(warehouseLabel(warehouse, "th")).toBe("BPU · คลังบางปู");
    expect(warehouseLabel(warehouse, "en")).toBe("BPU · Bang Pu plant store");
  });

  it("carries both organization names as data rather than as translation keys", () => {
    // B-10: master data is bilingual as *data*. A translation key would make a
    // tenant's own name a code change.
    expect(organizationLabel(PREVIEW_ORGANIZATION, "th")).toBe(
      PREVIEW_ORGANIZATION.nameTh,
    );
    expect(organizationLabel(PREVIEW_ORGANIZATION, "en")).toBe(
      PREVIEW_ORGANIZATION.nameEn,
    );
  });
});
