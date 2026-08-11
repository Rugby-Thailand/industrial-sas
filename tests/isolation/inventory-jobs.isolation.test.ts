/**
 * Isolation tier — the reconciliation and expiry drivers, from two tenants.
 *
 * A job sweeps a whole warehouse, which makes it the surface most likely to
 * over-read: it is the one place in the system that deliberately walks an entire
 * index. Every claim here is a two-tenant claim, and this tier is a blocking
 * merge gate (`INV-0012-02`, `RG-031`).
 *
 * All data is synthetic (`tests/fixtures/README.md`).
 */
import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import { planExpiry, reconcileWarehouse } from "../../convex/inventory/jobs";
import { postTransaction } from "../../convex/inventory/ledger";
import type { DataModel } from "../../convex/schema";
import {
  createConvexInventoryWorld,
  FIXTURE_UOM,
  type ConvexInventoryWorld,
} from "../fixtures/convex-inventory-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const run = (value: unknown) => value as RuntimeFunction;

const identity = (org: "a" | "b") => ({
  subject: "user_fixture_a",
  org_id: `org_fixture_${org}`,
});

async function callAs(
  world: ConvexInventoryWorld,
  org: "a" | "b",
  fn: unknown,
  args: unknown,
): Promise<Record<string, unknown>> {
  return (await world.t
    .withIdentity(identity(org))
    .run(async (ctx) =>
      run(fn)._handler(ctx as GenericMutationCtx<DataModel>, args),
    )) as Record<string, unknown>;
}

function value(outcome: Record<string, unknown>): Record<string, unknown> {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
}

/** Post one balanced receipt for the named tenant. */
async function post(
  world: ConvexInventoryWorld,
  org: "a" | "b",
  input: {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly locationId: string;
    readonly itemId: string;
    readonly lotId: string;
    readonly minorUnits: number;
  },
): Promise<void> {
  const outcome = value(
    await callAs(world, org, postTransaction, {
      warehouseId: input.warehouseId,
      requestId: input.requestId,
      type: "RECEIPT",
      source: { type: "TEST", id: input.requestId },
      lines: [
        {
          itemId: input.itemId,
          locationKind: "PHYSICAL",
          locationId: input.locationId,
          lotId: input.lotId,
          stockStatus: "AVAILABLE",
          quantity: { uom: FIXTURE_UOM, minorUnits: input.minorUnits },
        },
        {
          itemId: input.itemId,
          locationKind: "VIRTUAL",
          virtualBoundary: "SUPPLIER_RECEIPT",
          lotId: input.lotId,
          stockStatus: "AVAILABLE",
          quantity: { uom: FIXTURE_UOM, minorUnits: -input.minorUnits },
        },
      ],
    }),
  );
  expect(outcome["posted"], JSON.stringify(outcome)).toBe(true);
}

/** Give both tenants stock, so neither sweep can be empty by accident. */
async function seedBothTenants(world: ConvexInventoryWorld): Promise<void> {
  await post(world, "a", {
    requestId: "0193f2c1-0000-7000-8000-0000000000a1",
    warehouseId: world.warehouses.alphaA,
    locationId: world.a.rack,
    itemId: world.a.item,
    lotId: world.a.lot,
    minorUnits: 7_000,
  });
  await post(world, "b", {
    requestId: "0193f2c1-0000-7000-8000-0000000000b1",
    warehouseId: world.warehouses.alphaB,
    locationId: world.b.rack,
    itemId: world.b.item,
    lotId: world.b.lot,
    minorUnits: 9_000,
  });
}

describe("job drivers are tenant-confined", () => {
  it("sweeps only the calling tenant's balances", async () => {
    const world = await createConvexInventoryWorld();
    await seedBothTenants(world);

    const a = value(
      await callAs(world, "a", reconcileWarehouse, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const b = value(
      await callAs(world, "b", reconcileWarehouse, {
        warehouseId: world.warehouses.alphaB,
      }),
    );

    const ownBalances = await world.t.run(async (ctx) =>
      ctx.db.query("inventoryBalances").collect(),
    );
    const countFor = (orgId: string) =>
      ownBalances.filter((row) => row.orgId === orgId).length;

    expect(a["bucketsChecked"]).toBe(countFor(world.orgA));
    expect(b["bucketsChecked"]).toBe(countFor(world.orgB));
    // Both tenants have rows, so neither count is trivially zero.
    expect(a["bucketsChecked"]).toBeGreaterThan(0);
    expect(b["bucketsChecked"]).toBeGreaterThan(0);
  });

  it("reports no drift caused by the other tenant's rows", async () => {
    /*
     * The failure this catches: a reconciliation whose line read forgot the
     * organization would fold *both* tenants' lines into one bucket total and
     * report drift on a warehouse that is perfectly consistent.
     */
    const world = await createConvexInventoryWorld();
    await seedBothTenants(world);

    const a = value(
      await callAs(world, "a", reconcileWarehouse, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    expect(a["drift"]).toEqual([]);
  });

  it("does not let one tenant's corruption show up in another's report", async () => {
    const world = await createConvexInventoryWorld();
    await seedBothTenants(world);

    await world.t.run(async (ctx) => {
      const balances = await ctx.db.query("inventoryBalances").collect();
      const target = balances.find((row) => row.orgId === world.orgB);
      if (target === undefined) throw new Error("fixture: no B balance");
      await ctx.db.patch("inventoryBalances", target._id, {
        quantity: { uom: FIXTURE_UOM, minorUnits: 123_456 },
      });
    });

    const a = value(
      await callAs(world, "a", reconcileWarehouse, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const b = value(
      await callAs(world, "b", reconcileWarehouse, {
        warehouseId: world.warehouses.alphaB,
      }),
    );

    expect(a["drift"]).toEqual([]);
    expect((b["drift"] as unknown[]).length).toBeGreaterThan(0);
  });

  it("refuses a sweep of another tenant's warehouse before authorization", async () => {
    const world = await createConvexInventoryWorld();

    for (const fn of [reconcileWarehouse, planExpiry]) {
      let refused = false;
      try {
        await callAs(world, "a", fn, {
          warehouseId: world.warehouses.alphaB,
        });
      } catch (error) {
        refused = true;
        const data = (error as { readonly data?: Record<string, unknown> })
          .data;
        expect(data?.["kind"]).toBe("TENANT_CONTEXT_DENIED");
        expect(data?.["code"]).toBe("WAREHOUSE_UNKNOWN");
      }
      expect(refused).toBe(true);
    }
  });

  it("does not let a checkpoint from one tenant walk another's index", async () => {
    /*
     * A checkpoint crosses the wire, so its cursor is untrusted input. Resuming
     * tenant A's sweep while acting as tenant B must not read A's rows: the
     * index is `orgId`-first and the accessor binds the organization.
     */
    const world = await createConvexInventoryWorld();
    await seedBothTenants(world);

    const a = value(
      await callAs(world, "a", reconcileWarehouse, {
        warehouseId: world.warehouses.alphaA,
        maxPageSize: 1,
      }),
    );
    expect(a["status"]).toBe("BUDGET_EXHAUSTED");

    const balances = await world.t.run(async (ctx) =>
      ctx.db.query("inventoryBalances").collect(),
    );
    const bCount = balances.filter((row) => row.orgId === world.orgB).length;

    let total = 0;
    let current: Record<string, unknown> | undefined = undefined;
    let guard = 0;
    for (;;) {
      const args: Record<string, unknown> = {
        warehouseId: world.warehouses.alphaB,
        maxPageSize: 1,
      };
      // The first resume deliberately uses tenant A's checkpoint.
      args["checkpoint"] = current?.["checkpoint"] ?? a["checkpoint"];

      current = value(await callAs(world, "b", reconcileWarehouse, args));
      total += current["bucketsChecked"] as number;
      if (current["status"] !== "BUDGET_EXHAUSTED") break;
      expect((guard += 1)).toBeLessThan(20);
    }

    // Whatever the foreign cursor did to the starting position, the sweep never
    // read more rows than tenant B owns.
    expect(total).toBeLessThanOrEqual(bCount);
  });

  it("plans expiry only over the calling tenant's stock", async () => {
    const world = await createConvexInventoryWorld();
    await world.t.run(async (ctx) => {
      await ctx.db.patch("lots", world.a.lot, { expirationDate: "2020-01-01" });
      await ctx.db.patch("lots", world.b.lot, { expirationDate: "2020-01-01" });
    });
    await seedBothTenants(world);

    const a = value(
      await callAs(world, "a", planExpiry, {
        warehouseId: world.warehouses.alphaA,
        asOf: "2026-08-11",
      }),
    );
    const b = value(
      await callAs(world, "b", planExpiry, {
        warehouseId: world.warehouses.alphaB,
        asOf: "2026-08-11",
      }),
    );

    const aKeys = (a["expired"] as { bucketKey: string }[]).map(
      (row) => row.bucketKey,
    );
    const bKeys = (b["expired"] as { bucketKey: string }[]).map(
      (row) => row.bucketKey,
    );

    expect(aKeys.length).toBeGreaterThan(0);
    expect(bKeys.length).toBeGreaterThan(0);
    expect(aKeys.some((key) => bKeys.includes(key))).toBe(false);
    // Every reported key names the calling tenant's organization.
    for (const key of aKeys) expect(key).toContain(world.orgA);
    for (const key of bKeys) expect(key).toContain(world.orgB);
  });

  it("neither driver writes anything for either tenant", async () => {
    const world = await createConvexInventoryWorld();
    await seedBothTenants(world);

    const snapshot = async () =>
      await world.t.run(async (ctx) => ({
        transactions: (await ctx.db.query("inventoryTransactions").collect())
          .length,
        lines: (await ctx.db.query("inventoryLedgerLines").collect()).length,
        balances: (await ctx.db.query("inventoryBalances").collect()).length,
        audit: (await ctx.db.query("auditEvents").collect()).length,
      }));

    const before = await snapshot();
    await callAs(world, "a", reconcileWarehouse, {
      warehouseId: world.warehouses.alphaA,
    });
    await callAs(world, "a", planExpiry, {
      warehouseId: world.warehouses.alphaA,
    });
    await callAs(world, "b", reconcileWarehouse, {
      warehouseId: world.warehouses.alphaB,
    });

    expect(await snapshot()).toEqual(before);
  });
});
