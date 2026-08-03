import { describe, expect, it } from "vitest";

import {
  InvalidIdentityEventError,
  applyIdentityWebhookEvent,
  type IdentityWebhookEvent,
} from "../../convex/lib/identityWebhook";
import { createIdentityMirrorPortFixture } from "../fixtures/identity-mirror-port";

type MembershipEvent =
  | Extract<IdentityWebhookEvent, { type: "membership.upsert" }>
  | Extract<IdentityWebhookEvent, { type: "membership.delete" }>;

const membershipEvent = (
  eventId: string,
  eventAt: number,
  type: "membership.upsert" | "membership.delete" = "membership.upsert",
): MembershipEvent => ({
  eventId,
  eventAt,
  type,
  data: {
    clerkOrganizationId: "org_acme",
    name: "โรงงาน เอซีเอ็มอี",
    clerkUserId: "user_nok",
    displayName: "Nok",
    preferredLocale: "th",
    clerkMembershipId: "mem_nok_acme",
  },
});

describe("normalized Clerk mirror event kernel", () => {
  it("applies once, makes an exact replay a no-op, and rejects equal or older events", async () => {
    const fixture = createIdentityMirrorPortFixture();

    expect(
      await applyIdentityWebhookEvent(
        membershipEvent("evt_2", 2),
        fixture.port,
      ),
    ).toMatchObject({ outcome: "APPLIED", entityKind: "MEMBERSHIP" });
    expect(fixture.writes()).toBe(3);

    expect(
      await applyIdentityWebhookEvent(
        membershipEvent("evt_2", 2),
        fixture.port,
      ),
    ).toMatchObject({ outcome: "REPLAY" });
    expect(
      await applyIdentityWebhookEvent(
        membershipEvent("evt_other", 2),
        fixture.port,
      ),
    ).toMatchObject({ outcome: "STALE" });
    expect(
      await applyIdentityWebhookEvent(
        membershipEvent("evt_old", 1),
        fixture.port,
      ),
    ).toMatchObject({ outcome: "STALE" });
    expect(fixture.writes()).toBe(3);
  });

  it("provisions embedded identities and defaults a new membership fail-closed", async () => {
    const fixture = createIdentityMirrorPortFixture();
    await applyIdentityWebhookEvent(
      membershipEvent("evt_1", 100),
      fixture.port,
    );

    expect(fixture.organization("org_acme")).toMatchObject({
      name: "โรงงาน เอซีเอ็มอี",
      status: "ACTIVE",
      clerkLastEventAt: 100,
    });
    expect(fixture.user("user_nok")).toMatchObject({
      displayName: "Nok",
      status: "ACTIVE",
      preferredLocale: "th",
    });
    expect(fixture.membership("org_acme", "mem_nok_acme")).toEqual({
      clerkOrganizationId: "org_acme",
      clerkUserId: "user_nok",
      clerkMembershipId: "mem_nok_acme",
      status: "ACTIVE",
      scopeMode: "WAREHOUSE_SCOPED",
      effectiveFrom: 100,
      clerkLastEventId: "evt_1",
      clerkLastEventAt: 100,
    });
  });

  it("preserves locally administered scope and effective period on mirror updates", async () => {
    const fixture = createIdentityMirrorPortFixture();
    fixture.seedMembership({
      clerkOrganizationId: "org_acme",
      clerkUserId: "user_nok",
      clerkMembershipId: "mem_nok_acme",
      status: "SUSPENDED",
      scopeMode: "ORG_WIDE",
      effectiveFrom: 10,
      effectiveTo: 500,
      clerkLastEventId: "evt_1",
      clerkLastEventAt: 10,
    });

    await applyIdentityWebhookEvent(membershipEvent("evt_2", 20), fixture.port);

    expect(fixture.membership("org_acme", "mem_nok_acme")).toMatchObject({
      status: "ACTIVE",
      scopeMode: "ORG_WIDE",
      effectiveFrom: 10,
      effectiveTo: 500,
    });
  });

  it("tombstones deletes and cannot be regressed by late updates", async () => {
    const fixture = createIdentityMirrorPortFixture();
    await applyIdentityWebhookEvent(
      {
        eventId: "evt_delete",
        eventAt: 50,
        type: "user.delete",
        data: { clerkUserId: "user_nok" },
      },
      fixture.port,
    );
    await applyIdentityWebhookEvent(
      {
        eventId: "evt_late",
        eventAt: 40,
        type: "user.upsert",
        data: { clerkUserId: "user_nok", displayName: "Late" },
      },
      fixture.port,
    );

    expect(fixture.user("user_nok")).toMatchObject({
      status: "DEACTIVATED",
      clerkLastEventId: "evt_delete",
    });
  });

  it("cannot reactivate tombstoned identities while applying a membership delete", async () => {
    const fixture = createIdentityMirrorPortFixture();
    fixture.seedOrganization({
      clerkOrganizationId: "org_acme",
      name: "Acme",
      status: "CLOSED",
      clerkLastEventId: "evt_org_delete",
      clerkLastEventAt: 10,
    });
    fixture.seedUser({
      clerkUserId: "user_nok",
      displayName: "Nok",
      status: "DEACTIVATED",
      clerkLastEventId: "evt_user_delete",
      clerkLastEventAt: 10,
    });

    await applyIdentityWebhookEvent(
      membershipEvent("evt_membership_delete", 20, "membership.delete"),
      fixture.port,
    );

    expect(fixture.organization("org_acme")?.status).toBe("CLOSED");
    expect(fixture.user("user_nok")?.status).toBe("DEACTIVATED");
    expect(fixture.membership("org_acme", "mem_nok_acme")?.status).toBe(
      "REVOKED",
    );
  });

  it("lets Clerk reactivate a user and membership without reopening a locally closed organization", async () => {
    const fixture = createIdentityMirrorPortFixture();
    fixture.seedOrganization({
      clerkOrganizationId: "org_acme",
      name: "Acme",
      status: "CLOSED",
      clerkLastEventId: "evt_org_delete",
      clerkLastEventAt: 10,
    });
    fixture.seedUser({
      clerkUserId: "user_nok",
      displayName: "Nok",
      status: "DEACTIVATED",
      clerkLastEventId: "evt_user_delete",
      clerkLastEventAt: 10,
    });
    fixture.seedMembership({
      clerkOrganizationId: "org_acme",
      clerkUserId: "user_nok",
      clerkMembershipId: "mem_nok_acme",
      status: "REVOKED",
      scopeMode: "ORG_WIDE",
      effectiveFrom: 5,
      clerkLastEventId: "evt_membership_delete",
      clerkLastEventAt: 10,
    });

    expect(
      await applyIdentityWebhookEvent(
        membershipEvent("evt_revive", 20),
        fixture.port,
      ),
    ).toMatchObject({ outcome: "APPLIED" });

    expect(fixture.organization("org_acme")?.status).toBe("CLOSED");
    expect(fixture.user("user_nok")?.status).toBe("ACTIVE");
    expect(fixture.membership("org_acme", "mem_nok_acme")).toMatchObject({
      status: "ACTIVE",
      clerkLastEventId: "evt_revive",
      clerkLastEventAt: 20,
    });
  });

  it("cannot lift a locally administered organization suspension", async () => {
    const fixture = createIdentityMirrorPortFixture();
    fixture.seedOrganization({
      clerkOrganizationId: "org_acme",
      name: "Acme",
      status: "SUSPENDED",
      clerkLastEventId: "evt_suspend_era",
      clerkLastEventAt: 10,
    });

    await applyIdentityWebhookEvent(
      {
        eventId: "evt_rename",
        eventAt: 20,
        type: "organization.upsert",
        data: { clerkOrganizationId: "org_acme", name: "Acme Manufacturing" },
      },
      fixture.port,
    );

    expect(fixture.organization("org_acme")).toMatchObject({
      name: "Acme Manufacturing",
      status: "SUSPENDED",
    });
  });

  it("keys memberships by organization even when external IDs collide", async () => {
    const fixture = createIdentityMirrorPortFixture();
    const first = membershipEvent("evt_a", 1);
    const second: IdentityWebhookEvent = {
      ...membershipEvent("evt_b", 2),
      data: {
        ...membershipEvent("ignored", 0).data,
        clerkOrganizationId: "org_beta",
        name: "Beta",
      },
    };

    await applyIdentityWebhookEvent(first, fixture.port);
    await applyIdentityWebhookEvent(second, fixture.port);

    expect(
      fixture.membership("org_acme", "mem_nok_acme")?.clerkLastEventId,
    ).toBe("evt_a");
    expect(
      fixture.membership("org_beta", "mem_nok_acme")?.clerkLastEventId,
    ).toBe("evt_b");
  });

  it("rejects malformed, unbounded, and PII-bearing normalized objects before storage", async () => {
    const fixture = createIdentityMirrorPortFixture();
    const invalid: unknown[] = [
      { ...membershipEvent("evt_1", 1), eventAt: 1.5 },
      { ...membershipEvent("evt_1", 1), eventId: "x".repeat(129) },
      { ...membershipEvent("evt_1", 1), type: "user.created" },
      {
        ...membershipEvent("evt_1", 1),
        data: {
          ...membershipEvent("evt_1", 1).data,
          email: "pii@example.test",
        },
      },
    ];

    for (const event of invalid) {
      await expect(
        applyIdentityWebhookEvent(event as IdentityWebhookEvent, fixture.port),
      ).rejects.toBeInstanceOf(InvalidIdentityEventError);
    }
    expect(fixture.writes()).toBe(0);
  });

  it("rejects control characters that could forge a composite tenant key", async () => {
    const fixture = createIdentityMirrorPortFixture();
    const base = membershipEvent("evt_1", 1).data;
    const forged: unknown[] = [
      {
        ...membershipEvent("evt_1", 1),
        data: { ...base, clerkOrganizationId: "org_acme\u0000" },
      },
      {
        ...membershipEvent("evt_1", 1),
        data: { ...base, clerkMembershipId: "\u0000mem_nok_acme" },
      },
      { ...membershipEvent("evt_1", 1), data: { ...base, name: "Acme\u2028" } },
      {
        ...membershipEvent("evt_1", 1),
        data: { ...base, displayName: "Nok\u0007" },
      },
    ];

    for (const event of forged) {
      await expect(
        applyIdentityWebhookEvent(event as IdentityWebhookEvent, fixture.port),
      ).rejects.toBeInstanceOf(InvalidIdentityEventError);
    }
    expect(fixture.writes()).toBe(0);
  });
});
