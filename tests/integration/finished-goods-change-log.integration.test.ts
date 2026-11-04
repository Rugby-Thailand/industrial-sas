import type { GenericMutationCtx } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHANGE_RETENTION_MS,
  prune,
} from "../../convex/finishedGoods/changeLog";
import {
  finishedGoodsGeneration,
  summaryReadiness,
  trackFinishedGoodsWrites,
} from "../../convex/lib/finishedGoodsSummary";
import { createTenantDocumentAccess } from "../../convex/lib/tenantDb";
import { createMutationTenantStorage } from "../../convex/lib/tenantStorage";
import type { DataModel } from "../../convex/schema";
import { createConvexTenantWorld } from "../fixtures/convex-tenant-world";

async function world() {
  const world = await createConvexTenantWorld();
  const warehouseId = world.warehouses.alphaA;
  const palletId = await world.t.run(async (ctx) => {
    const audit = {
      orgId: world.orgA,
      warehouseId,
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
    };
    const productId = await ctx.db.insert("finishedGoodsProducts", {
      ...audit,
      sku: "SKU",
      name: "Boxes",
      unit: "pieces",
      storageFormat: "PALLET",
      storageCondition: "DRY",
      status: "ACTIVE",
    });
    return ctx.db.insert("finishedGoodsPallets", {
      ...audit,
      productId,
      code: "PAL-1",
      quantity: 1,
      status: "AWAITING_MEASUREMENT",
    });
  });
  const write = (quantity: number) =>
    world.t.run(async (ctx) => {
      const db = createTenantDocumentAccess(
        { orgId: world.orgA, requestId: "change-log" },
        createMutationTenantStorage(ctx, "change-log"),
      );
      const tracked = trackFinishedGoodsWrites(db);
      await tracked.db.patch("finishedGoodsPallets", palletId, { quantity });
      await tracked.flush();
    });
  const state = () =>
    world.t.run(async (ctx) => {
      const db = createTenantDocumentAccess(
        { orgId: world.orgA, requestId: "change-log-read" },
        createMutationTenantStorage(ctx, "change-log-read"),
      );
      const readiness = await summaryReadiness(db, warehouseId);
      return {
        readiness,
        token: await finishedGoodsGeneration(
          db,
          warehouseId,
          readiness?.generation ?? 0,
        ),
        rows: await ctx.db.query("finishedGoodsChanges").collect(),
      };
    });
  return { world, warehouseId, write, state };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("finished-goods change log", () => {
  it("appends a marker per write instead of patching the shared readiness row", async () => {
    const { write, state } = await world();
    await write(2);
    const first = await state();
    expect(first.rows).toHaveLength(1);
    await write(3);
    const second = await state();
    // Writers never read-modify-write the readiness row again (no OCC hot spot)…
    expect(second.readiness!._id).toBe(first.readiness!._id);
    expect(second.readiness!.generation).toBe(first.readiness!.generation);
    // …yet the continuation token still moves on every committed write.
    expect(second.rows).toHaveLength(2);
    expect(second.token).toBeGreaterThan(first.token);
  });

  it("prunes markers past retention but keeps the newest token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    const { world: w, write, state } = await world();
    await write(2);
    await write(3);
    vi.setSystemTime(Date.now() + CHANGE_RETENTION_MS + 60_000);
    const before = await state();
    const result = await w.t.run((ctx) =>
      (
        prune as unknown as {
          _handler(
            ctx: GenericMutationCtx<DataModel>,
            args: unknown,
          ): Promise<{ deleted: number; more: boolean }>;
        }
      )._handler(ctx, {}),
    );
    const after = await state();
    expect(result).toEqual({ deleted: 1, more: false });
    expect(after.rows).toHaveLength(1);
    expect(after.token).toBe(before.token);
    await write(4);
    expect((await state()).token).toBeGreaterThan(after.token);
  });
});
