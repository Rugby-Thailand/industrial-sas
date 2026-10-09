import { describe, expect, it } from "vitest";

import http from "../../convex/http";
import { clerkWebhook } from "../../convex/lib/clerkWebhook";

describe("public Convex HTTP surface", () => {
  it("exposes only the reviewed Clerk webhook route", () => {
    expect([...http.exactRoutes.keys()]).toEqual(["/webhooks/clerk"]);
    expect([...http.prefixRoutes.keys()]).toEqual([]);

    const methods = http.exactRoutes.get("/webhooks/clerk");
    expect(methods === undefined ? [] : [...methods.keys()]).toEqual(["POST"]);
    expect(methods?.get("POST")).toBe(clerkWebhook);
  });
});
