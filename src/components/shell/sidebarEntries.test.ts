import { Boxes, Building2, CalendarDays } from "lucide-react";
import { describe, expect, it } from "vitest";

import { ROUTES, type NavigationItem } from "@/lib/navigation";

import { groupSidebarItems, navigationLabelKey } from "./sidebarEntries";

const item = (href: string, labelKey = href): NavigationItem => ({
  href,
  labelKey,
  permissionCodes: [],
});

describe("sidebar entries", () => {
  it("keeps ungrouped destinations in order and places a submenu at its first permitted member", () => {
    const entries = groupSidebarItems([
      item(ROUTES.hrRequests),
      item(ROUTES.hrHolidays),
      item(ROUTES.hrTime),
      item(ROUTES.hrLeave),
      item(ROUTES.hrToday),
    ]);
    expect(
      entries.map((entry) =>
        entry.kind === "link" ? entry.item.href : entry.labelKey,
      ),
    ).toEqual([ROUTES.hrRequests, "hrLeave", "hrAttendance"]);
  });

  it("lists only the permitted members, in the submenu's own order", () => {
    const [leave] = groupSidebarItems([
      item(ROUTES.hrHolidays),
      item(ROUTES.hrLeave),
    ]);
    expect(leave).toMatchObject({ kind: "submenu", Icon: CalendarDays });
    expect(
      leave?.kind === "submenu" ? leave.items.map((entry) => entry.href) : [],
    ).toEqual([ROUTES.hrLeave, ROUTES.hrHolidays]);
  });

  it("never invents a submenu without a permitted member", () => {
    expect(groupSidebarItems([item(ROUTES.storageLayouts)])).toEqual([
      { kind: "link", item: item(ROUTES.storageLayouts), Icon: Building2 },
    ]);
    expect(groupSidebarItems([])).toEqual([]);
  });

  it("shortens nested labels only inside a submenu", () => {
    const leave = item(ROUTES.hrLeave, "hrLeave");
    expect(navigationLabelKey(leave, true)).toBe("hrMyLeave");
    expect(navigationLabelKey(leave, false)).toBe("hrLeave");
    const review = item(ROUTES.hrLeaveReview, "hrLeaveReview");
    expect(navigationLabelKey(review, true)).toBe("hrLeaveReview");
  });

  it("falls back to a generic icon for unmapped destinations", () => {
    expect(groupSidebarItems([item("/not-a-route")])).toEqual([
      { kind: "link", item: item("/not-a-route"), Icon: Boxes },
    ]);
  });
});
