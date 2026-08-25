import { describe, expect, it } from "vitest";

import { NAVIGATION_PERMISSION } from "../authorization/navigationPermissions";

import {
  MAX_DASHBOARD_QUICK_ACTIONS,
  OWNER_DASHBOARD_DEFAULT_ACTION_IDS,
  availableDashboardActionIds,
  resolveDashboardActionIds,
  validateDashboardActionSelection,
} from "./dashboardPreferences";

const ownerPermissions = [
  NAVIGATION_PERMISSION.customerOrders,
  NAVIGATION_PERMISSION.fulfillment,
  NAVIGATION_PERMISSION.production,
  NAVIGATION_PERMISSION.items,
  NAVIGATION_PERMISSION.locations,
  NAVIGATION_PERMISSION.balances,
  NAVIGATION_PERMISSION.exportReports,
  NAVIGATION_PERMISSION.integrations,
] as const;

describe("owner dashboard quick-action preferences", () => {
  it("builds the owner default from actions the membership can currently open", () => {
    expect(resolveDashboardActionIds(undefined, ownerPermissions)).toEqual(
      OWNER_DASHBOARD_DEFAULT_ACTION_IDS,
    );
  });

  it("drops a saved action immediately when its permission is revoked", () => {
    expect(
      resolveDashboardActionIds(
        ["INTEGRATION_HEALTH", "INVENTORY_HEALTH", "CUSTOMER_ORDERS"],
        [NAVIGATION_PERMISSION.balances, NAVIGATION_PERMISSION.customerOrders],
      ),
    ).toEqual(["INVENTORY_HEALTH", "CUSTOMER_ORDERS"]);
  });

  it("drops deprecated IDs and duplicates from a previously stored layout", () => {
    expect(
      resolveDashboardActionIds(
        [
          "CUSTOMER_ORDERS",
          "REMOVED_ACTION",
          "CUSTOMER_ORDERS",
          "INVENTORY_HEALTH",
        ],
        ownerPermissions,
      ),
    ).toEqual(["CUSTOMER_ORDERS", "INVENTORY_HEALTH"]);
  });

  it("rejects unknown, duplicate, unauthorized, and excessive selections", () => {
    expect(
      validateDashboardActionSelection(["REMOVED_ACTION"], ownerPermissions),
    ).toEqual({ ok: false, code: "UNKNOWN_ACTION" });
    expect(
      validateDashboardActionSelection(
        ["CUSTOMER_ORDERS", "CUSTOMER_ORDERS"],
        ownerPermissions,
      ),
    ).toEqual({ ok: false, code: "DUPLICATE_ACTION" });
    expect(
      validateDashboardActionSelection(["RECEIVING"], ownerPermissions),
    ).toEqual({ ok: false, code: "ACTION_NOT_AVAILABLE" });
    expect(
      validateDashboardActionSelection(
        Array.from(
          { length: MAX_DASHBOARD_QUICK_ACTIONS + 1 },
          (_, index) =>
            availableDashboardActionIds([
              ...ownerPermissions,
              NAVIGATION_PERMISSION.receiving,
              NAVIGATION_PERMISSION.quality,
              NAVIGATION_PERMISSION.putaway,
              NAVIGATION_PERMISSION.history,
            ])[index]!,
        ),
        [
          ...ownerPermissions,
          NAVIGATION_PERMISSION.receiving,
          NAVIGATION_PERMISSION.quality,
          NAVIGATION_PERMISSION.putaway,
          NAVIGATION_PERMISSION.history,
        ],
      ),
    ).toEqual({ ok: false, code: "TOO_MANY_ACTIONS" });
  });

  it("accepts an explicitly empty menu without turning it back into the default", () => {
    expect(validateDashboardActionSelection([], ownerPermissions)).toEqual({
      ok: true,
      value: [],
    });
    expect(resolveDashboardActionIds([], ownerPermissions)).toEqual([]);
  });
});
