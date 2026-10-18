import { makeFunctionReference } from "convex/server";
import { expect, it } from "vitest";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "@tests/fixtures/convex-tenant-world";

it("a malformed personal request deep link must answer NOT_FOUND without throwing", async () => {
  const world = await createConvexTenantWorld({
    "../convex/hr/self.ts": () => import("../../../../../convex/hr/self"),
  });
  await seedConvexAuthorization(world, {
    roleA: "HR_EMPLOYEE",
    roleB: "HR_EMPLOYEE",
  });
  await world.t.run((ctx) =>
    ctx.db.insert("hrEmployees", {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      userId: world.userA,
      code: "ROOT-PROBE",
      displayName: "Root probe",
      employmentStartDate: "2020-01-01",
      status: "ACTIVE",
      version: 1,
      createdAt: 1,
      createdByUserId: world.userA,
      updatedAt: 1,
      updatedByUserId: world.userA,
    }),
  );
  const detail = makeFunctionReference<
    "query",
    { correctionId: string },
    unknown
  >("hr/self:requestDetail");
  await expect(
    world.t
      .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
      .query(detail, { correctionId: "not-a-convex-id" }),
  ).resolves.toMatchObject({
    ok: true,
    value: { ok: false, code: "NOT_FOUND" },
  });
});
