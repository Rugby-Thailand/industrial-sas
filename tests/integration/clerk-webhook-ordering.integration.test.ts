import { Buffer } from "node:buffer";

import { ConvexError } from "convex/values";
import { Webhook } from "svix";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import { createConvexAuthorizationLookups } from "../../convex/lib/authorizationLookupsConvex";
import {
  createConvexTenantWorld,
  type ConvexTenantWorld,
  type ConvexTestModuleMap,
} from "../fixtures/convex-tenant-world";

const SECRET = `whsec_${Buffer.from("industrial-sas-event-clock-test-key").toString("base64")}`;
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

async function world() {
  vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", SECRET);
  return await createConvexTenantWorld(MODULES);
}

async function send(
  t: ConvexTenantWorld,
  eventId: string,
  payload: Readonly<Record<string, unknown>>,
  options: { attemptDelta?: number; signature?: string } = {},
) {
  const body = JSON.stringify(payload);
  const attempt = new Date(Date.now() + (options.attemptDelta ?? 0));
  return await t.t.fetch("/webhooks/clerk", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": eventId,
      "svix-timestamp": String(Math.floor(attempt.getTime() / 1_000)),
      "svix-signature":
        options.signature ?? new Webhook(SECRET).sign(eventId, attempt, body),
    },
    body,
  });
}

async function user(t: ConvexTenantWorld, clerkUserId = "user_clock") {
  return await t.t.run(
    async (ctx) =>
      await ctx.db
        .query("users")
        .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
        .unique(),
  );
}

function profile(timestamp: number, updatedAt: number, name = "Current") {
  return {
    type: "user.updated",
    timestamp,
    data: { id: "user_clock", first_name: name, updated_at: updatedAt },
  };
}

function membership(
  type: string,
  timestamp: number,
  id = "mem_clock",
  updatedAt = timestamp,
) {
  return {
    type,
    timestamp,
    data: {
      id,
      updated_at: updatedAt,
      organization: { id: "org_clock", name: "Clock Organization" },
      public_user_data: { user_id: "user_clock", first_name: "Embedded" },
    },
  };
}

async function memberships(t: ConvexTenantWorld) {
  return await t.t.run(async (ctx) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerkOrganizationId", (q) =>
        q.eq("clerkOrganizationId", "org_clock"),
      )
      .unique();
    if (org === null) throw new Error("Missing synthetic organization.");
    return await ctx.db
      .query("memberships")
      .withIndex("by_orgId_userId", (q) => q.eq("orgId", org._id))
      .collect();
  });
}

describe("signed Clerk source clocks through the registered HTTP route", () => {
  it("keeps a user deletion when an older upsert is delivered with a fresh attempt clock", async () => {
    const t = await world();
    const at = Date.now() - 20_000;
    expect(
      (
        await send(t, "evt_delete", {
          type: "user.deleted",
          timestamp: at + 3_000,
          data: { id: "user_clock", deleted: true },
        })
      ).status,
    ).toBe(204);
    const deleted = await user(t);
    expect(
      (
        await send(t, "evt_late", profile(at + 2_000, at + 1_000, "Old"), {
          attemptDelta: 1_000,
        })
      ).status,
    ).toBe(204);
    expect(await user(t)).toEqual(deleted);
    expect(deleted).toMatchObject({
      status: "DEACTIVATED",
      clerkLastEventAt: at + 3_000,
      clerkLastEventTimestamp: at + 3_000,
    });
    // Even an upsert claiming a later source clock cannot reuse a deleted ID.
    expect(
      (await send(t, "evt_impossible_reuse", profile(at + 5_000, at + 4_000)))
        .status,
    ).toBe(204);
    expect((await user(t))?.status).toBe("DEACTIVATED");
  });

  it("uses the object clock first and the signed event clock only to break ties", async () => {
    const t = await world();
    const at = Date.now() - 20_000;
    expect(
      (await send(t, "evt_current", profile(at + 4_000, at + 3_000))).status,
    ).toBe(204);
    const current = await user(t);
    expect(
      (await send(t, "evt_old_object", profile(at + 5_000, at + 2_000, "Old")))
        .status,
    ).toBe(204);
    expect(await user(t)).toEqual(current);
    expect(
      (await send(t, "evt_new_tie", profile(at + 6_000, at + 3_000, "New tie")))
        .status,
    ).toBe(204);
    const newerTie = await user(t);
    expect(newerTie?.displayName).toBe("New tie");
    expect(
      (await send(t, "evt_old_tie", profile(at + 5_000, at + 3_000, "Old tie")))
        .status,
    ).toBe(204);
    expect(await user(t)).toEqual(newerTie);
    expect(
      (
        await send(
          t,
          "evt_new_tie",
          profile(at + 6_000, at + 3_000, "New tie"),
          { attemptDelta: 1_000 },
        )
      ).status,
    ).toBe(204);
    expect(await user(t)).toEqual(newerTie);
  });

  it("retains legacy delivery-clock floors until the object clock strictly crosses them", async () => {
    const t = await world();
    const at = Date.now() - 20_000;
    await t.t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          clerkUserId: "user_clock",
          displayName: "Legacy",
          status: "ACTIVE",
          clerkLastEventId: "evt_legacy",
          clerkLastEventAt: at + 3_000,
        }),
    );
    const legacy = await user(t);
    for (const sourceAt of [at + 2_000, at + 3_000]) {
      expect(
        (await send(t, `evt_floor_${sourceAt}`, profile(at + 6_000, sourceAt)))
          .status,
      ).toBe(204);
      expect(await user(t)).toEqual(legacy);
    }
    expect(
      (await send(t, "evt_cross_floor", profile(at + 7_000, at + 4_000)))
        .status,
    ).toBe(204);
    expect(await user(t)).toMatchObject({
      displayName: "Current",
      clerkLastEventAt: at + 4_000,
      clerkLastEventTimestamp: at + 7_000,
    });
  });

  it("revokes a legacy user even when deletion occurred below its retained delivery floor", async () => {
    const t = await world();
    const at = Date.now() - 20_000;
    await t.t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          clerkUserId: "user_clock",
          displayName: "Legacy",
          status: "ACTIVE",
          clerkLastEventId: "evt_legacy",
          clerkLastEventAt: at + 5_000,
        }),
    );
    expect(
      (
        await send(t, "evt_legacy_delete", {
          type: "user.deleted",
          timestamp: at + 3_000,
          data: { id: "user_clock" },
        })
      ).status,
    ).toBe(204);
    expect(await user(t)).toMatchObject({
      status: "DEACTIVATED",
      clerkLastEventId: "evt_legacy_delete",
      clerkLastEventAt: at + 5_000,
    });
    expect((await user(t))?.clerkLastEventTimestamp).toBeUndefined();
    await send(t, "evt_late_legacy_profile", profile(at + 7_000, at + 6_000));
    expect((await user(t))?.status).toBe("DEACTIVATED");
  });

  it("keeps revoked membership IDs, accepts a new re-add ID and resolves the current membership", async () => {
    const t = await world();
    const at = Date.now() - 20_000;
    await send(t, "evt_user", profile(at, at));
    await send(
      t,
      "evt_member",
      membership("organizationMembership.created", at + 1_000),
    );
    // Delete uses the event clock even when updated_at still describes creation.
    await send(
      t,
      "evt_member_delete",
      membership(
        "organizationMembership.deleted",
        at + 3_000,
        "mem_clock",
        at + 1_000,
      ),
    );
    const deleted = await memberships(t);
    await send(
      t,
      "evt_member_late",
      membership("organizationMembership.created", at + 2_000),
      { attemptDelta: 1_000 },
    );
    expect(await memberships(t)).toEqual(deleted);
    await send(
      t,
      "evt_member_readd",
      membership("organizationMembership.created", at + 4_000, "mem_readded"),
    );
    const rows = await memberships(t);
    expect(rows.map((row) => [row.clerkMembershipId, row.status])).toEqual([
      ["mem_clock", "REVOKED"],
      ["mem_readded", "ACTIVE"],
    ]);
    const current = rows.find(
      (row) => row.clerkMembershipId === "mem_readded",
    )!;
    expect(current.scopeMode).toBe("WAREHOUSE_SCOPED");
    // ReadCurrent is shipping code, invoked with real registration/validators.
    // Grant only the synthetic new membership's normal org-admin read role.
    await t.t.run(async (ctx) => {
      const role = await ctx.db
        .query("roles")
        .withIndex("by_orgId_key", (q) =>
          q.eq("orgId", current.orgId).eq("key", "ORG_ADMIN"),
        )
        .unique();
      if (role === null) throw new Error("Missing seeded synthetic role.");
      await ctx.db.insert("membershipRoles", {
        orgId: current.orgId,
        membershipId: current._id,
        roleId: role._id,
        grantedAt: at + 4_000,
      });
    });
    const read = await t.t
      .withIdentity({ subject: "user_clock", org_id: "org_clock" })
      .query(api.workspace.current.readCurrent, {});
    expect(read).toMatchObject({
      ok: true,
      value: { organization: { id: current.orgId } },
    });
    const selected = await t.t.run(
      async (ctx) =>
        await createConvexAuthorizationLookups(
          ctx,
          "req-current-membership",
        ).findMembership({ orgId: current.orgId, userId: current.userId }),
    );
    expect(selected?._id).toBe(current._id);
    // A duplicate current membership fails closed rather than choosing either.
    await send(
      t,
      "evt_member_ambiguous",
      membership("organizationMembership.created", at + 5_000, "mem_duplicate"),
    );
    await expect(
      t.t
        .withIdentity({ subject: "user_clock", org_id: "org_clock" })
        .query(api.workspace.current.readCurrent, {}),
    ).rejects.toBeInstanceOf(ConvexError);
    const ambiguous = await t.t.run(
      async (ctx) =>
        await createConvexAuthorizationLookups(
          ctx,
          "req-ambiguous-membership",
        ).findMembership({ orgId: current.orgId, userId: current.userId }),
    );
    expect(ambiguous).toBeNull();
  });

  it("does not overwrite parent identity clocks or revive closed/deleted parents from a membership event", async () => {
    const t = await world();
    const at = Date.now() - 20_000;
    await send(
      t,
      "evt_member_first",
      membership("organizationMembership.created", at + 2_000),
    );
    // The user's actual updated_at is older than its embedded membership clock.
    // Its own event must still be accepted, rather than leaving a fallback name.
    await send(t, "evt_profile", profile(at + 1_000, at));
    const actualUser = await user(t);
    expect(actualUser?.displayName).toBe("Current");
    await send(
      t,
      "evt_member_update",
      membership("organizationMembership.updated", at + 4_000),
    );
    expect(await user(t)).toEqual(actualUser);
    await send(t, "evt_user_delete", {
      type: "user.deleted",
      timestamp: at + 5_000,
      data: { id: "user_clock" },
    });
    await send(t, "evt_org_delete", {
      type: "organization.deleted",
      timestamp: at + 5_000,
      data: { id: "org_clock" },
    });
    await send(
      t,
      "evt_member_after_delete",
      membership("organizationMembership.created", at + 6_000, "mem_new"),
    );
    expect((await user(t))?.status).toBe("DEACTIVATED");
    const org = await t.t.run(
      async (ctx) =>
        await ctx.db
          .query("organizations")
          .withIndex("by_clerkOrganizationId", (q) =>
            q.eq("clerkOrganizationId", "org_clock"),
          )
          .unique(),
    );
    expect(org).toMatchObject({
      status: "CLOSED",
      clerkLastEventId: "evt_org_delete",
    });
  });

  it.each([
    ["missing", undefined],
    ["negative", -1],
    ["fractional", 1.5],
    ["future", Date.now() + 60 * 60 * 1_000],
  ])(
    "rejects a %s signed event clock without writing",
    async (_name, timestamp) => {
      const t = await world();
      expect(
        (
          await send(t, "evt_bad_clock", {
            type: "user.created",
            timestamp,
            data: { id: "user_clock", first_name: "Invalid" },
          })
        ).status,
      ).toBe(400);
      expect(await user(t)).toBeNull();
    },
  );

  it("rejects invalid object clocks, bad signatures and missing signing secret before writing", async () => {
    const t = await world();
    const now = Date.now();
    for (const updatedAt of [-1, 1.5, now + 60 * 60 * 1_000, now + 1_000]) {
      expect(
        (await send(t, "evt_bad_object_clock", profile(now, updatedAt))).status,
      ).toBe(400);
    }
    expect(
      (
        await send(t, "evt_bad_signature", profile(now, now), {
          signature: "v1,invalid",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send(t, "evt_expired_attempt", profile(now, now), {
          attemptDelta: -10 * 60 * 1_000,
        })
      ).status,
    ).toBe(400);
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", "");
    expect((await send(t, "evt_no_secret", profile(now, now))).status).toBe(
      503,
    );
    expect(await user(t)).toBeNull();
  });
});
