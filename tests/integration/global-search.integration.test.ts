/**
 * Global search and AI navigation on the server: scoped HR entity search,
 * by-ID deep-link reads and the rate-limited AI intent action.
 *
 * The provider is replaced by a stubbed `fetch`; these tests verify the
 * application contract (scope, grounding, quota, failures), not model quality.
 */
import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import { AI_SEARCH_RATE_LIMIT } from "../../convex/hr/navigationIntent";
import * as review from "../../convex/hr/review";
import * as search from "../../convex/hr/search";
import * as setup from "../../convex/hr/setup";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}
type Outcome = { ok: boolean; value?: any };

const EMPLOYEE = "user_fixture_a";
const SUPERVISOR = "user_search_supervisor";
const OTHER_SUPERVISOR = "user_search_other_supervisor";
const HR_ADMIN = "user_search_admin";
const SITE_ADMIN = "user_search_site_admin";
const MANAGER = "user_search_manager";

async function call(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  subject: string,
  orgId = "org_fixture_a",
): Promise<Outcome> {
  return (await world.t
    .withIdentity({ subject, org_id: orgId })
    .run((ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Outcome;
}
const value = (outcome: Outcome) => {
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  return outcome.value;
};
const codes = (result: { items: { code: string }[] }) =>
  result.items.map((item) => item.code);

async function addActor(
  world: ConvexTenantWorld,
  clerkUserId: string,
  roleKey: string,
  sites: readonly GenericId<"warehouses">[] | "ORG_WIDE",
) {
  return await world.t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkUserId,
      displayName: clerkUserId.replace("user_", ""),
      status: "ACTIVE",
    });
    const membershipId = await ctx.db.insert("memberships", {
      orgId: world.orgA,
      userId,
      clerkMembershipId: `orgmem_${clerkUserId}`,
      status: "ACTIVE",
      scopeMode: sites === "ORG_WIDE" ? "ORG_WIDE" : "WAREHOUSE_SCOPED",
      effectiveFrom: 0,
    });
    if (sites !== "ORG_WIDE")
      for (const warehouseId of sites)
        await ctx.db.insert("membershipWarehouses", {
          orgId: world.orgA,
          membershipId,
          warehouseId,
        });
    const role = await ctx.db
      .query("roles")
      .withIndex("by_orgId_key", (q) =>
        q.eq("orgId", world.orgA).eq("key", roleKey),
      )
      .unique();
    await ctx.db.insert("membershipRoles", {
      orgId: world.orgA,
      membershipId,
      roleId: role!._id,
      grantedAt: 0,
    });
    return userId;
  });
}

async function insertEmployee(
  world: ConvexTenantWorld,
  fields: {
    code: string;
    displayName: string;
    warehouseId: GenericId<"warehouses">;
    orgId?: GenericId<"organizations">;
    userId?: GenericId<"users">;
    supervisorUserId?: GenericId<"users">;
    status?: "ACTIVE" | "INACTIVE";
  },
) {
  return await world.t.run((ctx) =>
    ctx.db.insert("hrEmployees", {
      orgId: fields.orgId ?? world.orgA,
      warehouseId: fields.warehouseId,
      code: fields.code,
      displayName: fields.displayName,
      ...(fields.userId === undefined ? {} : { userId: fields.userId }),
      ...(fields.supervisorUserId === undefined
        ? {}
        : { supervisorUserId: fields.supervisorUserId }),
      employmentStartDate: "2026-01-01",
      status: fields.status ?? "ACTIVE",
      version: 1,
      createdAt: 0,
      createdByUserId: world.userA,
      updatedAt: 0,
      updatedByUserId: world.userA,
    }),
  );
}

async function searchWorld(modules = {}) {
  const world = await createConvexTenantWorld(modules);
  await seedConvexAuthorization(world, { roleA: "HR_EMPLOYEE" });
  const supervisorId = await addActor(world, SUPERVISOR, "HR_SUPERVISOR", [
    world.warehouses.alphaA,
  ]);
  const otherSupervisorId = await addActor(
    world,
    OTHER_SUPERVISOR,
    "HR_SUPERVISOR",
    [world.warehouses.alphaA],
  );
  const adminId = await addActor(world, HR_ADMIN, "HR_ADMIN", "ORG_WIDE");
  await addActor(world, SITE_ADMIN, "HR_ADMIN", [world.warehouses.alphaA]);
  await addActor(world, MANAGER, "WAREHOUSE_MANAGER", "ORG_WIDE");
  const ids = {
    own: await insertEmployee(world, {
      code: "EMP-001",
      displayName: "สมชาย ใจดี",
      warehouseId: world.warehouses.alphaA,
      userId: world.userA,
      supervisorUserId: supervisorId,
    }),
    report: await insertEmployee(world, {
      code: "EMP-002",
      displayName: "สมชาย ศรีสุข",
      warehouseId: world.warehouses.alphaA,
      supervisorUserId: supervisorId,
    }),
    otherTeam: await insertEmployee(world, {
      code: "EMP-003",
      displayName: "สมชาย ทีมอื่น",
      warehouseId: world.warehouses.alphaA,
      supervisorUserId: otherSupervisorId,
    }),
    otherSite: await insertEmployee(world, {
      code: "EMP-004",
      displayName: "สมชาย ไซต์บราโว",
      warehouseId: world.warehouses.bravoA,
      supervisorUserId: supervisorId,
    }),
    adminSelf: await insertEmployee(world, {
      code: "EMP-005",
      displayName: "ผู้ดูแล HR",
      warehouseId: world.warehouses.alphaA,
      userId: adminId,
    }),
    inactive: await insertEmployee(world, {
      code: "EMP-006",
      displayName: "Somsak Inactive",
      warehouseId: world.warehouses.alphaA,
      supervisorUserId: supervisorId,
      status: "INACTIVE",
    }),
    foreign: await insertEmployee(world, {
      orgId: world.orgB,
      code: "EMP-900",
      displayName: "สมชาย องค์กรอื่น",
      warehouseId: world.warehouses.alphaB,
    }),
  };
  return { world, supervisorId, adminId, ids };
}

describe("scoped HR entity search", () => {
  it("lets a supervisor find only direct reports, by exact code or Thai name, never themselves or other teams", async () => {
    const { world } = await searchWorld();
    const byName = value(
      await call(world, search.reviewEmployees, { text: "สมชาย" }, SUPERVISOR),
    );
    // EMP-004 is a direct report on a site outside the supervisor's scope.
    expect(codes(byName)).toEqual(["EMP-001", "EMP-002"]);
    expect(byName.complete).toBe(true);
    expect(
      codes(
        value(
          await call(
            world,
            search.reviewEmployees,
            { text: "ตรวจ emp–๐๐๓" },
            SUPERVISOR,
          ),
        ),
      ),
    ).toEqual([]);
    const exact = value(
      await call(
        world,
        search.reviewEmployees,
        { text: "ตรวจ emp-002 เมื่อวาน" },
        SUPERVISOR,
      ),
    );
    expect(exact.items).toEqual([
      expect.objectContaining({ code: "EMP-002", match: "CODE" }),
    ]);
    // An inactive employee is still found by exact code, and marked.
    expect(
      value(
        await call(
          world,
          search.reviewEmployees,
          { text: "EMP-006" },
          SUPERVISOR,
        ),
      ).items,
    ).toEqual([expect.objectContaining({ code: "EMP-006", active: false })]);
  });

  it("excludes the reviewer's own record and other organizations for HR admins", async () => {
    const { world } = await searchWorld();
    const admin = value(
      await call(world, search.reviewEmployees, { text: "EMP-005" }, HR_ADMIN),
    );
    expect(admin.items).toEqual([]);
    const names = value(
      await call(world, search.reviewEmployees, { text: "สมชาย" }, HR_ADMIN),
    );
    expect(codes(names)).toEqual(["EMP-001", "EMP-002", "EMP-003", "EMP-004"]);
    expect(
      value(
        await call(
          world,
          search.reviewEmployees,
          { text: "EMP-900" },
          HR_ADMIN,
        ),
      ).items,
    ).toEqual([]);
    // The admin registry may edit its own record.
    expect(
      codes(
        value(
          await call(
            world,
            search.adminEmployees,
            { text: "EMP-005" },
            HR_ADMIN,
          ),
        ),
      ),
    ).toEqual(["EMP-005"]);
  });

  it("limits a site-scoped admin to their sites, even by exact code", async () => {
    const { world } = await searchWorld();
    expect(
      value(
        await call(
          world,
          search.adminEmployees,
          { text: "EMP-004" },
          SITE_ADMIN,
        ),
      ).items,
    ).toEqual([]);
    expect(
      codes(
        value(
          await call(
            world,
            search.adminEmployees,
            { text: "สมชาย" },
            SITE_ADMIN,
          ),
        ),
      ),
    ).toEqual(["EMP-001", "EMP-002", "EMP-003"]);
  });

  it("denies each search to members without that page's permission", async () => {
    const { world } = await searchWorld();
    for (const fn of [search.reviewEmployees, search.adminEmployees])
      expect(await call(world, fn, { text: "สมชาย" }, EMPLOYEE)).toMatchObject({
        ok: false,
      });
    // A supervisor reviews, but may not use the admin registry search.
    expect(
      await call(world, search.adminEmployees, { text: "สมชาย" }, SUPERVISOR),
    ).toMatchObject({ ok: false });
    // Storage permissions grant no HR search at all.
    for (const fn of [
      search.reviewEmployees,
      search.adminEmployees,
      search.periodsByRange,
    ])
      expect(
        await call(
          world,
          fn,
          { text: "สมชาย", from: "2026-09-19", to: "2026-09-25" },
          MANAGER,
        ),
      ).toMatchObject({ ok: false });
  });

  it("reports incomplete results instead of a false no-match", async () => {
    const { world } = await searchWorld();
    for (let index = 0; index < 9; index += 1)
      await insertEmployee(world, {
        code: `DUP-${index}`,
        displayName: "สมหญิง ซ้ำ",
        warehouseId: world.warehouses.charlieA,
      });
    const many = value(
      await call(world, search.adminEmployees, { text: "สมหญิง" }, HR_ADMIN),
    );
    expect(many.items).toHaveLength(search.MAX_SEARCH_RESULTS);
    expect(many.complete).toBe(false);
    // Over one site's read bound, a miss is reported as incomplete.
    for (let index = 9; index < 100; index += 1)
      await insertEmployee(world, {
        code: `DUP-${index}`,
        displayName: `Filler ${index}`,
        warehouseId: world.warehouses.charlieA,
      });
    const miss = value(
      await call(world, search.adminEmployees, { text: "zzzz" }, HR_ADMIN),
    );
    expect(miss).toEqual({ items: [], complete: false });
    // An exact code is answered by the index regardless of the bound.
    expect(
      codes(
        value(
          await call(
            world,
            search.adminEmployees,
            { text: "DUP-99" },
            HR_ADMIN,
          ),
        ),
      ),
    ).toEqual(["DUP-99"]);
  });

  it("ignores empty and one-letter Thai text, and refuses oversized text as incomplete", async () => {
    const { world } = await searchWorld();
    for (const text of ["", "ส"])
      expect(
        value(await call(world, search.adminEmployees, { text }, HR_ADMIN)),
      ).toEqual({ items: [], complete: true });
    // Not read, so never a definitive "no match".
    expect(
      value(
        await call(
          world,
          search.adminEmployees,
          { text: "x".repeat(301) },
          HR_ADMIN,
        ),
      ),
    ).toEqual({ items: [], complete: false });
  });

  it("looks up every schema-valid code exactly: one character, letters only, short numbers, beyond list bounds", async () => {
    const { world, supervisorId } = await searchWorld();
    // Fill the site past the name-scan bound, so only the index can answer.
    for (let index = 0; index < 100; index += 1)
      await insertEmployee(world, {
        code: `F-${String(index).padStart(3, "0")}`,
        displayName: `Filler ${index}`,
        warehouseId: world.warehouses.alphaA,
        supervisorUserId: supervisorId,
      });
    for (const [code, name] of [
      ["A", "Single Letter"],
      ["NIGHT", "Night Shift"],
      ["12", "Short Number"],
    ] as const)
      await insertEmployee(world, {
        code,
        displayName: name,
        warehouseId: world.warehouses.alphaA,
        supervisorUserId: supervisorId,
      });
    for (const [args, expected] of [
      [{ text: "A" }, ["A"]],
      [{ text: "", codes: ["A"] }, ["A"]],
      [{ text: "ตรวจเวลา NIGHT วันที่ 8 ต.ค. 2569" }, ["NIGHT"]],
      [{ text: "", codes: ["night"] }, ["NIGHT"]],
      [{ text: "ตรวจเวลา 12 วันที่ 8 ต.ค. 2569" }, ["12"]],
      [{ text: "", codes: ["12"] }, ["12"]],
    ] as const) {
      const result = value(
        await call(world, search.reviewEmployees, args, SUPERVISOR),
      );
      expect(codes(result), JSON.stringify(args)).toEqual(expected);
      expect(result.items[0].match).toBe("CODE");
      // Exact codes (and one-character text, which only names a code)
      // answer completely; longer free text also scans names, and this team
      // exceeds the scan bound, so that answer is honestly incomplete.
      expect(result.complete, JSON.stringify(args)).toBe(
        "codes" in args || args.text.length < 2,
      );
    }
    // Codes only: no name is compared, so "Night Shift" is not a name hit.
    expect(
      value(
        await call(
          world,
          search.reviewEmployees,
          { text: "", codes: ["NIGH"] },
          SUPERVISOR,
        ),
      ),
    ).toEqual({ items: [], complete: true });
    // Two exact codes are both returned, never just the first.
    expect(
      codes(
        value(
          await call(
            world,
            search.reviewEmployees,
            { text: "", codes: ["A", "12"] },
            SUPERVISOR,
          ),
        ),
      ).sort(),
    ).toEqual(["12", "A"]);
    // More codes than one request looks up is reported incomplete.
    const many = value(
      await call(
        world,
        search.reviewEmployees,
        {
          text: "",
          codes: [
            "A",
            "12",
            "NIGHT",
            "F-000",
            "F-001",
            "F-002",
            "F-003",
            "F-004",
            "F-005",
          ],
        },
        SUPERVISOR,
      ),
    );
    expect(many.items).toHaveLength(search.MAX_SEARCH_RESULTS);
    expect(many.complete).toBe(false);
  });

  it("compares the whole name, so a longer name never matches a different person by its first characters", async () => {
    const { world } = await searchWorld();
    const prefix = "สมชาย".repeat(13); // 65 characters
    await insertEmployee(world, {
      code: "LONG-1",
      displayName: `${prefix} ก`,
      warehouseId: world.warehouses.alphaA,
    });
    await insertEmployee(world, {
      code: "LONG-2",
      displayName: `${prefix} ข`,
      warehouseId: world.warehouses.alphaA,
    });
    expect(
      codes(
        value(
          await call(
            world,
            search.adminEmployees,
            { text: `${prefix} ข` },
            HR_ADMIN,
          ),
        ),
      ),
    ).toEqual(["LONG-2"]);
  });

  it("shows HR admins only employees the editor opens: inactive sites are excluded even by exact code", async () => {
    const { world } = await searchWorld();
    const closedSite = await insertEmployee(world, {
      code: "EMP-DELTA",
      displayName: "Closed Site",
      warehouseId: world.warehouses.deltaA,
    });
    expect(
      value(
        await call(
          world,
          search.adminEmployees,
          { text: "EMP-DELTA" },
          HR_ADMIN,
        ),
      ),
    ).toEqual({ items: [], complete: true });
    expect(
      value(
        await call(
          world,
          search.adminEmployees,
          { text: "Closed Site" },
          HR_ADMIN,
        ),
      ).items,
    ).toEqual([]);
    // The destination agrees: the editor refuses the same record.
    expect(
      value(
        await call(world, setup.employee, { employeeId: closedSite }, HR_ADMIN),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("finds periods by exact range only within the site scope", async () => {
    const { world, adminId } = await searchWorld();
    await world.t.run(async (ctx) => {
      for (const warehouseId of [
        world.warehouses.alphaA,
        world.warehouses.bravoA,
      ])
        await ctx.db.insert("hrPeriods", {
          orgId: world.orgA,
          warehouseId,
          startDate: "2026-09-19",
          endDate: "2026-09-25",
          status: "DRAFT",
          draftVersion: 1,
          latestClosedVersion: 0,
          createdAt: 0,
          createdByUserId: adminId,
          updatedAt: 0,
          updatedByUserId: adminId,
        });
    });
    const range = { from: "2026-09-19", to: "2026-09-25" };
    expect(
      value(await call(world, search.periodsByRange, range, HR_ADMIN)).items,
    ).toHaveLength(2);
    expect(
      value(await call(world, search.periodsByRange, range, SITE_ADMIN)).items,
    ).toEqual([
      expect.objectContaining({ siteCode: "ALPHA", status: "DRAFT" }),
    ]);
    expect(
      value(
        await call(
          world,
          search.periodsByRange,
          { from: "2026-09-19", to: "2026-09-26" },
          HR_ADMIN,
        ),
      ).items,
    ).toEqual([]);
    expect(
      value(await call(world, search.periodsByRange, range, HR_ADMIN)).complete,
    ).toBe(true);
    // A second period starting the same day on one site breaks the
    // no-overlap invariant: the answer is reported incomplete, never sole.
    await world.t.run(async (ctx) => {
      await ctx.db.insert("hrPeriods", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        startDate: "2026-09-19",
        endDate: "2026-09-25",
        status: "DRAFT",
        draftVersion: 1,
        latestClosedVersion: 0,
        createdAt: 0,
        createdByUserId: adminId,
        updatedAt: 0,
        updatedByUserId: adminId,
      });
    });
    expect(
      value(await call(world, search.periodsByRange, range, SITE_ADMIN)),
    ).toMatchObject({ complete: false });
    expect(
      value(
        await call(
          world,
          search.periodsByRange,
          { from: "bad", to: "2026-09-25" },
          HR_ADMIN,
        ),
      ).items,
    ).toEqual([]);
  });
});

describe("deep-link reads by ID", () => {
  it("opens an employee editor by ID beyond the listing bound, but not outside scope or for malformed IDs", async () => {
    const { world, ids } = await searchWorld();
    for (let index = 0; index < 100; index += 1)
      await insertEmployee(world, {
        code: `A-${String(index).padStart(3, "0")}`,
        displayName: `Filler ${index}`,
        warehouseId: world.warehouses.alphaA,
      });
    const listed = value(await call(world, setup.listEmployees, {}, HR_ADMIN));
    expect(listed.complete).toBe(false);
    expect(
      listed.items.some((item: { id: string }) => item.id === ids.inactive),
    ).toBe(false);
    expect(
      value(
        await call(
          world,
          setup.employee,
          { employeeId: ids.inactive },
          HR_ADMIN,
        ),
      ),
    ).toMatchObject({
      ok: true,
      employee: { code: "EMP-006", status: "INACTIVE", siteCode: "ALPHA" },
    });
    for (const employeeId of [ids.otherSite, ids.foreign, "not-an-id", ""])
      expect(
        value(await call(world, setup.employee, { employeeId }, SITE_ADMIN)),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await call(world, setup.employee, { employeeId: ids.report }, SUPERVISOR),
    ).toMatchObject({ ok: false });
  });

  it("answers malformed and out-of-scope review targets as NOT_FOUND", async () => {
    const { world, ids } = await searchWorld();
    for (const employeeId of [
      "javascript:alert(1)",
      ids.otherTeam,
      ids.foreign,
    ])
      expect(
        value(
          await call(
            world,
            review.dayDetail,
            { employeeId, businessDate: "2026-10-08" },
            SUPERVISOR,
          ),
        ),
      ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(
      value(
        await call(
          world,
          review.dayDetail,
          { employeeId: ids.report, businessDate: "2026-13-40" },
          SUPERVISOR,
        ),
      ),
    ).toMatchObject({ ok: false, code: "DATE_INVALID" });
  });
});

const intentModules = {
  "../convex/lib/tenantFunctions.ts": () =>
    import("../../convex/lib/tenantFunctions"),
  "../convex/hr/navigationIntent.ts": () =>
    import("../../convex/hr/navigationIntent"),
};
const NO_CONTEXT = { page: null, employee: false, date: false, period: false };

function providerAnswer(intent: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              kind: "OPEN_PAGE",
              page: null,
              settingsSection: null,
              employeeFocus: null,
              employeeCode: null,
              employeeName: null,
              dateText: null,
              useContextEmployee: false,
              useContextDate: false,
              useContextPeriod: false,
              clarify: null,
              unsupportedTopic: null,
              ...intent,
            }),
          },
        },
      ],
    }),
    { status: 200 },
  );
}

describe("AI intent action", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-not-real");
    vi.stubEnv("OPENROUTER_SEARCH_MODEL", "test/search-model");
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const interpret = (
    world: ConvexTenantWorld,
    subject: string,
    query: string,
    context = NO_CONTEXT,
  ) =>
    world.t
      .withIdentity({ subject, org_id: "org_fixture_a" })
      .action(api.hr.navigationIntent.interpret, { query, context });

  it("sends one request with only the query and page flags, and grounds the answer", async () => {
    const { world } = await searchWorld(intentModules);
    fetchMock.mockResolvedValueOnce(
      providerAnswer({
        kind: "TEAM_DAY_REVIEW",
        employeeCode: "EMP-002",
        dateText: "8 ต.ค. 2569",
      }),
    );
    const outcome = await interpret(
      world,
      SUPERVISOR,
      "ตรวจคำขอ EMP-002 วันที่ 8 ต.ค. 2569",
    );
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        ok: true,
        intent: {
          kind: "TEAM_DAY_REVIEW",
          employee: { ref: "CODE", code: "EMP-002" },
          date: { ref: "DATE", date: "2026-10-08", inferredYear: false },
          dropped: [],
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("test/search-model");
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    // The reasoning-endpoint-compatible body (no temperature/max_tokens).
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_tokens");
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.max_completion_tokens).toBe(1200);
    // No HR record is sent: only the user's own text and page flags.
    const sent = String(init?.body);
    for (const leaked of ["สมชาย", "EMP-001", "EMP-003", "ALPHA"])
      expect(sent).not.toContain(leaked);
  });

  it("drops a hallucinated code or date even when a real record has it", async () => {
    const { world } = await searchWorld(intentModules);
    fetchMock.mockResolvedValueOnce(
      providerAnswer({
        kind: "TEAM_DAY_REVIEW",
        employeeCode: "EMP-002",
        employeeName: "สมชาย",
        dateText: "8 ต.ค.",
      }),
    );
    const outcome = (await interpret(world, SUPERVISOR, "ตรวจคำขอของทีม")) as {
      value: { intent: Record<string, unknown> };
    };
    expect(outcome.value.intent).toMatchObject({
      employee: null,
      date: null,
      dropped: expect.arrayContaining(["CODE", "NAME", "DATE"]),
    });
  });

  it("refuses malformed provider output, provider errors and timeouts as typed failures", async () => {
    const { world } = await searchWorld(intentModules);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"kind":"RUN_JS","url":"x"}' } }],
        }),
      ),
    );
    expect(await interpret(world, SUPERVISOR, "เปิดหน้า")).toMatchObject({
      value: { ok: false, code: "AI_UNREADABLE" },
    });
    fetchMock.mockResolvedValueOnce(new Response("busy", { status: 503 }));
    expect(await interpret(world, SUPERVISOR, "เปิดหน้า")).toMatchObject({
      value: { ok: false, code: "AI_UNAVAILABLE" },
    });
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    expect(await interpret(world, SUPERVISOR, "เปิดหน้า")).toMatchObject({
      value: { ok: false, code: "AI_TIMEOUT" },
    });
  });

  it("reports AI unavailable without a key or search model and never calls the provider", async () => {
    const { world } = await searchWorld(intentModules);
    vi.stubEnv("OPENROUTER_SEARCH_MODEL", "");
    expect(await interpret(world, EMPLOYEE, "ลืมลงเวลาเมื่อวาน")).toMatchObject(
      {
        value: { ok: false, code: "AI_UNAVAILABLE" },
      },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces a persisted per-actor quota before any provider call", async () => {
    const { world } = await searchWorld(intentModules);
    fetchMock.mockImplementation(async () =>
      providerAnswer({ page: "hr.today" }),
    );
    for (let index = 0; index < AI_SEARCH_RATE_LIMIT.limit; index += 1)
      expect(await interpret(world, EMPLOYEE, "ลงเวลา")).toMatchObject({
        value: { ok: true },
      });
    const limited = await interpret(world, EMPLOYEE, "ลงเวลา");
    expect(limited).toMatchObject({
      value: { ok: false, code: "RATE_LIMITED" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(AI_SEARCH_RATE_LIMIT.limit);
    // Another actor has an independent quota.
    expect(await interpret(world, SUPERVISOR, "ลงเวลา")).toMatchObject({
      value: { ok: true },
    });
    const rows = await world.t.run((ctx) =>
      ctx.db.query("actionQuotas").collect(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.key === "hr.search.ai")).toBe(true);
  });

  it("denies members without HR access before consuming quota or calling the provider", async () => {
    const { world } = await searchWorld(intentModules);
    expect(await interpret(world, MANAGER, "ลงเวลา")).toMatchObject({
      ok: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await world.t.run((ctx) => ctx.db.query("actionQuotas").collect()),
    ).toEqual([]);
  });

  it("rejects page context outside the allowlist at the validator", async () => {
    const { world } = await searchWorld(intentModules);
    await expect(
      world.t
        .withIdentity({ subject: EMPLOYEE, org_id: "org_fixture_a" })
        .action(api.hr.navigationIntent.interpret, {
          query: "ลงเวลา",
          context: { ...NO_CONTEXT, page: "admin.secret" as never },
        }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
