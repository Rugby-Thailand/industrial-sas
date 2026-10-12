import type { GenericMutationCtx } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import * as announcements from "../../convex/hr/announcements";
import * as policies from "../../convex/hr/policies";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

type Runtime = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};
type Result = {
  written?: boolean;
  documentId?: string;
  version?: number;
  replayed?: boolean;
  items?: { _id: string }[];
  error?: { code: string };
};
async function call(world: ConvexTenantWorld, fn: unknown, args: unknown) {
  const outcome = (await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run((ctx) =>
      (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args),
    )) as { ok: boolean; value: Result };
  expect(outcome.ok).toBe(true);
  return outcome.value;
}

async function lateSite() {
  const world = await createConvexTenantWorld();
  const auth = await seedConvexAuthorization(world, { roleA: "HR_ADMIN" });
  await world.t.run(async (ctx) => {
    for (let index = 0; index < 60; index += 1) {
      const warehouseId = await ctx.db.insert("warehouses", {
        orgId: world.orgA,
        code: `AUDIT-${String(index).padStart(3, "0")}`,
        name: `Audit branch ${index}`,
        status: "ACTIVE",
      });
      await ctx.db.insert("membershipWarehouses", {
        orgId: world.orgA,
        membershipId: auth.identities.membershipA,
        warehouseId,
      });
    }
  });
  const grants = await world.t.run((ctx) =>
    ctx.db
      .query("membershipWarehouses")
      .withIndex("by_orgId_membershipId_warehouseId", (q) =>
        q
          .eq("orgId", world.orgA)
          .eq("membershipId", auth.identities.membershipA),
      )
      .collect(),
  );
  expect(grants).toHaveLength(61);
  // The actual grant index, rather than creation/code order, determines
  // which grant is outside the authorization preload.
  const late = grants[55]!;
  return { world, grants, late };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T04:00:00Z"));
});
afterEach(() => vi.useRealTimers());

it("creates and manages a late-site announcement, while revocation and audience limits still apply", async () => {
  const { world, grants, late } = await lateSite();
  const draft = {
    requestId: "audit-late-announcement-create",
    expectedVersion: 0,
    title: "Late branch briefing",
    body: "Read the confirmed safety briefing for this branch.",
    audience: { mode: "SITES", warehouseIds: [late.warehouseId] },
    acknowledgmentRequired: false,
  };
  const saved = await call(world, announcements.saveDraft, draft);
  expect(saved).toMatchObject({ written: true, version: 1 });
  const id = saved.documentId!;
  expect((await call(world, announcements.manage, {})).items).toEqual([
    expect.objectContaining({ _id: id }),
  ]);
  expect(await call(world, announcements.saveDraft, draft)).toMatchObject({
    written: true,
    replayed: true,
  });
  expect(
    await call(world, announcements.saveDraft, {
      ...draft,
      requestId: "audit-late-announcement-edit",
      announcementId: id,
      expectedVersion: 1,
      title: "Updated late branch briefing",
    }),
  ).toMatchObject({ written: true, version: 2 });

  for (const [requestId, audience] of [
    [
      "audit-outside-audience",
      { mode: "SITES", warehouseIds: [world.warehouses.bravoA] },
    ],
    [
      "audit-foreign-audience",
      { mode: "SITES", warehouseIds: [world.warehouses.alphaB] },
    ],
    ["audit-org-audience", { mode: "ORGANIZATION", warehouseIds: [] }],
    [
      "audit-large-audience",
      {
        mode: "SITES",
        warehouseIds: grants.slice(0, 51).map((grant) => grant.warehouseId),
      },
    ],
  ] as const)
    expect(
      await call(world, announcements.saveDraft, {
        ...draft,
        requestId,
        audience,
      }),
    ).toMatchObject({
      written: false,
      error: { code: "ANNOUNCEMENT_AUDIENCE_INVALID" },
    });

  await world.t.run((ctx) => ctx.db.delete(late._id));
  expect((await call(world, announcements.manage, {})).items).toEqual([]);
  expect(await call(world, announcements.saveDraft, draft)).toMatchObject({
    written: false,
    error: { code: "REPLAY_RESULT_UNAVAILABLE" },
  });
  expect(
    await call(world, announcements.saveDraft, {
      ...draft,
      requestId: "audit-revoked-announcement-edit",
      announcementId: id,
      expectedVersion: 2,
    }),
  ).toMatchObject({ written: false });
});

it("reconciles a late employee opening balance and refuses revoked replay or updates", async () => {
  const { world, late } = await lateSite();
  const employeeId = await world.t.run((ctx) =>
    ctx.db.insert("hrEmployees", {
      orgId: world.orgA,
      warehouseId: late.warehouseId,
      code: "LATE-OPENING",
      displayName: "Late opening employee",
      employmentStartDate: "2020-01-01",
      status: "ACTIVE",
      version: 1,
      createdAt: 1,
      createdByUserId: world.userA,
      updatedAt: 1,
      updatedByUserId: world.userA,
    }),
  );
  const opening = {
    requestId: "audit-late-opening",
    employeeId,
    type: "ANNUAL",
    asOf: "2026-10-13",
    granted: 6,
    used: 0,
    reserved: 0,
    paidUsed: 0,
    paidReserved: 0,
    sourceReference: "Signed HR opening register",
    expectedVersion: 0,
  };
  expect(await call(world, policies.reconcileOpening, opening)).toMatchObject({
    written: true,
    version: 1,
  });
  expect(await call(world, policies.reconcileOpening, opening)).toMatchObject({
    written: true,
    replayed: true,
  });
  await world.t.run((ctx) => ctx.db.delete(late._id));
  expect(await call(world, policies.reconcileOpening, opening)).toMatchObject({
    written: false,
    error: { code: "NOT_FOUND" },
  });
  expect(
    await call(world, policies.reconcileOpening, {
      ...opening,
      requestId: "audit-revoked-opening-update",
      expectedVersion: 1,
    }),
  ).toMatchObject({ written: false, error: { code: "NOT_FOUND" } });
});
