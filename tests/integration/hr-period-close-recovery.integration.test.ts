import type { GenericMutationCtx } from "convex/server";
import { expect, it } from "vitest";
import { reconcileRequest } from "../../convex/hr/recovery";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

type Handler = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};

it("can fence interrupted begin and cancel commands using their real operation names", async () => {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "HR_ADMIN" });
  const results: unknown[] = [];
  let resolved = 0;
  for (const operation of ["hr.period.beginClose", "hr.period.cancelClose"]) {
    const answer = (await world.t
      .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
      .run((ctx) =>
        (reconcileRequest as unknown as Handler)._handler(
          ctx as GenericMutationCtx<DataModel>,
          { operation, requestId: "interrupted-close-request" },
        ),
      )) as {
      ok: boolean;
      value: { resolved: boolean; code?: string; status?: string };
    };
    expect(answer.ok).toBe(true);
    expect(answer.value).toMatchObject({ resolved: true, status: "FENCED" });
    results.push({ operation, ...answer.value });
    if (answer.value.resolved) resolved++;
  }
  expect(resolved, JSON.stringify(results)).toBe(2);
});
