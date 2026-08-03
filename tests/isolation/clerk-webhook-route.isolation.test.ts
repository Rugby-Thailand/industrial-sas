import { describe, expect, it } from "vitest";

import http from "../../convex/http";
import { clerkWebhook } from "../../convex/lib/clerkWebhook";

describe("public Clerk webhook route", () => {
  it("exposes the reviewed handler at one exact POST path only", () => {
    expect([...http.exactRoutes.keys()]).toEqual(["/webhooks/clerk"]);
    expect([...http.prefixRoutes.keys()]).toEqual([]);

    const methods = http.exactRoutes.get("/webhooks/clerk");
    expect(methods === undefined ? [] : [...methods.keys()]).toEqual(["POST"]);
    expect(methods?.get("POST")).toBe(clerkWebhook);
  });
});
