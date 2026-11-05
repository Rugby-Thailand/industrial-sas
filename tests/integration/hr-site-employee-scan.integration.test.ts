import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { employeesInRange, siteEmployeesInRange } from "../../convex/hr/shared";
import {
  createTenantDocumentAccess,
  type TenantDocumentAccess,
} from "../../convex/lib/tenantDb";
import type { TenantFunctionContext } from "../../convex/lib/tenantFunctions";
import { createMutationTenantStorage } from "../../convex/lib/tenantStorage";
import { createConvexTenantWorld } from "../fixtures/convex-tenant-world";

/**
 * The site employee scan behind period preview and review scoping stops as
 * soon as more than `limit` employed rows prove the answer (null), and
 * otherwise equals the complete read: same rows, same index order, same
 * refusal when the budget is too small.
 */
async function site(
  rows: readonly { code: string; employed: boolean }[],
): Promise<{
  run: <T>(
    fn: (ctx: TenantFunctionContext, counted: { rows: number }) => Promise<T>,
  ) => Promise<T>;
  warehouseId: Id<"warehouses">;
}> {
  const w = await createConvexTenantWorld();
  await w.t.run(async (ctx) => {
    for (const [index, row] of rows.entries())
      await ctx.db.insert("hrEmployees", {
        orgId: w.orgA,
        warehouseId: w.warehouses.alphaA,
        code: row.code,
        displayName: `Employee ${index}`,
        // Not employed in October 2026: left before it started.
        employmentStartDate: "2025-01-01",
        ...(row.employed ? {} : { employmentEndDate: "2025-06-30" }),
        status: "ACTIVE",
        schedule: {
          workDays: [1, 2, 3, 4, 5],
          startTime: "09:00",
          endTime: "18:00",
          endsNextDay: false,
          breakMinutes: 60,
        },
        version: 1,
        createdAt: 1,
        createdByUserId: w.userA,
        updatedAt: 1,
        updatedByUserId: w.userA,
      });
  });
  return {
    warehouseId: w.warehouses.alphaA,
    run: (fn) =>
      w.t.run((ctx) => {
        const counted = { rows: 0 };
        const db = createTenantDocumentAccess(
          { orgId: w.orgA, requestId: "site-employee-scan" },
          createMutationTenantStorage(ctx, "site-employee-scan"),
        );
        // Count every employee row returned by an index read.
        const tenantDb: TenantDocumentAccess = {
          ...db,
          byIndex: ((...args: Parameters<typeof db.byIndex>) => {
            const reader = db.byIndex(...args);
            const count = <R extends unknown[]>(p: Promise<R>) =>
              p.then((value) => {
                counted.rows += value.length;
                return value;
              });
            return {
              ...reader,
              take: (n: number) => count(reader.take(n)),
              all: (n: number) => count(reader.all(n)),
            };
          }) as typeof db.byIndex,
        };
        return fn({ tenantDb } as unknown as TenantFunctionContext, counted);
      }),
  };
}

const whole = (
  ctx: TenantFunctionContext,
  warehouseId: string,
  limit: number,
) =>
  employeesInRange(
    ctx.tenantDb.byIndex("hrEmployees", "by_orgId_warehouseId_code", [
      { field: "warehouseId", value: warehouseId },
    ]),
    "2026-10-01",
    "2026-10-31",
    limit,
  );
const chunked = (
  ctx: TenantFunctionContext,
  warehouseId: string,
  limit: number,
  budget?: { remaining: number },
) =>
  siteEmployeesInRange(
    ctx,
    warehouseId,
    "2026-10-01",
    "2026-10-31",
    limit,
    budget,
  );
const ids = (rows: readonly { _id: string }[] | null) =>
  rows?.map((row) => row._id) ?? null;

describe("site employee scan", () => {
  it("refuses a large site after the first rows that prove it, not the workforce", async () => {
    const s = await site(
      Array.from({ length: 765 }, (_, index) => ({
        code: `E${String(index).padStart(4, "0")}`,
        employed: true,
      })),
    );
    const result = await s.run(async (ctx, counted) => {
      const answer = await chunked(ctx, s.warehouseId, 50);
      return { answer, rows: counted.rows };
    });
    expect(result.answer).toBeNull();
    // One 100-row chunk holds the 51st employed row (was: all 765).
    expect(result.rows).toBe(100);
  });

  it("returns the same employed rows in index order as the complete read", async () => {
    // 40 employed among 260 rows, so the scan runs past several chunks;
    // duplicated codes straddle chunk boundaries.
    const rows = Array.from({ length: 260 }, (_, index) => ({
      code: `E${String(Math.floor(index / 3)).padStart(4, "0")}`,
      employed: index % 13 === 0 || index % 17 === 0,
    }));
    const s = await site(rows);
    const [expected, actual] = await s.run(async (ctx) => [
      ids(await whole(ctx, s.warehouseId, 50)),
      ids(await chunked(ctx, s.warehouseId, 50)),
    ]);
    expect(expected).not.toBeNull();
    expect(actual).toEqual(expected);
  });

  it("matches the complete read when every row shares one code", async () => {
    const s = await site(
      Array.from({ length: 130 }, (_, index) => ({
        code: "SAME",
        employed: index % 4 === 0,
      })),
    );
    const [expected, actual] = await s.run(async (ctx) => [
      ids(await whole(ctx, s.warehouseId, 50)),
      ids(await chunked(ctx, s.warehouseId, 50)),
    ]);
    expect(actual).toEqual(expected);
  });

  it("refuses when the budget cannot cover the site, as the complete read does", async () => {
    const s = await site(
      Array.from({ length: 120 }, (_, index) => ({
        code: `E${String(index).padStart(4, "0")}`,
        employed: index % 10 === 0,
      })),
    );
    const answers = await s.run(async (ctx) => {
      const tight = { remaining: 119 };
      const exact = { remaining: 120 };
      return {
        tight: await chunked(ctx, s.warehouseId, 50, tight),
        tightLeft: tight.remaining,
        exact: ids(await chunked(ctx, s.warehouseId, 50, exact)),
        exactLeft: exact.remaining,
        whole: ids(await whole(ctx, s.warehouseId, 50)),
      };
    });
    expect(answers.tight).toBeNull();
    expect(answers.tightLeft).toBe(0);
    expect(answers.exact).toEqual(answers.whole);
    expect(answers.exactLeft).toBe(0);
  });
});
