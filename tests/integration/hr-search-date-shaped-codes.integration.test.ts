import { expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { readReferences } from "../../convex/model/search/references";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

it.each(["EMP-2026-10-08", "emp_2026-10-08", "emp.2026-10-08"])(
  "finds the ISO-shaped employee code %s in a natural-language query",
  async (code) => {
    const world = await createConvexTenantWorld({
      "../convex/hr/search.ts": () => import("../../convex/hr/search"),
    });
    await seedConvexAuthorization(world, { roleA: "HR_ADMIN" });
    await world.t.run((ctx) =>
      ctx.db.insert("hrEmployees", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        code: code.toUpperCase(),
        displayName: "สมชาย ใจดี",
        employmentStartDate: "2026-01-01",
        status: "ACTIVE",
        version: 1,
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
    const control = await actor.query(api.hr.search.adminEmployees, {
      text: code,
    });
    expect(control.ok && control.value.items.length).toBe(1);
    const query = `แก้พนักงานรหัส ${code}`;
    const references = readReferences(query, "2026-10-09");
    expect
      .soft(references.codes, JSON.stringify(references))
      .toEqual([code.toUpperCase()]);
    const found = await actor.query(api.hr.search.adminEmployees, {
      text: query,
    });
    expect(found.ok, JSON.stringify(found)).toBe(true);
    expect(found.ok && found.value.items.length, JSON.stringify(found)).toBe(1);
  },
);
