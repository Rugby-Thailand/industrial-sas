import { makeFunctionReference } from "convex/server";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, it } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import {
  type HR_NOTIFICATION_EVENTS,
  MAX_QUICK_MENU_PINS,
  MAX_QUICK_MENU_VERSION,
  UNREAD_BADGE_CAP,
  type HrUnreadSummary,
  type QuickMenuCurrent,
  type QuickMenuReceiptStatus,
  type QuickMenuSaveResult,
} from "../../convex/model/home/quickMenu";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  seedSecondActorForOrgA,
  storedAuditEvents,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

const ref = <K extends "query" | "mutation">(_kind: K, name: string) =>
  makeFunctionReference<K, Record<string, unknown>, unknown>(name);
const currentRef = ref("query", "workspace/quickMenus:current");
const saveRef = ref("mutation", "workspace/quickMenus:save");
const receiptRef = ref("query", "workspace/quickMenus:receiptStatus");
const unreadRef = ref("query", "hr/notifications:unreadSummary");

const ACTOR = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const ACTOR_B = { subject: "user_fixture_a", org_id: "org_fixture_b" };
const SCOPE = { clerkOrgId: "org_fixture_a", clerkUserId: "user_fixture_a" };

const HR_SELF_KEYS = [
  "hr.today",
  "hr.time",
  "hr.requests",
  "hr.holidays",
  "hr.leave",
  "hr.announcements",
  "hr.notifications",
  "hr.payslips",
  "hr.profile",
];

function value<T>(outcome: unknown): T {
  expect(outcome).toMatchObject({ ok: true });
  return (outcome as { value: T }).value;
}

async function thrownData(operation: Promise<unknown>): Promise<Value> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError);
    return (error as ConvexError<Value>).data;
  }
  throw new Error("Expected the call to throw.");
}

async function fixture(roleA = "HR_EMPLOYEE") {
  const world = await createConvexTenantWorld({
    "../convex/workspace/quickMenus.ts": () =>
      import("../../convex/workspace/quickMenus"),
    "../convex/hr/notifications.ts": () =>
      import("../../convex/hr/notifications"),
  });
  await seedConvexAuthorization(world, {
    roleA,
    roleB: "SUPERVISOR",
    extraRoles: [
      {
        key: "WAREHOUSE_AND_HR",
        permissionCodes: [
          "masterData.warehouse.read",
          "masterData.storageLayout.read",
          "hr.self.access",
        ],
      },
      { key: "NOTHING", permissionCodes: [] },
      { key: "CUSTOMER_READER", permissionCodes: ["masterData.customer.read"] },
    ],
  });
  return world;
}

const preferences = (world: ConvexTenantWorld) =>
  world.t.run((ctx) => ctx.db.query("homeQuickMenuPreferences").collect());
const receipts = (world: ConvexTenantWorld) =>
  world.t.run((ctx) => ctx.db.query("idempotencyRecords").collect());

async function save(
  world: ConvexTenantWorld,
  args: {
    requestId: string;
    expectedVersion: number;
    pinnedKeys: string[];
    expectedActorUserId?: string;
    expectedClerkScope?: typeof SCOPE;
  },
  identity = ACTOR,
) {
  return value<QuickMenuSaveResult>(
    await world.t.withIdentity(identity).mutation(saveRef, {
      expectedClerkScope: SCOPE,
      expectedActorUserId: world.userA,
      ...args,
    }),
  );
}

describe("workspace/quickMenus:current", () => {
  it("returns permission-filtered defaults and the session scope without writing", async () => {
    const world = await fixture();
    const current = value<QuickMenuCurrent>(
      await world.t.withIdentity(ACTOR).query(currentRef, {}),
    );
    expect(current).toEqual({
      clerkScope: SCOPE,
      actorUserId: world.userA,
      availableKeys: HR_SELF_KEYS,
      pinnedKeys: [
        "hr.announcements",
        "hr.leave",
        "hr.payslips",
        "hr.notifications",
        "hr.today",
        "hr.time",
      ],
      customized: false,
      version: 0,
      maxVersion: MAX_QUICK_MENU_VERSION,
    });
    expect(await preferences(world)).toEqual([]);
    expect(await storedAuditEvents(world, world.orgA)).toEqual([]);
  });

  it("pins Today alongside warehouse intake and Notifications until the member saves a menu", async () => {
    const world = await fixture("WAREHOUSE_AND_HR");
    const current = async () =>
      value<QuickMenuCurrent>(
        await world.t.withIdentity(ACTOR).query(currentRef, {}),
      );

    expect(await current()).toMatchObject({
      pinnedKeys: [
        "planner.finishedGoods",
        "planner.jobScan",
        "hr.announcements",
        "hr.leave",
        "hr.today",
        "hr.notifications",
      ],
      customized: false,
    });
    expect((await current()).availableKeys).toContain("hr.payslips");

    const pinnedKeys = ["hr.payslips", "planner.jobScan"];
    expect(
      await save(world, {
        requestId: "mixed-role-menu-saved",
        expectedVersion: 0,
        pinnedKeys,
      }),
    ).toMatchObject({ ok: true });
    expect(await current()).toMatchObject({ pinnedKeys, customized: true });

    expect(
      await save(world, {
        requestId: "mixed-role-menu-empty",
        expectedVersion: 1,
        pinnedKeys: [],
      }),
    ).toMatchObject({ ok: true });
    expect(await current()).toMatchObject({ pinnedKeys: [], customized: true });
  });

  it("opens Home through any module entry permission and filters per key", async () => {
    const world = await fixture("SUPERVISOR");
    const current = value<QuickMenuCurrent>(
      await world.t.withIdentity(ACTOR).query(currentRef, {}),
    );
    expect(current.availableKeys).toEqual([
      "planner.finishedGoods",
      "planner.jobScan",
      "planner.jobScanRecords",
      "planner.storageLayouts",
    ]);
    expect(current.pinnedKeys).toEqual(current.availableKeys);
  });

  it("opens Home with the Customers shortcut for an organization-only customer reader", async () => {
    const world = await fixture("CUSTOMER_READER");
    expect(
      value<QuickMenuCurrent>(
        await world.t.withIdentity(ACTOR).query(currentRef, {}),
      ),
    ).toMatchObject({
      availableKeys: ["planner.customers"],
      pinnedKeys: ["planner.customers"],
    });
  });

  it("denies a member without any module entry permission", async () => {
    const world = await fixture("NOTHING");
    expect(
      await world.t.withIdentity(ACTOR).query(currentRef, {}),
    ).toMatchObject({ ok: false, denial: { code: "AUTHORIZATION_DENIED" } });
  });

  it("refuses another session's scope and an unbounded retry attempt before reading", async () => {
    const world = await fixture();
    expect(
      await thrownData(
        world.t.withIdentity(ACTOR).query(currentRef, {
          expectedClerkScope: { ...SCOPE, clerkOrgId: "org_fixture_b" },
        }),
      ),
    ).toMatchObject({ code: "TENANT_SCOPE_MISMATCH" });
    expect(
      await thrownData(
        world.t.withIdentity(ACTOR).query(currentRef, {
          expectedClerkScope: { ...SCOPE, clerkUserId: "user_other" },
        }),
      ),
    ).toMatchObject({ code: "TENANT_SCOPE_MISMATCH" });
    for (const readRetryAttempt of [-1, 1.5, 1_001])
      expect(
        await thrownData(
          world.t.withIdentity(ACTOR).query(currentRef, { readRetryAttempt }),
        ),
      ).toMatchObject({ code: "INVALID_INPUT", field: "readRetryAttempt" });
    expect(
      value(
        await world.t.withIdentity(ACTOR).query(currentRef, {
          expectedClerkScope: SCOPE,
          readRetryAttempt: 3,
        }),
      ),
    ).toMatchObject({ clerkScope: SCOPE });
  });
});

describe("workspace/quickMenus:save", () => {
  it("writes once, audits the winning code and records an actor-owned receipt", async () => {
    const world = await fixture();
    const saved = await save(world, {
      requestId: "home-save-first",
      expectedVersion: 0,
      pinnedKeys: ["hr.payslips", "hr.today"],
    });
    expect(saved).toMatchObject({
      ok: true,
      replayed: false,
      version: 1,
      pinnedKeys: ["hr.payslips", "hr.today"],
    });
    const audits = await storedAuditEvents(world, world.orgA);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      outcome: "ALLOWED",
      permissionCode: "hr.self.access",
      entityTable: "homeQuickMenuPreferences",
    });
    const [receipt] = await receipts(world);
    expect(receipt).toMatchObject({
      operation: `home.quickMenu.save:${world.userA}`,
      actorUserId: world.userA,
      resultRef: (saved as { documentId: string }).documentId,
    });
    expect(
      value(await world.t.withIdentity(ACTOR).query(currentRef, {})),
    ).toMatchObject({
      customized: true,
      version: 1,
      pinnedKeys: ["hr.payslips", "hr.today"],
    });
    // Another organization of the same user keeps its own preferences.
    expect(
      value(await world.t.withIdentity(ACTOR_B).query(currentRef, {})),
    ).toMatchObject({ customized: false, version: 0 });
  });

  it("replays verified receipts, even superseded ones, without writing preferences", async () => {
    const world = await fixture();
    const first = {
      requestId: "home-save-one",
      expectedVersion: 0,
      pinnedKeys: ["hr.leave"],
    };
    await save(world, first);
    await save(world, {
      requestId: "home-save-two",
      expectedVersion: 1,
      pinnedKeys: ["hr.time", "hr.leave"],
    });
    const [before] = await preferences(world);
    const receiptCount = (await receipts(world)).length;
    const auditCount = (await storedAuditEvents(world, world.orgA)).length;

    expect(await save(world, first)).toMatchObject({
      ok: true,
      replayed: true,
      version: 1,
      pinnedKeys: ["hr.leave"],
    });
    const [after] = await preferences(world);
    expect(after).toEqual(before);
    expect(after!.version).toBe(2);
    expect(await receipts(world)).toHaveLength(receiptCount);
    const audits = await storedAuditEvents(world, world.orgA);
    expect(audits).toHaveLength(auditCount + 1);
    expect(audits[0]).toMatchObject({ outcome: "ALLOWED" });
  });

  it("refuses conflicting reuse, stale versions, unavailable pins and bad bounds", async () => {
    const world = await fixture();
    await save(world, {
      requestId: "home-save-reuse",
      expectedVersion: 0,
      pinnedKeys: ["hr.leave"],
    });
    expect(
      await save(world, {
        requestId: "home-save-reuse",
        expectedVersion: 0,
        pinnedKeys: ["hr.time"],
      }),
    ).toEqual({ ok: false, code: "REQUEST_ARGUMENT_CONFLICT" });
    expect(
      await save(world, {
        requestId: "home-save-stale",
        expectedVersion: 0,
        pinnedKeys: [],
      }),
    ).toEqual({ ok: false, code: "VERSION_STALE", currentVersion: 1 });
    expect(
      await save(world, {
        requestId: "home-save-forbidden",
        expectedVersion: 1,
        pinnedKeys: ["hr.leave", "planner.finishedGoods"],
      }),
    ).toEqual({
      ok: false,
      code: "PIN_NOT_AVAILABLE",
      reason: "planner.finishedGoods",
    });
    for (const [pinnedKeys, reason] of [
      [["hr.leave", "hr.leave"], "DUPLICATE_KEY"],
      [["/hr/leave"], "UNKNOWN_KEY"],
      [
        Array.from({ length: MAX_QUICK_MENU_PINS + 1 }, () => "hr.leave"),
        "TOO_MANY",
      ],
    ] as const)
      expect(
        await save(world, {
          requestId: "home-save-invalid",
          expectedVersion: 1,
          pinnedKeys: [...pinnedKeys],
        }),
      ).toEqual({ ok: false, code: "PINNED_KEYS_INVALID", reason });
    expect(
      await save(world, {
        requestId: "bad id!",
        expectedVersion: 1,
        pinnedKeys: [],
      }),
    ).toEqual({ ok: false, code: "REQUEST_ID_INVALID" });
    expect(
      await save(world, {
        requestId: "home-save-version",
        expectedVersion: -1,
        pinnedKeys: [],
      }),
    ).toEqual({ ok: false, code: "VERSION_INVALID" });
    expect((await preferences(world))[0]).toMatchObject({
      version: 1,
      pinnedKeys: ["hr.leave"],
    });
  });

  it("stores an empty selection as customized", async () => {
    const world = await fixture();
    await save(world, {
      requestId: "home-save-empty",
      expectedVersion: 0,
      pinnedKeys: [],
    });
    expect(
      value(await world.t.withIdentity(ACTOR).query(currentRef, {})),
    ).toMatchObject({ customized: true, pinnedKeys: [], version: 1 });
  });

  it("rejects mismatched scope or actor before authorization: no audit, no write", async () => {
    const world = await fixture();
    const base = {
      requestId: "home-save-scope",
      expectedVersion: 0,
      pinnedKeys: ["hr.leave"],
    };
    expect(
      await thrownData(
        world.t.withIdentity(ACTOR).mutation(saveRef, {
          ...base,
          expectedClerkScope: { ...SCOPE, clerkOrgId: "org_fixture_b" },
          expectedActorUserId: world.userA,
        }),
      ),
    ).toMatchObject({ code: "TENANT_SCOPE_MISMATCH" });
    const other = await seedSecondActorForOrgA(world, "HR_EMPLOYEE");
    expect(
      await thrownData(
        world.t.withIdentity(ACTOR).mutation(saveRef, {
          ...base,
          expectedClerkScope: SCOPE,
          expectedActorUserId: other.userId,
        }),
      ),
    ).toMatchObject({ code: "ACTOR_SCOPE_MISMATCH" });
    expect(await storedAuditEvents(world, world.orgA)).toEqual([]);
    expect(await preferences(world)).toEqual([]);
    expect(await receipts(world)).toEqual([]);
  });

  it("namespaces request IDs per actor", async () => {
    const world = await fixture();
    const other = await seedSecondActorForOrgA(world, "HR_EMPLOYEE");
    await save(world, {
      requestId: "home-save-shared",
      expectedVersion: 0,
      pinnedKeys: ["hr.leave"],
    });
    expect(
      value(
        await world.t
          .withIdentity({ subject: other.clerkUserId, org_id: "org_fixture_a" })
          .mutation(saveRef, {
            requestId: "home-save-shared",
            expectedClerkScope: {
              clerkOrgId: "org_fixture_a",
              clerkUserId: other.clerkUserId,
            },
            expectedActorUserId: other.userId,
            expectedVersion: 0,
            pinnedKeys: ["hr.time"],
          }),
      ),
    ).toMatchObject({ ok: true, replayed: false, pinnedKeys: ["hr.time"] });
    expect(await preferences(world)).toHaveLength(2);
  });

  it("audits one denial with the first alternative when no module is granted", async () => {
    const world = await fixture("NOTHING");
    expect(
      await world.t.withIdentity(ACTOR).mutation(saveRef, {
        requestId: "home-save-denied",
        expectedClerkScope: SCOPE,
        expectedActorUserId: world.userA,
        expectedVersion: 0,
        pinnedKeys: [],
      }),
    ).toMatchObject({ ok: false });
    const audits = await storedAuditEvents(world, world.orgA);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      outcome: "DENIED",
      permissionCode: "masterData.warehouse.read",
      denialReason: "NO_PERMISSION",
    });
  });
});

describe("workspace/quickMenus:receiptStatus", () => {
  const receipt = (
    world: ConvexTenantWorld,
    args: { requestId: string; expectedVersion: number; pinnedKeys: string[] },
  ) =>
    world.t
      .withIdentity(ACTOR)
      .query(receiptRef, {
        expectedClerkScope: SCOPE,
        expectedActorUserId: world.userA,
        ...args,
      })
      .then((outcome) => value<QuickMenuReceiptStatus>(outcome));

  it("confirms a lost write at the version cap with a pure read", async () => {
    const world = await fixture();
    await world.t.run((ctx) =>
      ctx.db.insert("homeQuickMenuPreferences", {
        orgId: world.orgA,
        userId: world.userA,
        pinnedKeys: [],
        version: MAX_QUICK_MENU_VERSION - 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const last = {
      requestId: "home-save-last",
      expectedVersion: MAX_QUICK_MENU_VERSION - 1,
      pinnedKeys: ["hr.leave"],
    };
    expect(await receipt(world, last)).toEqual({ status: "NOT_FOUND" });
    const saved = await save(world, last);
    expect(saved).toMatchObject({ ok: true, version: MAX_QUICK_MENU_VERSION });
    expect(
      await save(world, {
        requestId: "home-save-over",
        expectedVersion: MAX_QUICK_MENU_VERSION,
        pinnedKeys: [],
      }),
    ).toEqual({ ok: false, code: "VERSION_LIMIT" });

    const auditCount = (await storedAuditEvents(world, world.orgA)).length;
    const receiptCount = (await receipts(world)).length;
    expect(await receipt(world, last)).toEqual({
      status: "CONFIRMED",
      documentId: (saved as { documentId: string }).documentId,
      version: MAX_QUICK_MENU_VERSION,
    });
    expect(await receipt(world, { ...last, pinnedKeys: ["hr.time"] })).toEqual({
      status: "CONFLICT",
    });
    expect(await receipt(world, { ...last, requestId: "x" })).toEqual({
      status: "INVALID_INPUT",
    });
    expect(await storedAuditEvents(world, world.orgA)).toHaveLength(auditCount);
    expect(await receipts(world)).toHaveLength(receiptCount);
  });

  it("applies the scope and actor preconditions", async () => {
    const world = await fixture();
    expect(
      await thrownData(
        world.t.withIdentity(ACTOR).query(receiptRef, {
          requestId: "home-save-any",
          expectedClerkScope: SCOPE,
          expectedActorUserId: "not-the-actor",
          expectedVersion: 0,
          pinnedKeys: [],
        }),
      ),
    ).toMatchObject({ code: "ACTOR_SCOPE_MISMATCH" });
  });
});

describe("hr/notifications:unreadSummary", () => {
  async function linked(world: ConvexTenantWorld) {
    return await world.t.run(async (ctx) => {
      const employee = (code: string, userId?: Id<"users">) =>
        ctx.db.insert("hrEmployees", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          code,
          displayName: code,
          ...(userId ? { userId } : {}),
          employmentStartDate: "2020-01-01",
          status: "ACTIVE",
          version: 1,
          createdAt: 1,
          createdByUserId: world.userA,
          updatedAt: 1,
          updatedByUserId: world.userA,
        });
      return {
        own: await employee("OWN", world.userA),
        other: await employee("OTHER"),
      };
    });
  }
  const notify = (
    world: ConvexTenantWorld,
    employeeId: Id<"hrEmployees">,
    event: (typeof HR_NOTIFICATION_EVENTS)[number],
    count: number,
    unread = true,
  ) =>
    world.t.run(async (ctx) => {
      for (let index = 0; index < count; index++)
        await ctx.db.insert("hrNotifications", {
          orgId: world.orgA,
          employeeId,
          event,
          title: event,
          eventKey: `${event}:${employeeId}:${unread}:${index}`,
          unread,
          createdAt: index,
        });
    });

  it("reports an unlinked member as zero with the session scope", async () => {
    const world = await fixture();
    expect(
      value(await world.t.withIdentity(ACTOR).query(unreadRef, {})),
    ).toEqual({
      clerkScope: SCOPE,
      linked: false,
      counts: {
        ANNOUNCEMENT_PUBLISHED: 0,
        LEAVE_DECIDED: 0,
        CORRECTION_DECIDED: 0,
        PAYSLIP_PUBLISHED: 0,
      },
      total: 0,
    });
  });

  it("counts only the actor's unread rows per event, capped per event", async () => {
    const world = await fixture();
    const { own, other } = await linked(world);
    await notify(world, own, "ANNOUNCEMENT_PUBLISHED", 3);
    await notify(world, own, "ANNOUNCEMENT_PUBLISHED", 2, false);
    await notify(world, own, "PAYSLIP_PUBLISHED", UNREAD_BADGE_CAP + 5);
    await notify(world, own, "LEAVE_DECIDED", 1);
    await notify(world, other, "LEAVE_DECIDED", 4);
    const summary = value<HrUnreadSummary>(
      await world.t.withIdentity(ACTOR).query(unreadRef, {
        expectedClerkScope: SCOPE,
        readRetryAttempt: 0,
      }),
    );
    expect(summary).toEqual({
      clerkScope: SCOPE,
      linked: true,
      counts: {
        ANNOUNCEMENT_PUBLISHED: 3,
        LEAVE_DECIDED: 1,
        CORRECTION_DECIDED: 0,
        PAYSLIP_PUBLISHED: UNREAD_BADGE_CAP,
      },
      total: 4 + UNREAD_BADGE_CAP,
    });
  });

  it("refuses another session's scope", async () => {
    const world = await fixture();
    expect(
      await thrownData(
        world.t.withIdentity(ACTOR).query(unreadRef, {
          expectedClerkScope: { ...SCOPE, clerkOrgId: "org_fixture_b" },
        }),
      ),
    ).toMatchObject({ code: "TENANT_SCOPE_MISMATCH" });
  });
});
