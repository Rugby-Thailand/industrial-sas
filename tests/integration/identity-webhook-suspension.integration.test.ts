import { Buffer } from "node:buffer";
import { Webhook } from "svix";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTestModuleMap,
} from "../fixtures/convex-tenant-world";

const SECRET = `whsec_${Buffer.from("membership-suspension-test-key").toString("base64")}`;
const MODULES: ConvexTestModuleMap = Object.fromEntries(
  Object.entries(
    import.meta.glob([
      "../../convex/**/*.ts",
      "!../../convex/_generated/**",
      "!../../convex/**/*.test.ts",
    ]) as Record<string, () => Promise<unknown>>,
  ).map(([path, load]) => [path.replace("../../convex/", "../convex/"), load]),
);

afterEach(() => vi.unstubAllEnvs());

describe("signed membership update after local suspension", () => {
  it("keeps the suspended actor unable to read the protected workspace", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", SECRET);
    const world = await createConvexTenantWorld(MODULES);
    const auth = await seedConvexAuthorization(world);
    const actor = world.t.withIdentity({
      subject: "user_fixture_a",
      org_id: "org_fixture_a",
    });
    expect((await actor.query(api.workspace.current.readCurrent, {})).ok).toBe(
      true,
    );
    await world.t.run((ctx) =>
      ctx.db.patch(auth.identities.membershipA, { status: "SUSPENDED" }),
    );
    await expect(
      actor.query(api.workspace.current.readCurrent, {}),
    ).rejects.toThrow(/MEMBERSHIP_INACTIVE/);

    const at = Date.now() - 1_000;
    const body = JSON.stringify({
      type: "organizationMembership.updated",
      timestamp: at,
      data: {
        id: auth.identities.sharedClerkMembershipId,
        updated_at: at,
        role: "org:member",
        organization: { id: "org_fixture_a", name: "Tenant A" },
        public_user_data: {
          user_id: "user_fixture_a",
          first_name: "Fixture",
          last_name: "A",
        },
      },
    });
    const eventId = "evt_suspended_membership_update";
    const attempt = new Date();
    const response = await world.t.fetch("/webhooks/clerk", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": eventId,
        "svix-timestamp": String(Math.floor(attempt.getTime() / 1000)),
        "svix-signature": new Webhook(SECRET).sign(eventId, attempt, body),
      },
      body,
    });
    expect(response.status).toBe(204);
    const membership = await world.t.run((ctx) =>
      ctx.db.get(auth.identities.membershipA),
    );
    expect(membership?.status).toBe("SUSPENDED");
    let successfulProtectedQueries = 0;
    try {
      if ((await actor.query(api.workspace.current.readCurrent, {})).ok)
        successfulProtectedQueries++;
    } catch (error) {
      expect(String(error)).toContain("MEMBERSHIP_INACTIVE");
    }
    expect(
      successfulProtectedQueries,
      `membership status after webhook: ${membership?.status}`,
    ).toBe(0);
  });
});
