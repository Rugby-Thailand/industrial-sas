import { describe, expect, it } from "vitest";
import {
  moduleBackFallback,
  resolvePageBackFallback,
} from "./pageBackFallback";

describe("audited module parent destinations", () => {
  it.each([
    "/hr/today",
    "/hr/time",
    "/hr/profile",
    "/hr/settings?section=policy",
    "/hr/holidays",
    "/hr/employees",
    "/hr/review?tab=certified",
    "/hr/periods",
    "/hr/requests",
    "/finished-goods",
    "/master-data/storage-layouts",
  ])("has no synthetic parent for hub %s", (href) => {
    expect(moduleBackFallback(href)).toBeNull();
  });
  it.each([
    ["/th/hr/requests/request-a?focus=decision", "/hr/requests"],
    ["/en/hr/periods/period-a?version=2", "/hr/periods"],
    ["/th/hr/time/2026-10-13", "/hr/time"],
    ["/en/hr/customize", "/hr/today"],
    [
      "/en/finished-goods/products/product-a/packing",
      "/finished-goods/products/product-a",
    ],
    [
      "/th/finished-goods/pallets/pallet-a/move",
      "/finished-goods/pallets/pallet-a",
    ],
    [
      "/en/master-data/storage-layouts/building-a/review",
      "/master-data/storage-layouts/building-a",
    ],
    ["/th/master-data/storage-layouts/new", "/master-data/storage-layouts"],
  ])("keeps %s within its module", (href, parent) => {
    expect(moduleBackFallback(href)).toBe(parent);
    expect(resolvePageBackFallback(href, parent)).toBe(parent);
  });
  it("returns a directly linked employee editor to its filtered list, preserving hash and locale context", () => {
    const current =
      "/th/hr/employees?status=active&employee=employee-a&mode=edit&focus=schedule#staff";
    expect(moduleBackFallback(current)).toBe(
      "/hr/employees?status=active#staff",
    );
    expect(resolvePageBackFallback(current, moduleBackFallback(current))).toBe(
      "/hr/employees?status=active#staff",
    );
    expect(resolvePageBackFallback(current, "/hr/employees")).toBeNull();
  });
  it("returns selected review to its queue while retaining tab and other query intent", () => {
    const current =
      "/en/hr/review?employee=employee-a&date=2026-10-13&tab=certified&focus=decision&site=site-a#queue";
    expect(moduleBackFallback(current)).toBe(
      "/hr/review?tab=certified&site=site-a#queue",
    );
    expect(
      moduleBackFallback("/hr/review?employee=employee-a&date=invalid"),
    ).toBeNull();
  });
  it.each([
    "https://example.com/hr/requests",
    "//example.com/hr/requests",
    "/finished-goods",
    "/",
    "/hr/../finished-goods",
    "/hr/requests\\other",
    "/hr//requests",
    "/hr/requests\n",
    "/hr/%ZZ",
    "/hr/%5c/requests",
  ])("rejects unsafe parent %s", (parent) => {
    expect(
      resolvePageBackFallback("/th/hr/requests/request-a", parent),
    ).toBeNull();
  });
  it.each([
    "/hr/profile",
    "/en/hr/profile",
    "/hr/profile?new=true",
    "/hr/profile#top",
  ])("rejects self-loop %s instead of fabricating a prior view", (parent) => {
    expect(
      resolvePageBackFallback("/th/hr/profile?section=details#section", parent),
    ).toBeNull();
  });
  it("accepts equivalent query encoding when a selected editor returns to its own list", () => {
    const current =
      "/th/hr/employees?status=active&search=two%20words&employee=employee-a&mode=edit#staff";
    expect(
      resolvePageBackFallback(
        current,
        "/hr/employees?search=two%20words&status=active#staff",
      ),
    ).toBe("/hr/employees?search=two%20words&status=active#staff");
  });
});
