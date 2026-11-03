/** Legacy inline payloads still exercise byte-limited employee pagination. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { POLICY_PRESET, thailandDefaults } from "../../convex/model/hr/policy";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const now = Date.UTC(2026, 9, 12, 3);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

async function fixture() {
  const world = await createConvexTenantWorld(
    { "../convex/hr/payslips.ts": () => import("../../convex/hr/payslips") },
    { transactionLimits: true },
  );
  await seedConvexAuthorization(world, {
    roleA: "HR_ADMIN",
    roleB: "HR_ADMIN",
  });
  const { employeeId, otherEmployeeId, importId } = await world.t.run(
    async (ctx) => {
      const employee = (code: string, linked: boolean) =>
        ctx.db.insert("hrEmployees", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          code,
          displayName: code,
          ...(linked ? { userId: world.userA } : {}),
          employmentStartDate: "2020-01-01",
          status: "ACTIVE",
          version: 1,
          createdAt: now,
          updatedAt: now,
          createdByUserId: world.userA,
          updatedByUserId: world.userA,
        });
      const employeeId = await employee("E1", true);
      const otherEmployeeId = await employee("E2", false);
      const policyId = await ctx.db.insert("hrPolicyVersions", {
        orgId: world.orgA,
        capability: "PAYSLIPS",
        config: thailandDefaults(),
        effectiveDate: "2026-10-01",
        version: 1,
        draftVersion: 1,
        preset: POLICY_PRESET,
        coverageConfirmed: true,
        existingBenefitsReviewed: true,
        activatedAt: now,
        activatedByUserId: world.userA,
      });
      const importId = await ctx.db.insert("hrPayslipImports", {
        orgId: world.orgA,
        from: "2026-10-01",
        to: "2026-10-31",
        sourceName: "legacy.csv",
        sourceCsv: "",
        sourceHash: "legacy",
        policyVersionId: policyId,
        status: "PUBLISHED",
        rowCount: 15,
        createdAt: now,
        createdByUserId: world.userA,
      });
      return { employeeId, otherEmployeeId, importId };
    },
  );
  const published: Id<"hrPayslipRows">[] = [];
  // Seed separately so only the registered query's transaction is measured.
  // Every row has the same indexed period; native creation order supplies
  // the remaining cursor keys instead of a hand-rolled period cursor.
  for (let index = 0; index < 15; index++) {
    const isPublished = index < 12 && index % 3 !== 1;
    const id = await world.t.run((ctx) =>
      ctx.db.insert("hrPayslipRows", {
        orgId: world.orgA,
        importId,
        employeeId,
        warehouseId: world.warehouses.alphaA,
        employeeCode: "E1",
        employeeName: "E1",
        from: "2026-10-01",
        to: "2026-10-31",
        paymentDate: "2026-10-30",
        gross: 100,
        deductions: 0,
        net: 100,
        sourceBase64: "A".repeat(200_000),
        sourceHash: "legacy-fixture",
        version: index + 1,
        ...(isPublished ? { publishedAt: now } : {}),
      }),
    );
    if (isPublished) published.unshift(id);
  }
  // A newer, published row belonging to another employee must remain hidden.
  await world.t.run(async (ctx) => {
    const row = await ctx.db.get(published[0]!);
    if (!row) throw new Error("Missing fixture row");
    const { _id, _creationTime, ...fields } = row;
    void _id;
    void _creationTime;
    await ctx.db.insert("hrPayslipRows", {
      ...fields,
      employeeId: otherEmployeeId,
    });
  });
  return { world, employeeId, published };
}

it("preserves every published employee statement across native byte splits, tied periods and empty filtered pages", async () => {
  const { world, employeeId, published } = await fixture();
  // Observe the installed native contract independently of the public adapter.
  const native = await world.t.run((ctx) =>
    ctx.db
      .query("hrPayslipRows")
      .withIndex("by_orgId_employeeId_from", (q) =>
        q.eq("orgId", world.orgA).eq("employeeId", employeeId),
      )
      .order("desc")
      .paginate({
        numItems: 20,
        cursor: null,
        maximumRowsRead: 101,
        maximumBytesRead: 524_288,
      }),
  );
  expect(native.pageStatus).toBe("SplitRequired");
  expect(native.splitCursor).toBeTruthy();
  expect(native.page).toHaveLength(3);
  expect(native.isDone).toBe(false);

  const read = (cursor?: string) =>
    world.t
      .withIdentity(identity)
      .query(api.hr.payslips.list, cursor ? { cursor } : {});
  let response = await read();
  expect(response).toMatchObject({
    ok: true,
    value: {
      ok: true,
      items: [],
      isDone: false,
      continueCursor: native.continueCursor,
    },
  });
  const ids: string[] = [];
  const cursors = new Set<string>();
  let pages = 0;
  let shortPublishedPage = false;
  while (true) {
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error("Query denied");
    expect(response.value.ok).toBe(true);
    if (!response.value.ok) throw new Error("Employee query denied");
    const page = response.value;
    const items = page.items;
    ids.push(...items.map((row) => row.id));
    if (items.length > 0 && items.length < 20) shortPublishedPage = true;
    expect(JSON.stringify(items)).not.toMatch(
      /sourceBase64|gross|deductions|net/,
    );
    pages += 1;
    expect(pages).toBeLessThan(10);
    if (page.isDone) break;
    expect(cursors.has(page.continueCursor)).toBe(false);
    cursors.add(page.continueCursor);
    response = await read(page.continueCursor);
  }
  expect(shortPublishedPage).toBe(true);
  expect(pages).toBeGreaterThan(2);
  expect(ids).toEqual(published);
  expect(new Set(ids).size).toBe(ids.length);
});
