import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { thailandDefaults } from "../../convex/model/hr/policy";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  seedSecondActorForOrgA,
} from "../fixtures/convex-tenant-world";
const actor = { subject: "user_fixture_a", org_id: "org_fixture_a" };
function ref<Type extends "query" | "mutation">(_type: Type, path: string) {
  return makeFunctionReference<Type>(path);
}
const refs = {
  due: ref("mutation", "hr/announcementSchedule:publishDue"),
  schedule: ref("mutation", "hr/announcements:schedule"),
  cancel: ref("mutation", "hr/announcements:cancelSchedule"),
  draft: ref("mutation", "hr/announcements:saveDraft"),
  publish: ref("mutation", "hr/announcements:publish"),
  archive: ref("mutation", "hr/announcements:archive"),
  pin: ref("mutation", "hr/announcements:setPinned"),
  self: ref("query", "hr/announcements:self"),
  detail: ref("query", "hr/announcements:detail"),
  receipt: ref("mutation", "hr/announcements:recordReceipt"),
  list: ref("query", "hr/notifications:list"),
  one: ref("mutation", "hr/notifications:markOne"),
  all: ref("mutation", "hr/notifications:markAll"),
};
function value<T = Record<string, unknown>>(outcome: unknown): T {
  expect(outcome).toMatchObject({ ok: true });
  return (outcome as { value: T }).value;
}
async function fixture(policy = true) {
  const world = await createConvexTenantWorld({
    "../convex/hr/announcementSchedule.ts": () =>
      import("../../convex/hr/announcementSchedule"),
    "../convex/hr/announcements.ts": () =>
      import("../../convex/hr/announcements"),
    "../convex/hr/notifications.ts": () =>
      import("../../convex/hr/notifications"),
  });
  const authorization = await seedConvexAuthorization(world, {
    roleA: "HR_ADMIN",
  });
  await world.t.run((ctx) =>
    ctx.db.patch(authorization.identities.membershipA, {
      scopeMode: "ORG_WIDE",
    }),
  );
  const second = await seedSecondActorForOrgA(world, "HR_EMPLOYEE");
  const [own, other] = await world.t.run(async (ctx) => {
    const make = (
      code: string,
      userId: Id<"users">,
      warehouseId: Id<"warehouses">,
    ) =>
      ctx.db.insert("hrEmployees", {
        orgId: world.orgA,
        warehouseId,
        code,
        displayName: code,
        userId,
        employmentStartDate: "2020-01-01",
        status: "ACTIVE",
        version: 1,
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
    if (policy)
      await ctx.db.insert("hrPolicyVersions", {
        orgId: world.orgA,
        capability: "ANNOUNCEMENTS",
        config: thailandDefaults(),
        effectiveDate: "2020-01-01",
        version: 1,
        draftVersion: 1,
        preset: "TH_TEST",
        coverageConfirmed: true,
        existingBenefitsReviewed: true,
        activatedAt: 1,
        activatedByUserId: world.userA,
      });
    return [
      await make("OWN", world.userA, world.warehouses.alphaA),
      await make("OTHER", second.userId, world.warehouses.bravoA),
    ];
  });
  const employeeActor = { subject: second.clerkUserId, org_id: actor.org_id };
  const admin = world.t.withIdentity(actor),
    employee = world.t.withIdentity(employeeActor);
  const draft = async (sites?: Id<"warehouses">[], ack = false) =>
    value<{
      written: true;
      documentId: Id<"hrAnnouncements">;
      version: number;
    }>(
      await admin.mutation(refs.draft, {
        requestId: `draft_${Math.random().toString(36).slice(2)}`,
        expectedVersion: 0,
        title: "Warehouse update",
        body: "Read the confirmed safety briefing.",
        audience: {
          mode: sites ? "SITES" : "ORGANIZATION",
          warehouseIds: sites ?? [],
        },
        acknowledgmentRequired: ack,
      }),
    );
  const publish = async (
    id: string,
    version = 1,
    requestId = "publication_first",
  ) =>
    value(
      await admin.mutation(refs.publish, {
        requestId,
        announcementId: id,
        expectedVersion: version,
      }),
    );
  return { world, own, other, admin, employee, draft, publish, authorization };
}
describe("announcement publication and durable employee notifications", () => {
  it("keeps drafts private and refuses publication before HR activates policy", async () => {
    const f = await fixture(false),
      draft = await f.draft();
    expect(value(await f.admin.query(refs.self, {}))).toMatchObject({
      items: [],
      gate: "POLICY_NOT_ACTIVE",
    });
    expect(await f.publish(draft.documentId)).toMatchObject({
      written: false,
      error: { code: "POLICY_NOT_ACTIVE" },
    });
    expect(
      value(
        await f.employee.query(refs.detail, {
          announcementId: draft.documentId,
        }),
      ),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(
      await f.world.t.run((ctx) => ctx.db.query("hrNotifications").collect()),
    ).toEqual([]);
  });
  it("publishes exactly once and persists private audience, receipts and notification rows", async () => {
    const f = await fixture(),
      draft = await f.draft(undefined, true);
    expect(await f.publish(draft.documentId)).toMatchObject({
      written: true,
      recipientCount: 2,
      version: 2,
      replayed: false,
    });
    expect(await f.publish(draft.documentId)).toMatchObject({
      written: true,
      recipientCount: 2,
      replayed: true,
    });
    expect(
      await f.world.t.run((ctx) => ctx.db.query("hrNotifications").collect()),
    ).toHaveLength(2);
    const before = value<{
      ok: true;
      announcement: { body: string };
      receipt: { readAt?: number };
    }>(
      await f.employee.query(refs.detail, { announcementId: draft.documentId }),
    );
    expect(before.announcement.body).toContain("confirmed");
    expect(before.receipt.readAt).toBeUndefined();
    const read = {
      requestId: "receipt_read_once",
      announcementId: draft.documentId,
      contentVersion: 2,
      action: "READ",
    };
    expect(value(await f.employee.mutation(refs.receipt, read))).toMatchObject({
      written: true,
      acknowledgedAt: null,
    });
    expect(value(await f.employee.mutation(refs.receipt, read))).toMatchObject({
      written: true,
      replayed: true,
    });
    expect(
      value(
        await f.employee.mutation(refs.receipt, {
          ...read,
          requestId: "receipt_ack_once",
          action: "ACKNOWLEDGE",
        }),
      ),
    ).toMatchObject({ written: true, acknowledgedAt: expect.any(Number) });
    expect(value(await f.employee.query(refs.list, {}))).toMatchObject({
      unreadCount: 1,
    });
  });
  it("rejects changed receipt versions and never permits published content edits", async () => {
    const f = await fixture(),
      draft = await f.draft();
    await f.publish(draft.documentId);
    expect(
      value(
        await f.employee.mutation(refs.receipt, {
          requestId: "receipt_wrong_version",
          announcementId: draft.documentId,
          contentVersion: 1,
          action: "READ",
        }),
      ),
    ).toMatchObject({ written: false, error: { code: "ANNOUNCEMENT_STALE" } });
    expect(
      value(
        await f.admin.mutation(refs.draft, {
          requestId: "edit_published_blocked",
          announcementId: draft.documentId,
          expectedVersion: 2,
          title: "Changed",
          body: "Changed body",
          audience: { mode: "ORGANIZATION", warehouseIds: [] },
          acknowledgmentRequired: false,
        }),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "ANNOUNCEMENT_PUBLISHED_IMMUTABLE" },
    });
  });
  it("limits a site audience and denies forged employee notification/announcement IDs", async () => {
    const f = await fixture(),
      draft = await f.draft([f.world.warehouses.alphaA]);
    await f.publish(draft.documentId);
    expect(value(await f.employee.query(refs.self, {}))).toMatchObject({
      items: [],
    });
    expect(
      value(
        await f.employee.query(refs.detail, {
          announcementId: draft.documentId,
        }),
      ),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    const rows = await f.world.t.run((ctx) =>
      ctx.db.query("hrNotifications").collect(),
    );
    expect(
      value(
        await f.employee.mutation(refs.one, {
          requestId: "forge_notification_own",
          notificationId: rows[0]!._id,
        }),
      ),
    ).toMatchObject({ written: false, error: { code: "NOT_FOUND" } });
    const tenantB = f.world.t.withIdentity({
      ...actor,
      org_id: "org_fixture_b",
    });
    expect(
      value(
        await tenantB.mutation(refs.publish, {
          requestId: "foreign_publication_1",
          announcementId: draft.documentId,
          expectedVersion: 2,
        }),
      ),
    ).toMatchObject({ written: false, error: { code: "NOT_FOUND" } });
  });
  it("marks notification status separately from formal acknowledgment, with safe replay", async () => {
    const f = await fixture(),
      draft = await f.draft(undefined, true);
    await f.publish(draft.documentId);
    const args = { requestId: "notifications_mark_all" };
    expect(value(await f.employee.mutation(refs.all, args))).toMatchObject({
      written: true,
      markedCount: 1,
      moreUnread: false,
      replayed: false,
    });
    expect(value(await f.employee.mutation(refs.all, args))).toMatchObject({
      written: true,
      markedCount: 1,
      replayed: true,
    });
    expect(value(await f.employee.query(refs.list, {}))).toMatchObject({
      unreadCount: 0,
    });
    expect(value(await f.admin.query(refs.list, {}))).toMatchObject({
      unreadCount: 1,
    });
    expect(
      value<{ receipt: { acknowledgedAt?: number } }>(
        await f.employee.query(refs.detail, {
          announcementId: draft.documentId,
        }),
      ).receipt.acknowledgedAt,
    ).toBeUndefined();
  });
  it("archives preserve published content/history but stop new formal acknowledgments", async () => {
    const f = await fixture(),
      draft = await f.draft(undefined, true);
    await f.publish(draft.documentId);
    expect(
      value(
        await f.admin.mutation(refs.archive, {
          requestId: "archive_announcement_1",
          announcementId: draft.documentId,
          expectedVersion: 2,
        }),
      ),
    ).toMatchObject({ written: true, version: 3 });
    expect(
      value(
        await f.employee.query(refs.detail, {
          announcementId: draft.documentId,
        }),
      ),
    ).toMatchObject({
      announcement: { status: "ARCHIVED", publishedVersion: 2 },
      receipt: { contentVersion: 2 },
    });
    expect(
      value(
        await f.employee.mutation(refs.receipt, {
          requestId: "archived_ack_attempt",
          announcementId: draft.documentId,
          contentVersion: 2,
          action: "ACKNOWLEDGE",
        }),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "ANNOUNCEMENT_ACKNOWLEDGMENT_UNAVAILABLE" },
    });
  });
  it("fails oversized publication before any recipients or notifications are inserted", async () => {
    const f = await fixture(),
      draft = await f.draft();
    await f.world.t.run(async (ctx) => {
      for (let i = 0; i < 500; i++)
        await ctx.db.insert("hrEmployees", {
          orgId: f.world.orgA,
          warehouseId: f.world.warehouses.alphaA,
          code: `E${i}`,
          displayName: `E${i}`,
          employmentStartDate: "2020-01-01",
          status: "ACTIVE",
          version: 1,
          createdAt: 1,
          updatedAt: 1,
          createdByUserId: f.world.userA,
          updatedByUserId: f.world.userA,
        });
    });
    expect(await f.publish(draft.documentId)).toMatchObject({
      written: false,
      error: { code: "ANNOUNCEMENT_AUDIENCE_LIMIT" },
    });
    expect(
      await f.world.t.run((ctx) => ctx.db.query("hrNotifications").collect()),
    ).toEqual([]);
    expect(
      await f.world.t.run((ctx) =>
        ctx.db.query("hrAnnouncementRecipients").collect(),
      ),
    ).toEqual([]);
  });
  it("reports capped unread counts and completes mark-all in explicit bounded batches", async () => {
    const f = await fixture(),
      draft = await f.draft();
    await f.publish(draft.documentId);
    await f.world.t.run(async (ctx) => {
      for (let i = 0; i < 500; i++)
        await ctx.db.insert("hrNotifications", {
          orgId: f.world.orgA,
          employeeId: f.other,
          announcementId: draft.documentId,
          event: "ANNOUNCEMENT_PUBLISHED",
          title: "Published item",
          eventKey: `test:${i}`,
          unread: true,
          createdAt: i,
        });
    });
    expect(value(await f.employee.query(refs.list, {}))).toMatchObject({
      unreadCount: 500,
      unreadCountComplete: false,
    });
    expect(
      value(
        await f.employee.mutation(refs.all, {
          requestId: "notifications_batch_one",
        }),
      ),
    ).toMatchObject({ written: true, markedCount: 500, moreUnread: true });
    expect(value(await f.employee.query(refs.list, {}))).toMatchObject({
      unreadCount: 1,
      unreadCountComplete: true,
    });
    expect(
      value(
        await f.employee.mutation(refs.all, {
          requestId: "notifications_batch_two",
        }),
      ),
    ).toMatchObject({ written: true, markedCount: 1, moreUnread: false });
  });
  it("pins global feed results without changing the published content version", async () => {
    const f = await fixture(),
      draft = await f.draft(undefined, true);
    await f.publish(draft.documentId);
    expect(
      value(await f.admin.query(refs.self, { pinnedOnly: true })),
    ).toMatchObject({ items: [] });
    expect(
      value(
        await f.admin.mutation(refs.pin, {
          requestId: "pin_published_notice",
          announcementId: draft.documentId,
          expectedVersion: 2,
          pinned: true,
        }),
      ),
    ).toMatchObject({ written: true, version: 3 });
    expect(
      value<{ items: unknown[] }>(
        await f.employee.query(refs.self, { pinnedOnly: true }),
      ).items,
    ).toHaveLength(1);
    expect(
      value(
        await f.employee.mutation(refs.receipt, {
          requestId: "ack_pinned_original",
          announcementId: draft.documentId,
          contentVersion: 2,
          action: "ACKNOWLEDGE",
        }),
      ),
    ).toMatchObject({ written: true });
  });
  it("creates a revised draft without rewriting published history or old receipts", async () => {
    const f = await fixture(),
      draft = await f.draft();
    await f.publish(draft.documentId);
    const revised = value<{ documentId: string }>(
      await f.admin.mutation(refs.draft, {
        requestId: "revision_draft_new",
        expectedVersion: 0,
        replacesId: draft.documentId,
        title: "Revised briefing",
        body: "A new confirmed version.",
        audience: { mode: "ORGANIZATION", warehouseIds: [] },
        acknowledgmentRequired: false,
        pinned: false,
      }),
    );
    expect(revised.documentId).not.toBe(draft.documentId);
    await f.publish(revised.documentId, 1, "revision_publication_new");
    const detail = value<{ announcement: { body: string } }>(
      await f.employee.query(refs.detail, { announcementId: draft.documentId }),
    );
    expect(detail.announcement.body).toBe(
      "Read the confirmed safety briefing.",
    );
    expect(
      value<{ items: unknown[] }>(await f.employee.query(refs.self, {})).items,
    ).toHaveLength(2);
  });
  it("does not let a scoped HR publisher widen the audience or use another site's IDs", async () => {
    const f = await fixture();
    await f.world.t.run((ctx) =>
      ctx.db.patch(f.authorization.identities.membershipA, {
        scopeMode: "WAREHOUSE_SCOPED",
      }),
    );
    const args = {
      requestId: "scoped_org_widening",
      expectedVersion: 0,
      title: "Announcement",
      body: "Confirmed content",
      acknowledgmentRequired: false,
      audience: { mode: "ORGANIZATION", warehouseIds: [] },
    };
    expect(value(await f.admin.mutation(refs.draft, args))).toMatchObject({
      written: false,
      error: { code: "ANNOUNCEMENT_AUDIENCE_INVALID" },
    });
    expect(
      value(
        await f.admin.mutation(refs.draft, {
          ...args,
          requestId: "scoped_other_site",
          audience: {
            mode: "SITES",
            warehouseIds: [f.world.warehouses.bravoA],
          },
        }),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "ANNOUNCEMENT_AUDIENCE_INVALID" },
    });
    const own = await f.draft([f.world.warehouses.alphaA]);
    expect(await f.publish(own.documentId)).toMatchObject({
      written: true,
      recipientCount: 1,
    });
  });
  it("refuses stale drafts and reusing a confirmed request identity for changed content", async () => {
    const f = await fixture(),
      draft = await f.draft();
    const args = {
      requestId: "edit_draft_fixed_request",
      announcementId: draft.documentId,
      expectedVersion: 1,
      title: "Edited title",
      body: "Edited body",
      audience: { mode: "ORGANIZATION", warehouseIds: [] },
      acknowledgmentRequired: false,
    };
    expect(value(await f.admin.mutation(refs.draft, args))).toMatchObject({
      written: true,
      version: 2,
    });
    expect(
      value(
        await f.admin.mutation(refs.draft, {
          ...args,
          requestId: "edit_draft_stale",
        }),
      ),
    ).toMatchObject({ written: false, error: { code: "ANNOUNCEMENT_STALE" } });
    expect(
      value(
        await f.admin.mutation(refs.draft, {
          ...args,
          title: "Changed payload",
        }),
      ),
    ).toMatchObject({ written: false });
  });
  it("deduplicates delivery by employee and durable event key", async () => {
    const f = await fixture(),
      draft = await f.draft();
    await f.world.t.run((ctx) =>
      ctx.db.insert("hrNotifications", {
        orgId: f.world.orgA,
        employeeId: f.other,
        announcementId: draft.documentId,
        event: "ANNOUNCEMENT_PUBLISHED",
        title: "Warehouse update",
        eventKey: `announcement:${draft.documentId}:2`,
        unread: true,
        createdAt: 1,
      }),
    );
    await f.publish(draft.documentId);
    const rows = await f.world.t.run((ctx) =>
      ctx.db.query("hrNotifications").collect(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.employeeId === f.other)).toHaveLength(1);
  });
  it("applies the activated audience and acknowledgment rules on the server", async () => {
    const f = await fixture();
    await f.world.t.run(async (ctx) => {
      const policy = await ctx.db.query("hrPolicyVersions").first();
      await ctx.db.patch(policy!._id, {
        config: {
          ...thailandDefaults(),
          announcementAudience: "SITE",
          announcementAcknowledgment: true,
        },
      });
    });
    const org = await f.draft();
    expect(await f.publish(org.documentId)).toMatchObject({
      written: false,
      error: { code: "ANNOUNCEMENT_AUDIENCE_INVALID" },
    });
    const site = await f.draft([f.world.warehouses.alphaA]);
    await f.publish(site.documentId, 1, "site_policy_publication");
    expect(
      value(
        await f.admin.query(refs.detail, { announcementId: site.documentId }),
      ),
    ).toMatchObject({ announcement: { acknowledgmentRequired: true } });
  });
  it("excludes inactive staff from the frozen publication audience", async () => {
    const f = await fixture();
    await f.world.t.run((ctx) => ctx.db.patch(f.other, { status: "INACTIVE" }));
    const draft = await f.draft();
    expect(await f.publish(draft.documentId)).toMatchObject({
      written: true,
      recipientCount: 1,
    });
    expect(value(await f.employee.query(refs.self, {}))).toMatchObject({
      items: [],
    });
    expect(value(await f.employee.query(refs.list, {}))).toMatchObject({
      unreadCount: 0,
    });
  });
  it("does not let employees invoke publication or receipt administration", async () => {
    const f = await fixture(),
      draft = await f.draft();
    expect(
      await f.employee.mutation(refs.publish, {
        requestId: "employee_publish_denied",
        announcementId: draft.documentId,
        expectedVersion: 1,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await f.employee.query(ref("query", "hr/announcements:receipts"), {
        announcementId: draft.documentId,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await f.world.t.run((ctx) =>
        ctx.db.query("hrAnnouncementRecipients").collect(),
      ),
    ).toEqual([]);
  });
});

afterEach(() => vi.useRealTimers());
describe("durable Bangkok announcement scheduling", () => {
  const now = Date.UTC(2026, 9, 12, 1);
  const publishAt = Date.UTC(2026, 9, 12, 2);
  async function planned() {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const f = await fixture();
    const draft = await f.draft();
    const saved = value<{ written: true; version: number; publishAt: number }>(
      await f.admin.mutation(refs.schedule, {
        requestId: "schedule-ann",
        announcementId: draft.documentId,
        expectedVersion: draft.version,
        publishDate: "2026-10-12",
        publishTime: "09:00",
      }),
    );
    expect(saved).toMatchObject({ written: true, publishAt });
    return { ...f, draft, scheduledVersion: saved.version };
  }
  it("hides scheduled notices, freezes recipients only at publication, and delivers exactly once", async () => {
    const f = await planned();
    expect(
      value<{ items: unknown[] }>(await f.employee.query(refs.self, {})).items,
    ).toEqual([]);
    expect(
      value(
        await f.employee.query(refs.detail, {
          announcementId: f.draft.documentId,
        }),
      ),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(
      await f.world.t.mutation(refs.due, {
        announcementId: f.draft.documentId,
        expectedVersion: f.scheduledVersion,
      }),
    ).toEqual({ skipped: true });
    await f.world.t.run((ctx) => ctx.db.patch(f.other, { status: "INACTIVE" }));
    vi.setSystemTime(publishAt);
    expect(
      await f.world.t.mutation(refs.due, {
        announcementId: f.draft.documentId,
        expectedVersion: f.scheduledVersion,
      }),
    ).toEqual({ published: true });
    expect(
      await f.world.t.mutation(refs.due, {
        announcementId: f.draft.documentId,
        expectedVersion: f.scheduledVersion,
      }),
    ).toEqual({ skipped: true });
    const recipients = await f.world.t.run((ctx) =>
      ctx.db.query("hrAnnouncementRecipients").collect(),
    );
    expect(recipients).toHaveLength(1);
    expect(recipients[0]!.employeeId).toBe(f.own);
    expect(
      await f.world.t.run((ctx) => ctx.db.query("hrNotifications").collect()),
    ).toHaveLength(1);
  });
  it("runs the persisted due publication through the actual registered scheduler without client authentication", async () => {
    const f = await planned();
    await f.world.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      await f.world.t.run((ctx) => ctx.db.get(f.draft.documentId)),
    ).toMatchObject({
      status: "PUBLISHED",
      publishedAt: publishAt,
      recipientCount: 2,
    });
    expect(
      value<{ items: unknown[] }>(await f.employee.query(refs.self, {})).items,
    ).toHaveLength(1);
  });
  it("deduplicates scheduling and prevents edited arguments from reusing its operation ID", async () => {
    const f = await planned();
    const args = {
      requestId: "schedule-ann",
      announcementId: f.draft.documentId,
      expectedVersion: f.draft.version,
      publishDate: "2026-10-12",
      publishTime: "09:00",
    };
    expect(value(await f.admin.mutation(refs.schedule, args))).toMatchObject({
      written: true,
      replayed: true,
      version: f.scheduledVersion,
    });
    expect(
      value(
        await f.admin.mutation(refs.schedule, {
          ...args,
          publishTime: "10:00",
        }),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "REQUEST_ARGUMENT_CONFLICT" },
    });
    expect(
      await f.world.t.run((ctx) =>
        ctx.db.query("hrAnnouncementRecipients").collect(),
      ),
    ).toEqual([]);
  });
  it("cancels with scoped optimistic version and makes a stale due job harmless", async () => {
    const f = await planned();
    expect(
      await f.employee.mutation(refs.cancel, {
        requestId: "foreign-cancel",
        announcementId: f.draft.documentId,
        expectedVersion: f.scheduledVersion,
      }),
    ).toMatchObject({ ok: false });
    expect(
      value(
        await f.admin.mutation(refs.cancel, {
          requestId: "cancel-ann",
          announcementId: f.draft.documentId,
          expectedVersion: f.scheduledVersion,
        }),
      ),
    ).toMatchObject({ written: true });
    vi.setSystemTime(publishAt);
    expect(
      await f.world.t.mutation(refs.due, {
        announcementId: f.draft.documentId,
        expectedVersion: f.scheduledVersion,
      }),
    ).toEqual({ skipped: true });
    expect(
      (await f.world.t.run((ctx) => ctx.db.get(f.draft.documentId)))!.status,
    ).toBe("DRAFT");
    expect(
      await f.world.t.run((ctx) => ctx.db.query("hrNotifications").collect()),
    ).toEqual([]);
  });
  it("rechecks policy at due time and exposes a recoverable failure without any partial fanout", async () => {
    const f = await planned();
    await f.world.t.run(async (ctx) => {
      const policy = await ctx.db.query("hrPolicyVersions").first();
      await ctx.db.delete(policy!._id);
    });
    vi.setSystemTime(publishAt);
    expect(
      await f.world.t.mutation(refs.due, {
        announcementId: f.draft.documentId,
        expectedVersion: f.scheduledVersion,
      }),
    ).toEqual({ published: false, code: "POLICY_NOT_ACTIVE" });
    const row = await f.world.t.run((ctx) => ctx.db.get(f.draft.documentId));
    expect(row).toMatchObject({
      status: "SCHEDULED",
      scheduleError: "POLICY_NOT_ACTIVE",
      scheduleFailedAt: publishAt,
    });
    expect(
      await f.world.t.run((ctx) =>
        ctx.db.query("hrAnnouncementRecipients").collect(),
      ),
    ).toEqual([]);
    expect(
      value(
        await f.admin.mutation(refs.cancel, {
          requestId: "recover-ann",
          announcementId: f.draft.documentId,
          expectedVersion: row!.version,
        }),
      ),
    ).toMatchObject({ written: true });
  });
  it("refuses a revoked publisher at execution and rejects invalid or past Bangkok scheduling", async () => {
    const f = await planned();
    await f.world.t.run((ctx) =>
      ctx.db.patch(f.authorization.identities.membershipA, {
        status: "REVOKED",
      }),
    );
    vi.setSystemTime(publishAt);
    expect(
      await f.world.t.mutation(refs.due, {
        announcementId: f.draft.documentId,
        expectedVersion: f.scheduledVersion,
      }),
    ).toEqual({ published: false, code: "SCHEDULE_PUBLISHER_UNAVAILABLE" });
    const fresh = await fixture();
    const draft = await fresh.draft();
    const invalidTimes: readonly (readonly [string, string])[] = [
      ["2026-02-30", "09:00"],
      ["2026-10-12", "08:00"],
      ["2026-10-13", "25:00"],
    ];
    for (const [publishDate, publishTime] of invalidTimes)
      expect(
        value(
          await fresh.admin.mutation(refs.schedule, {
            requestId: `invalid-${publishDate}-${publishTime.replace(":", "_")}`,
            announcementId: draft.documentId,
            expectedVersion: draft.version,
            publishDate,
            publishTime,
          }),
        ),
      ).toMatchObject({
        written: false,
        error: { code: "ANNOUNCEMENT_SCHEDULE_INVALID" },
      });
  });
});
