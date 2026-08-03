import { Buffer } from "node:buffer";

import { Webhook } from "svix";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createConvexTenantWorld,
  type ConvexTestModuleMap,
} from "../fixtures/convex-tenant-world";

const SECRET = `whsec_${Buffer.from("industrial-ssa-wiring-test-key").toString("base64")}`;
const MODULES: ConvexTestModuleMap = {
  "../convex/http.ts": () => import("../../convex/http"),
  "../convex/lib/identityMirrorConvex.ts": () =>
    import("../../convex/lib/identityMirrorConvex"),
};

afterEach(() => vi.unstubAllEnvs());

describe("Clerk HTTP-to-internal-mutation wiring", () => {
  it("resolves the hand-written internal reference and commits through the exact route", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", SECRET);
    const world = await createConvexTenantWorld(MODULES);
    const payload = JSON.stringify({
      type: "organization.created",
      data: { id: "org_wired", name: "Wired Organization" },
    });
    const eventId = "evt_wiring_fixture";
    const timestamp = new Date();

    const response = await world.t.fetch("/webhooks/clerk", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": eventId,
        "svix-timestamp": String(Math.floor(timestamp.getTime() / 1_000)),
        "svix-signature": new Webhook(SECRET).sign(eventId, timestamp, payload),
      },
      body: payload,
    });
    const mirrored = await world.t.run(
      async (ctx) =>
        await ctx.db
          .query("organizations")
          .withIndex("by_clerkOrganizationId", (query) =>
            query.eq("clerkOrganizationId", "org_wired"),
          )
          .unique(),
    );

    expect(response.status).toBe(204);
    expect(mirrored).toMatchObject({
      name: "Wired Organization",
      clerkLastEventId: eventId,
    });
  });
});
