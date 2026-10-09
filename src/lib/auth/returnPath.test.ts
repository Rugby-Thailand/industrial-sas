import { expect, it } from "vitest";
import { plannerReturnPath } from "./returnPath";

it("retains task IDs, filters and floor selection for sign-in", () => {
  const path = "/th/master-data/storage-layouts/demo?floor=2&editing=1";
  expect(plannerReturnPath(path, "th")).toBe(path);
  expect(plannerReturnPath("/en/finished-goods/pallets/demo/move", "en")).toBe(
    "/en/finished-goods/pallets/demo/move",
  );
});
it.each([
  "https://evil.example",
  "//evil.example",
  "/th/sign-in",
  "/en/finished-goods",
  "/th/finished-goods/../sign-in",
  "/th/finished-goods/%2e%2e/sign-in",
  "/th/finished-goods\\evil",
  "/th/setup\nheader",
  undefined,
  ["/th/setup"],
])("rejects an unsafe or unrelated destination %s", (path) => {
  expect(plannerReturnPath(path, "th")).toBeUndefined();
});
