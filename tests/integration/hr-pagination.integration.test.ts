import type { GenericMutationCtx } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import * as access from "../../convex/hr/access";
import * as periods from "../../convex/hr/periods";
import * as review from "../../convex/hr/review";
import * as self from "../../convex/hr/self";
import * as setup from "../../convex/hr/setup";
import { fromLocal } from "../../convex/model/hr/calendar";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexAuthorizationWorld,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

/**
 * Actual-handler traversal of the paged HR lists beyond the former caps
 * (99 employees per site, 200 periods, 500 review items, 99 holidays, 200
 * members, 20 history events), with cursor binding, tamper and revocation.
 * Each call runs in its own transaction, as a deployed query does, so the
 * one-native-page-per-query rule is enforced by the harness.
 */

type Runtime = {
  _handler: (ctx: GenericMutationCtx<DataModel>, args: unknown) => Promise<any>;
};
const ADMIN = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const FOREIGN = { subject: "user_fixture_a", org_id: "org_fixture_b" };
const TODAY = "2026-10-09";
const SCHEDULE = {
  workDays: [1, 2, 3, 4, 5],
  startTime: "08:30",
  endTime: "17:30",
  endsNextDay: false,
  breakMinutes: 60,
};

const call = (
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  identity = ADMIN,
) =>
  world.t
    .withIdentity(identity)
    .run((ctx) =>
      (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args),
    );

async function value(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  identity = ADMIN,
) {
  const outcome = await call(world, fn, args, identity);
  expect(outcome).toMatchObject({ ok: true });
  return outcome.value;
}

/** Resolve one page as the client does: follow `scanning` until ready. */
async function readPage(
  world: ConvexTenantWorld,
  fn: unknown,
  args: Record<string, unknown>,
  cursor?: string,
  identity = ADMIN,
) {
  let scanCursor: string | undefined;
  let requests = 0;
  for (;;) {
    requests += 1;
    if (requests > 400) throw new Error("scan did not settle");
    const answer = await value(
      world,
      fn,
      {
        ...args,
        ...(cursor ? { cursor } : {}),
        ...(scanCursor ? { scanCursor } : {}),
      },
      identity,
    );
    if (answer.status !== "scanning") return { ...answer, requests };
    scanCursor = answer.scanCursor;
  }
}

async function traverse(
  world: ConvexTenantWorld,
  fn: unknown,
  args: Record<string, unknown>,
) {
  const pages: any[][] = [];
  const cursors: string[] = [];
  let requests = 0;
  let cursor: string | undefined;
  for (let guard = 0; guard < 200; guard += 1) {
    const page = await readPage(world, fn, args, cursor);
    requests += page.requests;
    expect(page.status).toBe("ready");
    expect(page.page.length).toBeLessThanOrEqual(
      (args.pageSize as number | undefined) ?? 20,
    );
    pages.push(page.page);
    if (page.isDone) return { pages, cursors, requests };
    cursor = page.continueCursor;
    cursors.push(cursor!);
  }
  throw new Error("traversal did not finish");
}

async function hrWorld(
  role = "HR_ADMIN",
): Promise<{ world: ConvexTenantWorld; auth: ConvexAuthorizationWorld }> {
  const world = await createConvexTenantWorld();
  const auth = await seedConvexAuthorization(world, {
    roleA: role,
    roleB: "HR_ADMIN",
  });
  return { world, auth };
}

const orgWide = (world: ConvexTenantWorld, auth: ConvexAuthorizationWorld) =>
  world.t.run((ctx) =>
    ctx.db.patch(auth.identities.membershipA, { scopeMode: "ORG_WIDE" }),
  );

async function employees(
  world: ConvexTenantWorld,
  warehouseId: Id<"warehouses">,
  count: number,
  prefix: string,
  extra: (index: number) => Record<string, unknown> = () => ({}),
  orgId: Id<"organizations"> = world.orgA,
) {
  return await world.t.run(async (ctx) => {
    const ids: Id<"hrEmployees">[] = [];
    for (let index = 0; index < count; index += 1)
      ids.push(
        await ctx.db.insert("hrEmployees", {
          orgId,
          warehouseId,
          code: `${prefix}-${String(index).padStart(3, "0")}`,
          displayName: `Employee ${prefix} ${index}`,
          employmentStartDate: "2026-01-01",
          status: index % 7 === 3 ? "INACTIVE" : "ACTIVE",
          schedule: SCHEDULE,
          version: 1,
          createdAt: 1,
          createdByUserId: world.userA,
          updatedAt: 1,
          updatedByUserId: world.userA,
          ...extra(index),
        }),
      );
    return ids;
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fromLocal(TODAY, 11 * 60, 420));
});
afterEach(() => vi.useRealTimers());

describe("employee registry pages", () => {
  it("traverses every employee of every authorized site beyond the former 99-per-site cap", async () => {
    const { world, auth } = await hrWorld();
    await orgWide(world, auth);
    const alpha = await employees(world, world.warehouses.alphaA, 150, "A");
    const bravo = await employees(world, world.warehouses.bravoA, 31, "B");
    await employees(world, world.warehouses.deltaA, 5, "D"); // inactive site
    await employees(
      world,
      world.warehouses.alphaB,
      5,
      "X",
      () => ({}),
      world.orgB,
    );

    // The former list stops at 99 per site and reports it.
    expect((await value(world, setup.listEmployees, {})).complete).toBe(false);

    const { pages } = await traverse(world, setup.employeesPage, {
      pageSize: 20,
    });
    const ids = pages.flat().map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...alpha, ...bravo]);
    expect(pages.slice(0, -1).every((page) => page.length === 20)).toBe(true);

    const fifty = await traverse(world, setup.employeesPage, { pageSize: 50 });
    expect(fifty.pages.flat().map((row) => row.id)).toEqual(ids);
  });

  it("finds a late search hit and applies site and status before paging", async () => {
    const { world, auth } = await hrWorld();
    await orgWide(world, auth);
    await employees(world, world.warehouses.alphaA, 140, "A", (index) =>
      index === 139 ? { displayName: "สมชาย Needle" } : {},
    );
    await employees(world, world.warehouses.bravoA, 3, "B");

    const hit = await traverse(world, setup.employeesPage, {
      pageSize: 20,
      search: "  needle ",
    });
    expect(hit.pages.flat().map((row) => row.code)).toEqual(["A-139"]);
    // Sparse search reads 99-row chunks, not one request per page of rows.
    expect(hit.requests).toBeLessThanOrEqual(3);
    const thai = await traverse(world, setup.employeesPage, {
      search: "สมชาย",
    });
    expect(thai.pages.flat().map((row) => row.code)).toEqual(["A-139"]);
    // A code fragment matches across sites, case-insensitively.
    const code = await traverse(world, setup.employeesPage, { search: "-00" });
    expect(code.pages.flat().map((row) => row.code)).toEqual([
      ...Array.from({ length: 10 }, (_, index) => `A-00${index}`),
      "B-000",
      "B-001",
      "B-002",
    ]);

    const inactive = await traverse(world, setup.employeesPage, {
      status: "INACTIVE",
      warehouseId: world.warehouses.alphaA,
    });
    const codes = inactive.pages.flat().map((row) => row.code);
    expect(codes).toHaveLength(20);
    expect(
      inactive.pages.flat().every((row) => row.status === "INACTIVE"),
    ).toBe(true);
    expect(codes.at(-1)).toBe("A-136");

    const none = await readPage(world, setup.employeesPage, {
      search: "nobody here",
    });
    expect(none).toMatchObject({ status: "ready", page: [], isDone: true });
  });

  it("binds cursors to criteria, page size, organization and current site scope", async () => {
    const { world, auth } = await hrWorld();
    await world.t.run((ctx) =>
      ctx.db.insert("membershipWarehouses", {
        orgId: world.orgA,
        membershipId: auth.identities.membershipA,
        warehouseId: world.warehouses.bravoA,
      }),
    );
    await employees(world, world.warehouses.alphaA, 25, "A");
    const bravo = await employees(world, world.warehouses.bravoA, 45, "B");
    const charlie = await employees(world, world.warehouses.charlieA, 3, "C");
    const foreign = await employees(
      world,
      world.warehouses.alphaB,
      2,
      "X",
      () => ({}),
      world.orgB,
    );

    const first = await readPage(world, setup.employeesPage, { pageSize: 20 });
    const second = await readPage(
      world,
      setup.employeesPage,
      { pageSize: 20 },
      first.continueCursor,
    );
    expect(second.page.map((row: any) => row.code)).toEqual([
      "A-020",
      "A-021",
      "A-022",
      "A-023",
      "A-024",
      ...Array.from(
        { length: 15 },
        (_, index) => `B-${String(index).padStart(3, "0")}`,
      ),
    ]);
    const third = second.continueCursor;

    // Different criteria, size or organization: reset, never a foreign page.
    for (const [args, identity] of [
      [{ pageSize: 20, search: "b" }, ADMIN],
      [{ pageSize: 50 }, ADMIN],
      [{ pageSize: 20 }, FOREIGN],
    ] as const)
      expect(
        await value(
          world,
          setup.employeesPage,
          { ...args, cursor: third },
          identity,
        ),
      ).toMatchObject({ status: "reset", page: [] });
    expect(
      await value(world, setup.employeesPage, { pageSize: 20, cursor: "{bad" }),
    ).toMatchObject({ status: "reset" });

    // A forged lane (an unauthorized site) resets.
    const state = JSON.parse(third);
    expect(
      await value(world, setup.employeesPage, {
        pageSize: 20,
        cursor: JSON.stringify({ ...state, lane: world.warehouses.charlieA }),
      }),
    ).toMatchObject({ status: "reset" });
    // Forged retained IDs are re-read and re-authorized: unauthorized and
    // foreign employees never appear.
    const forged = await readPage(
      world,
      setup.employeesPage,
      { pageSize: 20 },
      JSON.stringify({
        ...state,
        ids: [charlie[0], foreign[0], bravo[44]],
      }),
    );
    const forgedIds = forged.page.map((row: any) => row.id);
    expect(forgedIds).not.toContain(charlie[0]);
    expect(forgedIds).not.toContain(foreign[0]);
    expect(forgedIds[0]).toBe(bravo[44]);

    // Revoking the site of the current lane invalidates the position.
    await world.t.run(async (ctx) => {
      const grants = await ctx.db
        .query("membershipWarehouses")
        .withIndex("by_orgId_warehouseId", (q) =>
          q.eq("orgId", world.orgA).eq("warehouseId", world.warehouses.bravoA),
        )
        .collect();
      for (const grant of grants) await ctx.db.delete(grant._id);
    });
    expect(
      await value(world, setup.employeesPage, { pageSize: 20, cursor: third }),
    ).toMatchObject({ status: "reset" });
    const after = await traverse(world, setup.employeesPage, { pageSize: 20 });
    expect(after.pages.flat().every((row) => row.siteCode === "ALPHA")).toBe(
      true,
    );
  });

  it("refuses unsupported sizes and unavailable sites", async () => {
    const { world } = await hrWorld();
    for (const pageSize of [100, 0, 21])
      expect(await value(world, setup.employeesPage, { pageSize })).toEqual({
        ok: false,
        code: "PAGE_SIZE_INVALID",
      });
    expect(
      await value(world, setup.employeesPage, {
        warehouseId: world.warehouses.bravoA,
      }),
    ).toEqual({ ok: false, code: "SITE_UNAVAILABLE" });
    expect(
      await value(world, setup.employeesPage, { search: "x".repeat(101) }),
    ).toEqual({ ok: false, code: "SEARCH_INVALID" });
  });
});

describe("review queue pages", () => {
  it("pages employee groups so every open issue beyond 500 items stays reachable", async () => {
    const { world, auth } = await hrWorld();
    await orgWide(world, auth);
    const from = "2026-09-26";
    const active = (index: number) => ({
      status: "ACTIVE" as const,
      displayName: `Reviewee ${index}`,
    });
    const first = await employees(
      world,
      world.warehouses.alphaA,
      30,
      "R",
      active,
    );
    const args = { from, to: TODAY };
    const old = await value(world, review.queue, args);
    expect(old.ok).toBe(true);
    const oldKeys = old.items
      .filter((item: any) => item.status === "EXCEPTION")
      .map((item: any) => `${item.employeeId}:${item.businessDate}`)
      .sort();
    expect(oldKeys.length).toBeGreaterThan(250);

    const paged = await traverse(world, review.queuePage, {
      ...args,
      pageSize: 20,
    });
    const groups = paged.pages.flat();
    expect(groups.map((group) => group.employeeId)).toEqual(first);
    const pagedKeys = groups
      .flatMap((group) =>
        group.items.map(
          (item: any) => `${group.employeeId}:${item.businessDate}`,
        ),
      )
      .sort();
    expect(pagedKeys).toEqual(oldKeys);

    // Past the former 500-item refusal, every employee is still reachable.
    const more = await employees(
      world,
      world.warehouses.bravoA,
      35,
      "S",
      active,
    );
    expect(await value(world, review.queue, args)).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
    });
    const all = await traverse(world, review.queuePage, {
      ...args,
      pageSize: 50,
    });
    const reached = all.pages.flat();
    expect(reached.map((group) => group.employeeId)).toEqual([
      ...first,
      ...more,
    ]);
    expect(reached.flatMap((group) => group.items)).toHaveLength(
      oldKeys.length * 2 + (oldKeys.length / 30) * 5,
    );

    // Search and site apply before days are evaluated; certified is separate.
    const searched = await traverse(world, review.queuePage, {
      ...args,
      search: "reviewee 34",
    });
    expect(searched.pages.flat().map((group) => group.employeeCode)).toEqual([
      "S-034",
    ]);
    const bravoOnly = await traverse(world, review.queuePage, {
      ...args,
      warehouseId: world.warehouses.bravoA,
    });
    expect(bravoOnly.pages.flat()).toHaveLength(35);
    expect(
      await readPage(world, review.queuePage, { ...args, tab: "CERTIFIED" }),
    ).toMatchObject({ status: "ready", page: [], isDone: true });
  });

  it("re-evaluates a retained group and resets a cursor from another range", async () => {
    const { world } = await hrWorld();
    const ids = await employees(
      world,
      world.warehouses.alphaA,
      25,
      "R",
      () => ({
        status: "ACTIVE",
      }),
    );
    const args = { from: "2026-10-05", to: TODAY, pageSize: 20 };
    const first = await readPage(world, review.queuePage, args);
    expect(first.page).toHaveLength(20);
    // A changed range is different criteria.
    expect(
      await value(world, review.queuePage, {
        ...args,
        from: "2026-10-06",
        cursor: first.continueCursor,
      }),
    ).toMatchObject({ status: "reset" });
    // An employee that is no longer reviewable drops out of a retained page.
    const state = JSON.parse(first.continueCursor);
    await world.t.run((ctx) =>
      ctx.db.patch(ids[20]!, { employmentStartDate: "2026-12-01" }),
    );
    const next = await readPage(
      world,
      review.queuePage,
      args,
      JSON.stringify({ ...state, ids: [ids[20]] }),
    );
    expect(next.page.map((group: any) => group.employeeId)).toEqual(
      ids.slice(21),
    );
  });
});

describe("period registry pages", () => {
  async function insertPeriods(
    world: ConvexTenantWorld,
    warehouseId: Id<"warehouses">,
    count: number,
    orgId: Id<"organizations"> = world.orgA,
  ) {
    return await world.t.run(async (ctx) => {
      const ids: Id<"hrPeriods">[] = [];
      for (let index = 0; index < count; index += 1) {
        const year = 2000 + Math.floor(index / 12);
        const month = String((index % 12) + 1).padStart(2, "0");
        ids.push(
          await ctx.db.insert("hrPeriods", {
            orgId,
            warehouseId,
            startDate: `${year}-${month}-01`,
            endDate: `${year}-${month}-28`,
            status: index % 5 === 0 ? "DRAFT" : "CLOSED",
            draftVersion: 1,
            latestClosedVersion: index % 5 === 0 ? 0 : 1,
            createdAt: 1,
            createdByUserId: world.userA,
            updatedAt: 1,
            updatedByUserId: world.userA,
          }),
        );
      }
      return ids;
    });
  }

  it("reaches every period beyond the former newest-200 slice, newest first", async () => {
    const { world, auth } = await hrWorld();
    await orgWide(world, auth);
    const alpha = await insertPeriods(world, world.warehouses.alphaA, 205);
    const closed = await insertPeriods(world, world.warehouses.deltaA, 3);
    await insertPeriods(world, world.warehouses.alphaB, 4, world.orgB);
    const old = await value(world, periods.list, {});
    expect(old.items).toHaveLength(200);
    expect(old.complete).toBe(false);

    const { pages } = await traverse(world, periods.listPage, { pageSize: 50 });
    const rows = pages.flat();
    expect(rows).toHaveLength(208);
    expect(new Set(rows.map((row) => row.id)).size).toBe(208);
    const starts = rows.map((row) => row.startDate);
    expect(starts).toEqual([...starts].sort().reverse());
    // The oldest period and closed-site history are reachable.
    expect(rows.map((row) => row.id)).toContain(alpha[0]);
    expect(
      rows
        .filter((row) => !row.siteActive)
        .map((row) => row.id)
        .sort(),
    ).toEqual([...closed].sort());

    const drafts = await traverse(world, periods.listPage, {
      status: "DRAFT",
      warehouseId: world.warehouses.alphaA,
    });
    expect(drafts.pages.flat()).toHaveLength(41);
    expect(drafts.pages.flat().every((row) => row.status === "DRAFT")).toBe(
      true,
    );
  });

  it("keeps a scoped actor inside their sites", async () => {
    const { world } = await hrWorld();
    await insertPeriods(world, world.warehouses.alphaA, 30);
    await insertPeriods(world, world.warehouses.bravoA, 30);
    const { pages } = await traverse(world, periods.listPage, {});
    expect(pages.flat()).toHaveLength(30);
    expect(pages.flat().every((row) => row.siteCode === "ALPHA")).toBe(true);
    expect(
      await value(world, periods.listPage, {
        warehouseId: world.warehouses.bravoA,
      }),
    ).toEqual({ ok: false, code: "SITE_UNAVAILABLE" });
  });

  it("returns every open blocker of a large draft preview, beyond 200", async () => {
    const { world } = await hrWorld();
    await employees(world, world.warehouses.alphaA, 12, "P", () => ({
      status: "ACTIVE",
    }));
    const [periodId] = await world.t.run(async (ctx) => [
      await ctx.db.insert("hrPeriods", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        status: "DRAFT",
        draftVersion: 1,
        latestClosedVersion: 0,
        createdAt: 1,
        createdByUserId: world.userA,
        updatedAt: 1,
        updatedByUserId: world.userA,
      }),
    ]);
    const preview = await value(world, periods.preview, { periodId });
    expect(preview.view.kind).toBe("DRAFT");
    const open = preview.view.rows.filter((row: any) => row.status !== "READY");
    // 12 employees × 22 working days, all missing attendance.
    expect(open).toHaveLength(264);
    expect(preview.view.totals.employees).toBe(12);
  });
});

describe("holiday, history and member pages", () => {
  it("pages holidays beyond 99 and filters one year with an early stop", async () => {
    const { world } = await hrWorld();
    await world.t.run(async (ctx) => {
      for (let index = 0; index < 130; index += 1) {
        const year = 2020 + Math.floor(index / 20);
        const day = String((index % 20) + 1).padStart(2, "0");
        await ctx.db.insert("hrHolidays", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          date: `${year}-03-${day}`,
          name: `Holiday ${index}`,
          createdAt: 1,
          createdByUserId: world.userA,
        });
      }
    });
    const site = { warehouseId: world.warehouses.alphaA };
    const all = await traverse(world, setup.holidaysPage, site);
    const dates = all.pages.flat().map((row) => row.date);
    expect(dates).toHaveLength(130);
    expect(dates).toEqual([...dates].sort().reverse());
    const year = await traverse(world, setup.holidaysPage, {
      ...site,
      year: 2021,
    });
    expect(year.pages.flat()).toHaveLength(20);
    expect(year.pages.flat().every((row) => row.date.startsWith("2021-"))).toBe(
      true,
    );
    expect(
      await value(world, setup.holidaysPage, { ...site, year: 1800 }),
    ).toEqual({ ok: false, code: "YEAR_INVALID" });
    expect(
      await value(world, setup.holidaysPage, {
        warehouseId: world.warehouses.bravoA,
      }),
    ).toEqual({ ok: false, code: "SITE_UNAVAILABLE" });
  });

  it("pages every saved employee change, skipping denied rows before paging", async () => {
    const { world } = await hrWorld();
    const [employeeId] = await employees(
      world,
      world.warehouses.alphaA,
      1,
      "H",
    );
    await world.t.run(async (ctx) => {
      for (let index = 0; index < 60; index += 1)
        await ctx.db.insert("auditEvents", {
          orgId: world.orgA,
          occurredAt: 1000 + index,
          actorKind: "USER",
          actorUserId: world.userA,
          action: "hr.employee.save",
          entityTable: "hrEmployees",
          entityId: employeeId!,
          outcome: index % 3 === 0 ? "DENIED" : "ALLOWED",
          requestId: `history-${index}`,
          changes: [{ field: "displayName", to: `"Name ${index}"` }],
        });
    });
    const old = await value(world, setup.employeeHistory, { employeeId });
    expect(old.complete).toBe(false);
    const { pages } = await traverse(world, setup.employeeHistoryPage, {
      employeeId,
    });
    const at = pages.flat().map((row) => row.at);
    expect(at).toHaveLength(40);
    expect(pages[0]).toHaveLength(20);
    expect(at).toEqual([...at].sort((a, b) => b - a));
    expect(
      await value(world, setup.employeeHistoryPage, { employeeId: "nope" }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("pages and searches more than 200 active members for pickers and access", async () => {
    const { world } = await hrWorld();
    await world.t.run(async (ctx) => {
      for (let index = 0; index < 210; index += 1) {
        const userId = await ctx.db.insert("users", {
          clerkUserId: `user_page_${index}`,
          displayName: index === 207 ? "Zed Needle" : `Member ${index}`,
          status: "ACTIVE",
        });
        await ctx.db.insert("memberships", {
          orgId: world.orgA,
          userId,
          clerkMembershipId: `orgmem_page_${index}`,
          status: index === 5 ? "SUSPENDED" : "ACTIVE",
          scopeMode: "ORG_WIDE",
          effectiveFrom: 0,
        });
      }
    });
    expect(await value(world, setup.memberOptions, {})).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
    });
    const options = await traverse(world, setup.memberOptionsPage, {
      pageSize: 50,
    });
    const names = options.pages.flat().map((row) => row.displayName);
    // 209 active fixtures plus the actor.
    expect(names).toHaveLength(210);
    expect(names).not.toContain("Member 5");
    const needle = await traverse(world, setup.memberOptionsPage, {
      search: "needle",
    });
    expect(needle.pages.flat()).toMatchObject([
      { displayName: "Zed Needle", linked: false },
    ]);
    const access = await traverse(world, setup.accessMembersPage, {
      search: "needle",
    });
    expect(access.pages.flat()).toMatchObject([
      { displayName: "Zed Needle", roles: [] },
    ]);
    const first = await readPage(world, setup.accessMembersPage, {});
    expect(first).toMatchObject({ provisioned: true, status: "ready" });
    expect(first.page).toHaveLength(20);
  });
});

describe("bounded year calendar reads", () => {
  async function calendar(dates: readonly string[]) {
    const { world } = await hrWorld();
    await employees(world, world.warehouses.alphaA, 1, "SELF", () => ({
      userId: world.userA,
    }));
    await world.t.run(async (ctx) => {
      for (const date of dates)
        await ctx.db.insert("hrHolidays", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          date,
          name: `Holiday ${date}`,
          createdAt: 1,
          createdByUserId: world.userA,
        });
      // Another site's and another tenant's calendars never leak in.
      for (const [orgId, warehouseId] of [
        [world.orgA, world.warehouses.bravoA],
        [world.orgB, world.warehouses.alphaB],
      ] as const)
        await ctx.db.insert("hrHolidays", {
          orgId,
          warehouseId,
          date: "2026-06-01",
          name: "Elsewhere",
          createdAt: 1,
          createdByUserId: world.userA,
        });
    });
    return world;
  }
  const daysOf = (year: number, count: number) =>
    Array.from({ length: count }, (_, index) => {
      const date = new Date(Date.UTC(year, 0, 1 + index));
      return date.toISOString().slice(0, 10);
    });

  it("returns each year completely whichever end of the calendar it is read from", async () => {
    // 2026 near the newest end, 2001 at the oldest end, 2010 buried under
    // more than 100 holidays on both sides: each is one date-range read.
    const all = [
      ...daysOf(2001, 30),
      ...daysOf(2005, 120),
      ...daysOf(2010, 25),
      ...daysOf(2015, 120),
      ...daysOf(2026, 40),
      ...daysOf(2027, 5),
    ];
    const world = await calendar(all);
    for (const year of [2026, 2027, 2001, 2010, 2005, 2015, 2030]) {
      const answer = await value(world, self.holidays, { year });
      expect(answer.holidays.map((row: any) => row.date)).toEqual(
        all.filter((date) => date.startsWith(`${year}-`)),
      );
      expect(answer.complete).toBe(true);
    }
    // A leap year keeps all 366 days.
    const leap = await calendar(daysOf(2024, 366));
    expect(
      (await value(leap, self.holidays, { year: 2024 })).holidays,
    ).toHaveLength(366);
  });
});

describe("closed period exports while browsing pages", () => {
  it("keeps the frozen rows and CSV unchanged after later edits", async () => {
    const { world } = await hrWorld();
    // Without a schedule every day is nonworking, so the period is ready.
    await employees(world, world.warehouses.alphaA, 3, "F", () => ({
      status: "ACTIVE",
      schedule: undefined,
    }));
    const periodId = await world.t.run((ctx) =>
      ctx.db.insert("hrPeriods", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        startDate: "2026-09-01",
        endDate: "2026-09-10",
        status: "DRAFT",
        draftVersion: 1,
        latestClosedVersion: 0,
        createdAt: 1,
        createdByUserId: world.userA,
        updatedAt: 1,
        updatedByUserId: world.userA,
      }),
    );
    const draft = await value(world, periods.preview, { periodId });
    expect(draft.view).toMatchObject({ kind: "DRAFT", blocker: null });
    const closed = await value(world, periods.close, {
      requestId: "close-paged-period",
      periodId,
      expectedFingerprint: draft.view.fingerprint,
    });
    expect(closed).toMatchObject({ written: true, version: 1 });
    const versionId = closed.documentId;
    const exported = await value(world, periods.exportCsv, {
      requestId: "export-paged-period-1",
      versionId,
    });
    expect(exported.rowCount).toBe(30);

    // Later live changes and list browsing do not alter the frozen version.
    await world.t.run(async (ctx) => {
      await ctx.db.insert("hrHolidays", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        date: "2026-09-02",
        name: "Late holiday",
        createdAt: 2,
        createdByUserId: world.userA,
      });
    });
    await employees(world, world.warehouses.alphaA, 2, "G");
    const listed = await traverse(world, periods.listPage, {});
    expect(listed.pages.flat()).toMatchObject([
      { id: periodId, status: "CLOSED", latestClosedVersion: 1 },
    ]);
    const again = await value(world, periods.exportCsv, {
      requestId: "export-paged-period-2",
      versionId,
    });
    expect(again.content).toBe(exported.content);
    const frozen = await value(world, periods.preview, { periodId });
    expect(frozen.view.kind).toBe("CLOSED");
    expect(frozen.view.rows).toHaveLength(30);
    expect(frozen.view.totals).toEqual(
      (await value(world, periods.preview, { periodId, version: 1 })).view
        .totals,
    );
  });
});

describe("authorized sites beyond the preloaded 50", () => {
  /** Active sites sorted after ALPHA/BRAVO/CHARLIE, plus one last site. */
  async function manySites(world: ConvexTenantWorld, count: number) {
    return await world.t.run(async (ctx) => {
      const ids: Id<"warehouses">[] = [];
      for (let index = 0; index < count; index += 1)
        ids.push(
          await ctx.db.insert("warehouses", {
            orgId: world.orgA,
            code: `M-${String(index).padStart(2, "0")}`,
            name: `Filler ${index}`,
            status: "ACTIVE",
          }),
        );
      const late = await ctx.db.insert("warehouses", {
        orgId: world.orgA,
        code: "ZZ-LATE",
        name: "Late site",
        status: "ACTIVE",
      });
      return { fillers: ids, late };
    });
  }

  it("reaches an organization-wide administrator's 51st+ site in lists, filters, search and options", async () => {
    const { world, auth } = await hrWorld();
    await orgWide(world, auth);
    const { fillers, late } = await manySites(world, 49);
    // Two sites sharing a code keep a deterministic, complete order.
    const [dupA, dupB] = await world.t.run(async (ctx) => [
      await ctx.db.insert("warehouses", {
        orgId: world.orgA,
        code: "DUP",
        name: "Duplicate one",
        status: "ACTIVE",
      }),
      await ctx.db.insert("warehouses", {
        orgId: world.orgA,
        code: "DUP",
        name: "Duplicate two",
        status: "ACTIVE",
      }),
    ]);
    const [needle] = await employees(world, late, 1, "LATE", () => ({
      displayName: "Needle Late",
      status: "ACTIVE",
    }));
    const [first] = await employees(
      world,
      world.warehouses.alphaA,
      1,
      "A",
      () => ({
        status: "ACTIVE",
      }),
    );
    const [dup1] = await employees(world, dupA!, 1, "DA", () => ({
      status: "ACTIVE",
    }));
    const [dup2] = await employees(world, dupB!, 1, "DB", () => ({
      status: "ACTIVE",
    }));
    await employees(world, fillers[10]!, 2, "F", () => ({ status: "ACTIVE" }));
    // 55 active sites in all: the preloaded scope list stops at 50.
    expect((await value(world, setup.listEmployees, {})).complete).toBe(false);

    const all = await traverse(world, setup.employeesPage, {});
    const ids = all.pages.flat().map((row) => row.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(ids[0]).toBe(first);
    expect(ids.at(-1)).toBe(needle);
    expect(ids.indexOf(dup1!)).toBeLessThan(ids.indexOf(dup2!));
    const page = await readPage(world, setup.employeesPage, {});
    expect(page.sitesComplete).toBe(true);

    const search = await traverse(world, setup.employeesPage, {
      search: "needle",
    });
    expect(search.pages.flat().map((row) => row.id)).toEqual([needle]);
    const direct = await traverse(world, setup.employeesPage, {
      warehouseId: late,
    });
    expect(direct.pages.flat()).toMatchObject([
      { id: needle, siteCode: "ZZ-LATE" },
    ]);
    expect(
      await value(world, setup.employee, { employeeId: needle }),
    ).toMatchObject({
      ok: true,
    });
    // Other lists accept the late site too.
    expect(
      await readPage(world, periods.listPage, { warehouseId: late }),
    ).toMatchObject({ status: "ready" });
    expect(
      await readPage(world, review.queuePage, {
        from: "2026-10-01",
        to: "2026-10-09",
        warehouseId: late,
      }),
    ).toMatchObject({ status: "ready" });
    expect(
      await readPage(world, setup.holidaysPage, { warehouseId: late }),
    ).toMatchObject({ status: "ready" });

    // Site options page every site and resolve a selected late site.
    const options = await traverse(world, access.sitesPage, { pageSize: 50 });
    const codes = options.pages.flat().map((row) => row.code);
    expect(codes).toHaveLength(55);
    expect(codes.at(-1)).toBe("ZZ-LATE");
    expect(codes).not.toContain("DELTA");
    const closed = await traverse(world, access.sitesPage, {
      pageSize: 50,
      includeInactive: true,
    });
    expect(closed.pages.flat().map((row) => row.code)).toContain("DELTA");
    const found = await traverse(world, access.sitesPage, { search: "zz-l" });
    expect(found.pages.flat()).toMatchObject([{ id: late, code: "ZZ-LATE" }]);
    expect(
      await readPage(world, access.sitesPage, { selectedId: late }),
    ).toMatchObject({ selected: { id: late, code: "ZZ-LATE" } });

    // A forged lane key (another tenant's site under a listed code) resets.
    const scanning = await value(world, setup.employeesPage, {
      search: "zzz",
    });
    expect(scanning.status).toBe("scanning");
    const forged = {
      ...JSON.parse(scanning.scanCursor),
      lane: JSON.stringify(["ALPHA", 0, world.warehouses.alphaB]),
      finished: false,
      range: {},
    };
    expect(
      await value(world, setup.employeesPage, {
        search: "zzz",
        scanCursor: JSON.stringify(forged),
      }),
    ).toMatchObject({ status: "reset" });
  });

  it("reaches every site of a warehouse-scoped actor with more than 50 grants, and honours revocation", async () => {
    const { world, auth } = await hrWorld();
    const { fillers, late } = await manySites(world, 54);
    const sites = [...fillers, late];
    await world.t.run(async (ctx) => {
      for (const warehouseId of sites)
        await ctx.db.insert("membershipWarehouses", {
          orgId: world.orgA,
          membershipId: auth.identities.membershipA,
          warehouseId,
        });
    });
    // One employee at every granted site (56 grants including ALPHA).
    const staff = new Map<string, Id<"hrEmployees">>();
    for (const [index, warehouseId] of [
      world.warehouses.alphaA,
      ...sites,
    ].entries()) {
      const [id] = await employees(world, warehouseId, 1, `S${index}`, () => ({
        status: "ACTIVE",
        ...(index === 55 ? { displayName: "Needle Scoped" } : {}),
      }));
      staff.set(warehouseId, id!);
    }
    // An ungranted site stays invisible.
    const [hidden] = await employees(
      world,
      world.warehouses.bravoA,
      1,
      "H",
      () => ({
        status: "ACTIVE",
      }),
    );

    const all = await traverse(world, setup.employeesPage, { pageSize: 20 });
    const ids = all.pages.flat().map((row) => row.id);
    expect(new Set(ids).size).toBe(56);
    expect(new Set(ids)).toEqual(new Set(staff.values()));
    expect(ids).not.toContain(hidden);
    const needle = await traverse(world, setup.employeesPage, {
      search: "needle scoped",
    });
    expect(needle.pages.flat().map((row) => row.id)).toEqual([staff.get(late)]);
    for (const warehouseId of [late, fillers[53]!])
      expect(
        (await traverse(world, setup.employeesPage, { warehouseId })).pages
          .flat()
          .map((row) => row.id),
      ).toEqual([staff.get(warehouseId)]);
    expect(
      await value(world, setup.employeesPage, {
        warehouseId: world.warehouses.bravoA,
      }),
    ).toEqual({ ok: false, code: "SITE_UNAVAILABLE" });
    const options = await traverse(world, access.sitesPage, { pageSize: 50 });
    expect(options.pages.flat()).toHaveLength(56);

    // The review queue no longer refuses an incomplete scope.
    expect(
      await readPage(world, review.queuePage, {
        from: "2026-10-01",
        to: "2026-10-09",
      }),
    ).toMatchObject({ status: "ready" });

    // Revoke the site the cursor is positioned in: the cursor resets, and
    // the site's employee leaves every list and exact lookup.
    const firstPage = await readPage(world, setup.employeesPage, {
      pageSize: 20,
    });
    const state = JSON.parse(firstPage.continueCursor);
    const revoked = state.lane as Id<"warehouses">;
    expect(revoked).not.toBe("");
    await world.t.run(async (ctx) => {
      const grants = await ctx.db
        .query("membershipWarehouses")
        .withIndex("by_orgId_warehouseId", (q) =>
          q.eq("orgId", world.orgA).eq("warehouseId", revoked),
        )
        .collect();
      for (const grant of grants) await ctx.db.delete(grant._id);
    });
    const resumed = await value(world, setup.employeesPage, {
      pageSize: 20,
      cursor: firstPage.continueCursor,
    });
    expect(["reset", "ready", "scanning"]).toContain(resumed.status);
    if (resumed.status !== "reset")
      expect(resumed.page.map((row: any) => row.id)).not.toContain(
        staff.get(revoked),
      );
    const after = await traverse(world, setup.employeesPage, { pageSize: 50 });
    expect(after.pages.flat().map((row) => row.id)).not.toContain(
      staff.get(revoked),
    );
    expect(after.pages.flat()).toHaveLength(55);
    expect(
      await value(world, setup.employee, { employeeId: staff.get(revoked) }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await value(world, setup.employeesPage, { warehouseId: revoked }),
    ).toEqual({ ok: false, code: "SITE_UNAVAILABLE" });
  });
});

describe("older period versions and day corrections", () => {
  it("lists every closed version beyond the newest 50", async () => {
    const { world } = await hrWorld();
    const periodId = await world.t.run(async (ctx) => {
      const id = await ctx.db.insert("hrPeriods", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        startDate: "2026-08-01",
        endDate: "2026-08-31",
        status: "CLOSED",
        draftVersion: 60,
        latestClosedVersion: 60,
        createdAt: 1,
        createdByUserId: world.userA,
        updatedAt: 1,
        updatedByUserId: world.userA,
      });
      for (let version = 1; version <= 60; version += 1)
        await ctx.db.insert("hrPeriodVersions", {
          orgId: world.orgA,
          periodId: id,
          warehouseId: world.warehouses.alphaA,
          version,
          startDate: "2026-08-01",
          endDate: "2026-08-31",
          timezone: "Asia/Bangkok",
          siteCode: "ALPHA",
          siteName: "Warehouse ALPHA",
          fingerprint: `f${version}`,
          totals: {
            employees: 0,
            days: 0,
            workedMinutes: 0,
            outsideShiftMinutes: 0,
            absentDays: 0,
            leaveDays: 0,
            nonworkingDays: 0,
          },
          closedByUserId: world.userA,
          closedAt: 1000 + version,
        });
      return id;
    });
    const preview = await value(world, periods.preview, { periodId });
    expect(preview.versions).toHaveLength(50);
    expect(preview.versionsComplete).toBe(false);
    const { pages } = await traverse(world, periods.versionsPage, {
      periodId,
    });
    const numbers = pages.flat().map((row) => row.version);
    expect(numbers).toEqual(
      Array.from({ length: 60 }, (_, index) => 60 - index),
    );
    expect(pages[0]).toHaveLength(20);
    expect(
      await value(world, periods.versionsPage, { periodId: "nope" }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    // Another organization's period is not found.
    expect(
      await value(world, periods.versionsPage, { periodId }, FOREIGN),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("pages a reviewed day's corrections beyond the newest 20", async () => {
    const { world } = await hrWorld();
    const [employeeId] = await employees(
      world,
      world.warehouses.alphaA,
      1,
      "C",
      () => ({
        status: "ACTIVE",
      }),
    );
    const date = "2026-10-05";
    await world.t.run(async (ctx) => {
      const dayId = await ctx.db.insert("hrAttendanceDays", {
        orgId: world.orgA,
        employeeId: employeeId!,
        warehouseId: world.warehouses.alphaA,
        businessDate: date,
        plan: { kind: "NONWORKING", breakMinutes: 0, reason: "NO_SCHEDULE" },
        open: false,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      for (let index = 0; index < 33; index += 1)
        await ctx.db.insert("hrCorrectionRequests", {
          orgId: world.orgA,
          dayId,
          employeeId: employeeId!,
          warehouseId: world.warehouses.alphaA,
          businessDate: date,
          status: "RETURNED",
          proposedStartAt: 1,
          proposedEndAt: 2,
          reason: `Reason ${index}`,
          baseRevision: 1,
          version: 1,
          submittedByUserId: world.userA,
          submittedAt: 5000 + index,
          history: [],
        });
    });
    const detail = await value(world, review.dayDetail, {
      employeeId,
      businessDate: date,
    });
    expect(detail.detail.corrections).toHaveLength(20);
    expect(detail.detail.correctionsIncomplete).toBe(true);
    const { pages } = await traverse(world, review.dayCorrectionsPage, {
      employeeId,
      businessDate: date,
    });
    const reasons = pages.flat().map((row) => row.reason);
    expect(reasons).toHaveLength(33);
    expect(reasons[0]).toBe("Reason 32");
    expect(reasons.at(-1)).toBe("Reason 0");
    // An employee outside the reviewer's scope answers NOT_FOUND.
    const [outside] = await employees(world, world.warehouses.bravoA, 1, "O");
    expect(
      await value(world, review.dayCorrectionsPage, {
        employeeId: outside,
        businessDate: date,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("holiday date ranges", () => {
  it("reads one administrative year as a single bounded range, even when buried", async () => {
    const { world } = await hrWorld();
    await world.t.run(async (ctx) => {
      // 150 holidays on each side of 2010 bury it for an edge read.
      for (const [year, count] of [
        [2005, 150],
        [2010, 7],
        [2015, 150],
      ] as const)
        for (let index = 0; index < count; index += 1) {
          const date = new Date(Date.UTC(year, 0, 1 + index))
            .toISOString()
            .slice(0, 10);
          await ctx.db.insert("hrHolidays", {
            orgId: world.orgA,
            warehouseId: world.warehouses.alphaA,
            date,
            name: `Holiday ${date}`,
            createdAt: 1,
            createdByUserId: world.userA,
          });
        }
    });
    const page = await readPage(world, setup.holidaysPage, {
      warehouseId: world.warehouses.alphaA,
      year: 2010,
    });
    // One request, and only that year's rows were read.
    expect(page.requests).toBe(1);
    expect(page.scanned).toBe(7);
    expect(page.page.map((row: any) => row.date)).toEqual(
      Array.from({ length: 7 }, (_, index) => `2010-01-0${7 - index}`),
    );
    expect(page.isDone).toBe(true);
  });
});
