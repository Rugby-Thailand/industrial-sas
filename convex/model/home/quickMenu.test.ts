import { describe, expect, it } from "vitest";

import {
  effectiveDestinationPermissions,
  STATIC_DESTINATIONS,
} from "../../../src/lib/navigation";
import {
  DEFAULT_QUICK_MENU_ORDER,
  HOME_ELIGIBILITY_PERMISSIONS,
  MODULE_ENTRY_PERMISSION,
  QUICK_MENU_CATALOG,
  QUICK_MENU_KEYS,
  availableQuickMenuKeys,
  defaultPinnedKeys,
  pinnedKeysProblem,
  quickMenuPermissions,
  unreadBadgeText,
} from "./quickMenu";

describe("home quick-menu catalog", () => {
  it("covers exactly the sidebar menu destinations with their own permissions", () => {
    const menu = STATIC_DESTINATIONS.filter((entry) => entry.menu === true);
    expect(QUICK_MENU_CATALOG.map(({ key }) => key)).toEqual(
      menu.map(({ key }) => key),
    );
    expect(QUICK_MENU_KEYS).toHaveLength(22);
    for (const entry of QUICK_MENU_CATALOG) {
      const destination = menu.find(({ key }) => key === entry.key)!;
      expect(destination.module).toBe(entry.module);
      expect(destination.permissionCodes).toEqual([entry.permissionCode]);
      expect(quickMenuPermissions(entry)).toEqual(
        effectiveDestinationPermissions(destination),
      );
    }
  });

  it("orders every key once and gates Home on module entry and customer read grants", () => {
    expect([...DEFAULT_QUICK_MENU_ORDER].sort()).toEqual(
      [...QUICK_MENU_KEYS].sort(),
    );
    expect(HOME_ELIGIBILITY_PERMISSIONS).toEqual([
      ...Object.values(MODULE_ENTRY_PERMISSION),
      "masterData.customer.read",
    ]);
  });

  it("requires module entry grants for warehouse and HR shortcuts", () => {
    expect(availableQuickMenuKeys(["masterData.storageLayout.read"])).toEqual(
      [],
    );
    expect(availableQuickMenuKeys(["masterData.customer.read"])).toEqual([
      "planner.customers",
    ]);
    expect(
      availableQuickMenuKeys([
        "masterData.warehouse.read",
        "masterData.customer.read",
      ]),
    ).toEqual(["planner.customers"]);
    expect(availableQuickMenuKeys(["hr.team.review"])).toEqual([]);
    expect(
      availableQuickMenuKeys(["hr.self.access", "hr.team.review"]),
    ).toContain("hr.review");
    expect(availableQuickMenuKeys(["aiUsage.read"])).toEqual(["admin.aiUsage"]);
    expect(defaultPinnedKeys(availableQuickMenuKeys(["aiUsage.read"]))).toEqual(
      ["admin.aiUsage"],
    );
  });

  it("bounds pins and badge text", () => {
    expect(pinnedKeysProblem([])).toBeNull();
    expect(pinnedKeysProblem(["hr.leave", "hr.leave"])).toBe("DUPLICATE_KEY");
    expect(pinnedKeysProblem(["nope"])).toBe("UNKNOWN_KEY");
    expect(unreadBadgeText(0)).toBeNull();
    expect(unreadBadgeText(99)).toBe("99");
    expect(unreadBadgeText(100)).toBe("99+");
  });
});
