import type { GenericMutationCtx } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";

import * as periods from "../../convex/hr/periods";
import * as review from "../../convex/hr/review";
import * as self from "../../convex/hr/self";
import { addDays } from "../../convex/model/hr/calendar";
import { HR_DEMO_CONFIRMATION, seed } from "../../convex/staging/hrDemo";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

type Runtime = {
  _handler: (ctx: GenericMutationCtx<DataModel>, args: unknown) => Promise<any>;
};
const run = (fn: unknown, ctx: unknown, args: unknown) =>
  (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args);

afterEach(() => vi.unstubAllEnvs());

it("refuses to seed without the local guard", async () => {
  const world = await createConvexTenantWorld();
  await expect(
    world.t.run((ctx) =>
      run(seed, ctx, {
        warehouseId: world.warehouses.alphaA,
        actorUserId: world.userA,
        confirmation: HR_DEMO_CONFIRMATION,
      }),
    ),
  ).rejects.toThrow("disabled");
});

it("seeds an idempotent, usable local HR demonstration", async () => {
  vi.stubEnv("ALLOW_LOCAL_TEST_SEED", "true");
  vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  await world.t.run((ctx) =>
    ctx.db
      .query("memberships")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", world.orgA).eq("userId", world.userA),
      )
      .unique()
      .then((membership) =>
        ctx.db.patch(membership!._id, { scopeMode: "ORG_WIDE" }),
      ),
  );
  const args = {
    warehouseId: world.warehouses.alphaA,
    actorUserId: world.userA,
    confirmation: HR_DEMO_CONFIRMATION,
  };
  const first = await world.t.run((ctx) => run(seed, ctx, args));
  expect(first).toMatchObject({ created: true, employees: 3 });
  expect(await world.t.run((ctx) => run(seed, ctx, args))).toMatchObject({
    created: false,
  });

  const as = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_a",
  });
  const today = await as.run((ctx) => run(self.today, ctx, {}));
  expect(today.value.employee.code).toBe("EMP-DEMO-001");
  expect(["NOT_CLOCKED_IN", "NONWORKING", "CLOCKED_OUT"]).toContain(
    today.value.state,
  );
  const preview = await as.run((ctx) =>
    run(periods.preview, ctx, { periodId: first.periodId }),
  );
  expect(preview.value.period).toMatchObject({
    status: "DRAFT",
    draftVersion: 2,
    latestClosedVersion: 1,
  });
  expect(preview.value.view.blocker).toBeNull();
  expect(preview.value.versions).toHaveLength(1);
  const queue = await as.run((ctx) =>
    run(review.queue, ctx, {
      from: addDays(today.value.today, -12),
      to: today.value.today,
    }),
  );
  const issues = queue.value.items.map(
    (item: { issue?: string }) => item.issue,
  );
  expect(issues).toContain("PENDING_CORRECTION");
  expect(issues).toContain("MISSING_RECORD");
});
