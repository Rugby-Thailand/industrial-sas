import { describe, expect, it } from "vitest";

import { WEBHOOK_PATH_PREFIX } from "../../convex/customerLine/policy";
import { lineWebhook } from "../../convex/customerLine/transportWebhook";
import http from "../../convex/http";
import { clerkWebhook } from "../../convex/lib/clerkWebhook";

describe("public Convex HTTP surface", () => {
  it("exposes only the reviewed Clerk and LINE webhook routes", () => {
    expect([...http.exactRoutes.keys()]).toEqual(["/webhooks/clerk"]);
    expect([...http.prefixRoutes.entries()]).toEqual([
      ["POST", new Map([[WEBHOOK_PATH_PREFIX, lineWebhook]])],
    ]);

    const methods = http.exactRoutes.get("/webhooks/clerk");
    expect(methods === undefined ? [] : [...methods.keys()]).toEqual(["POST"]);
    expect(methods?.get("POST")).toBe(clerkWebhook);
  });
});
