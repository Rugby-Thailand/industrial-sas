import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

// Legacy overlapping periods cannot be created through today's period API,
// but existing data must still preserve every in-progress close's sources.
async function fixture() {
  const world = await createConvexTenantWorld(
    {
      "../convex/hr/setup.ts": () => import("../../convex/hr/setup"),
    },
    { transactionLimits: true },
  );
  const auth = await seedConvexAuthorization(world, { roleA: "HR_ADMIN" });
  await world.t.run((ctx) =>
    ctx.db.patch(auth.identities.membershipA, { scopeMode: "ORG_WIDE" }),
  );
  const client = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_a",
  });
  const saved = await client.mutation(api.hr.setup.saveHoliday, {
    requestId: "holiday-overlap-original",
    warehouseId: world.warehouses.alphaA,
    date: "2026-10-06",
    name: "Original holiday",
  });
  if (!saved.ok || !saved.value.written)
    throw new Error("Holiday fixture failed");
  await world.t.run(async (ctx) => {
    for (const period of [
      {
        status: "CLOSED" as const,
        startDate: "2026-10-01",
        endDate: "2026-10-07",
      },
      {
        status: "CLOSING" as const,
        startDate: "2026-10-05",
        endDate: "2026-10-10",
      },
    ])
      await ctx.db.insert("hrPeriods", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        ...period,
        draftVersion: 1,
        latestClosedVersion: period.status === "CLOSED" ? 1 : 0,
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
  });
  return {
    world,
    client,
    holidayId: saved.value.documentId as Id<"hrHolidays">,
  };
}

describe("holiday writes with legacy overlapping periods", () => {
  it.each(["create", "rename", "delete"] as const)(
    "refuses holiday %s when an earlier CLOSED period hides a covering CLOSING period",
    async (operation) => {
      const { world, client, holidayId } = await fixture();
      const before = await client.query(api.hr.setup.listHolidays, {
        warehouseId: world.warehouses.alphaA,
      });
      const result =
        operation === "delete"
          ? await client.mutation(api.hr.setup.deleteHoliday, {
              requestId: "holiday-overlap-delete",
              holidayId,
            })
          : await client.mutation(api.hr.setup.saveHoliday, {
              requestId: `holiday-overlap-${operation}`,
              warehouseId: world.warehouses.alphaA,
              date: operation === "create" ? "2026-10-05" : "2026-10-06",
              name: "Changed holiday",
            });
      expect(result).toMatchObject({
        ok: true,
        value: { written: false, error: { code: "HR_PERIOD_CLOSING" } },
      });
      const after = await client.query(api.hr.setup.listHolidays, {
        warehouseId: world.warehouses.alphaA,
      });
      if (!before.ok || !after.ok) throw new Error("Holiday read denied");
      expect(after.value).toEqual(before.value);
    },
  );

  it.each(["2026-10-05", "2026-10-10"])(
    "freezes the inclusive closing boundary %s",
    async (date) => {
      const { world, client } = await fixture();
      expect(
        await client.mutation(api.hr.setup.saveHoliday, {
          requestId: `holiday-boundary-${date}`,
          warehouseId: world.warehouses.alphaA,
          date,
          name: "Boundary",
        }),
      ).toMatchObject({
        ok: true,
        value: { written: false, error: { code: "HR_PERIOD_CLOSING" } },
      });
    },
  );

  it("allows dates outside the closing range and another site", async () => {
    const { world, client } = await fixture();
    for (const [index, warehouseId, date] of [
      [0, world.warehouses.alphaA, "2026-10-04"],
      [1, world.warehouses.alphaA, "2026-10-11"],
      [2, world.warehouses.bravoA, "2026-10-06"],
    ] as const) {
      expect(
        await client.mutation(api.hr.setup.saveHoliday, {
          requestId: `holiday-unrelated-${index}`,
          warehouseId,
          date,
          name: "Allowed",
        }),
      ).toMatchObject({ ok: true, value: { written: true } });
    }
  });
});
