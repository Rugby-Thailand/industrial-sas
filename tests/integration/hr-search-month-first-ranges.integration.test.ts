import { expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { readDates } from "../../convex/model/search/dates";
import {
  groundIntent,
  NO_CONTEXT,
  type ModelIntent,
} from "../../convex/model/search/intent";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

const intent: ModelIntent = {
  kind: "TEAM_DAY_REVIEW",
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
};

it("grounds a month-first English year-boundary range as six elapsed days", async () => {
  const world = await createConvexTenantWorld({
    "../convex/hr/search.ts": () => import("../../convex/hr/search"),
  });
  await seedConvexAuthorization(world, { roleA: "HR_ADMIN" });
  await world.t.run((ctx) =>
    ctx.db.insert("hrPeriods", {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      startDate: "2026-12-28",
      endDate: "2027-01-03",
      status: "DRAFT",
      draftVersion: 1,
      latestClosedVersion: 0,
      createdAt: 0,
      updatedAt: 0,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
    }),
  );
  const actor = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_a",
  });
  const control = await actor.query(api.hr.search.periodsByRange, {
    from: "2026-12-28",
    to: "2027-01-03",
  });
  expect(control.ok && control.value.items.length).toBe(1);
  expect(
    readDates("28 December to 3 January 2027", "2026-10-09"),
  ).toMatchObject({
    kind: "ONE",
    mention: { kind: "RANGE", from: "2026-12-28", to: "2027-01-03" },
  });
  const query = "export December 28 to January 3, 2027";
  const grounded = groundIntent(
    {
      ...intent,
      kind: "PERIOD_EXPORT",
      dateText: "December 28 to January 3, 2027",
    },
    {
      query,
      today: "2026-10-09",
      context: NO_CONTEXT,
    },
  );
  const date = grounded.date;
  const days =
    date?.ref === "RANGE"
      ? (Date.parse(date.to) - Date.parse(date.from)) / 86400000
      : -1;
  expect.soft(days, JSON.stringify(grounded)).toBe(6);
  if (date?.ref !== "RANGE") throw new Error("No range");
  const found = await actor.query(api.hr.search.periodsByRange, {
    from: date.from,
    to: date.to,
  });
  expect(found.ok && found.value.items.length, JSON.stringify(found)).toBe(1);
});
