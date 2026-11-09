import { expect, it } from "vitest";
import { plannerReturnPath } from "./returnPath";

it("retains task IDs, filters and floor selection for sign-in", () => {
  const path = "/th/master-data/storage-layouts/building-a?floor=2&editing=1";
  expect(plannerReturnPath(path, "th")).toBe(path);
  expect(plannerReturnPath("/en/finished-goods/pallets/demo/move", "en")).toBe(
    "/en/finished-goods/pallets/demo/move",
  );
});
it.each([
  ["th", "/hr"],
  ["th", "/hr/leave/review?request=r1#details"],
  ["en", "/hr/payslips?period=2026-11#download"],
  ["th", "/ai-usage?period=today&feature=search#totals"],
  ["en", "/ai-usage#totals"],
])(
  "retains the exact %s desktop return destination %s",
  (locale, destination) => {
    const path = `/${locale}${destination}`;
    expect(plannerReturnPath(path, locale)).toBe(path);
  },
);
it.each([
  "https://evil.example",
  "//evil.example",
  "/th/sign-in",
  "/en/finished-goods",
  "/th/finished-goods/../sign-in",
  "/th/finished-goods/%2e%2e/sign-in",
  "/th/finished-goods\\evil",
  "/th/setup\nheader",
  "/th/hr/../sign-in",
  "/th/hr/%2e%2e/sign-in",
  "/th/ai-usage/../../evil",
  "/th/hr\\evil",
  "/th/ai-usage\rheader",
  "/en/hr/leave",
  "/th/hr-other",
  "/th/ai-usage-other",
  `/th/hr?query=${"a".repeat(12000)}`,
  undefined,
  ["/th/setup"],
])("rejects an unsafe or unrelated destination %s", (path) => {
  expect(plannerReturnPath(path, "th")).toBeUndefined();
});
