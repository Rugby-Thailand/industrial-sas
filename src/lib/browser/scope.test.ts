import { expect, it } from "vitest";
import { scopeKey } from "./scope";

const scope = {
  feature: "storage-location-view",
  organizationId: "org-a",
  userId: "user-a",
  warehouseId: "wh-a",
};

it("preserves ordinary existing keys and separates each identity dimension", () => {
  expect(scopeKey(scope)).toBe("storage-location-view:org-a:user-a:wh-a");
  for (const dimension of Object.keys(scope) as (keyof typeof scope)[]) {
    expect(scopeKey({ ...scope, [dimension]: "other" })).not.toBe(
      scopeKey(scope),
    );
  }
});

it("prevents delimiter collisions between identities", () => {
  expect(scopeKey({ ...scope, organizationId: "a:b", userId: "c" })).not.toBe(
    scopeKey({ ...scope, organizationId: "a", userId: "b:c" }),
  );
});

it("rejects unknown identities instead of sharing an anonymous draft scope", () => {
  expect(() => scopeKey({ ...scope, userId: "" })).toThrow("Persistence scope");
});
