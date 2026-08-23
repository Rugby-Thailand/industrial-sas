import { describe, expect, it } from "vitest";

import {
  DESKTOP_NAVIGATION,
  HANDHELD_TASKS,
  isActivePath,
  ROUTES,
  visibleDesktopNavigation,
  visibleHandheldTasks,
} from "./navigation";
import { NAVIGATION_PERMISSION } from "../../convex/model/authorization/navigationPermissions";

describe("isActivePath", () => {
  it("marks the exact path active", () => {
    expect(isActivePath("/inventory/balances", "/inventory/balances")).toBe(
      true,
    );
  });

  it("marks a child path active, so a detail page highlights its parent", () => {
    expect(isActivePath("/inventory/history/abc", "/inventory/history")).toBe(
      true,
    );
  });

  it("does not match a sibling that merely shares a prefix", () => {
    // Unguarded `startsWith` would light up "history" for "historical".
    expect(isActivePath("/inventory/historical", "/inventory/history")).toBe(
      false,
    );
  });

  it("does not mark a parent active from an unrelated path", () => {
    expect(isActivePath("/dashboard", "/inventory/balances")).toBe(false);
  });
});

describe("navigation data", () => {
  it("only points at routes named in the route table", () => {
    // Widened to `string`: `ROUTES` is frozen, so its values are literal types
    // and a `Set` of them would refuse the `string` an item carries.
    const known = new Set<string>(Object.values(ROUTES));

    for (const section of DESKTOP_NAVIGATION) {
      for (const item of section.items) {
        expect(known.has(item.href), item.href).toBe(true);
      }
    }
    for (const task of HANDHELD_TASKS) {
      if (task.href === undefined) continue;
      expect(known.has(task.href), task.href).toBe(true);
    }
  });

  it("gives an unavailable handheld task no destination", () => {
    // The launcher renders these as marked, unfocusable rows. A task with both
    // `available: false` and an `href` would be a link to a page that does not
    // exist.
    for (const task of HANDHELD_TASKS) {
      expect(task.available === (task.href !== undefined), task.labelKey).toBe(
        true,
      );
    }
  });

  it("lists the one unbuilt task rather than hiding it", () => {
    /*
     * Receive, QC, and putaway are built. Pallet building is not a standalone
     * task — it happens inside the receiving flow — and it stays listed and
     * marked unavailable so an operator trained on it finds out where it went.
     */
    const unavailable = HANDHELD_TASKS.filter((task) => !task.available).map(
      (task) => task.labelKey,
    );

    expect(unavailable).toEqual(["taskPallet"]);
  });

  it("places production execution between factory packets and fulfillment", () => {
    const orderToShip = DESKTOP_NAVIGATION.find(
      ({ labelKey }) => labelKey === "sectionOrderToShip",
    );
    expect(orderToShip?.items.map(({ href }) => href)).toEqual([
      ROUTES.customerOrders,
      ROUTES.engineeringQueue,
      ROUTES.factoryPackets,
      ROUTES.productionOrders,
      ROUTES.fulfillment,
      ROUTES.transport,
      ROUTES.transfers,
    ]);
  });

  it("removes desktop destinations without a matching read grant", () => {
    const visible = visibleDesktopNavigation([
      NAVIGATION_PERMISSION.dashboard,
      NAVIGATION_PERMISSION.production,
      NAVIGATION_PERMISSION.items,
      NAVIGATION_PERMISSION.locations,
    ]).flatMap(({ items }) => items.map(({ href }) => href));
    expect(visible).toEqual([
      ROUTES.dashboard,
      ROUTES.items,
      ROUTES.locations,
      ROUTES.productionOrders,
      ROUTES.reports,
    ]);
  });

  it("keeps an independently useful report destination when any source is granted", () => {
    const visible = visibleDesktopNavigation([
      NAVIGATION_PERMISSION.exportReports,
    ]).flatMap(({ items }) => items.map(({ href }) => href));
    expect(visible).toEqual([ROUTES.reports]);
  });

  it("keeps the unavailable pallet explanation but hides unauthorized tasks", () => {
    const visible = visibleHandheldTasks([NAVIGATION_PERMISSION.receiving]).map(
      ({ labelKey }) => labelKey,
    );
    expect(visible).toEqual(["taskReceive", "taskPallet"]);
  });
});
