import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import {
  expirySourceStatuses,
  maxJobPageSize,
  maxPagesPerRun,
  planExpiry,
  reconcileWarehouse,
} from "../../convex/inventory/jobs";
import { postTransaction } from "../../convex/inventory/ledger";
import { EXPIRY_SOURCE_STATUSES } from "../../convex/model/inventory/expiryReclassification";
import { MAX_JOB_PAGE_SIZE } from "../../convex/model/inventory/jobPage";
import { MAX_PAGES_PER_RUN } from "../../convex/model/inventory/jobRun";
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

async function post(
  world: ConvexInventoryWorld,
  input: {
    readonly requestId: string;
    readonly locationId: string;
    readonly itemId: string;
    readonly lotId?: string;
    readonly minorUnits: number;
    readonly stockStatus?: string;
  },
): Promise<void> {
  const outcome = value(
    await callAs(world, "a", postTransaction, {
      warehouseId: world.warehouses.alphaA,
      requestId: input.requestId,
      type: "RECEIPT",
      source: { type: "TEST", id: input.requestId },
      lines: [
        {
          itemId: input.itemId,
          locationKind: "PHYSICAL",
          locationId: input.locationId,
          ...(input.lotId === undefined ? {} : { lotId: input.lotId }),
          stockStatus: input.stockStatus ?? "AVAILABLE",
          quantity: { uom: FIXTURE_UOM, minorUnits: input.minorUnits },
        },
        {
          itemId: input.itemId,
          locationKind: "VIRTUAL",
          virtualBoundary: "SUPPLIER_RECEIPT",
          ...(input.lotId === undefined ? {} : { lotId: input.lotId }),
          stockStatus: input.stockStatus ?? "AVAILABLE",
          quantity: { uom: FIXTURE_UOM, minorUnits: -input.minorUnits },
        },
      ],
    }),
  );
  expect(outcome["posted"], JSON.stringify(outcome)).toBe(true);
}

describe("reconcileWarehouse", () => {
  it("reports no drift for a warehouse whose balances match their lines", async () => {
    const world = await createConvexInventoryWorld();
    await post(world, {
      requestId: "0193f2c1-0000-7000-8000-000000000001",
      locationId: world.a.rack,
      itemId: world.a.item,
      lotId: world.a.lot,
      minorUnits: 5_000,
    });

    const result = value(
      await callAs(world, "a", reconcileWarehouse, {
        warehouseId: world.warehouses.alphaA,
      }),
    );

    expect(result["ok"]).toBe(true);
    expect(result["status"]).toBe("COMPLETE");
    expect(result["drift"]).toEqual([]);
    expect(result["bucketsChecked"]).toBeGreaterThan(0);
  });

  it("detects a balance that no longer matches its ledger lines", async () => {
    const world = await createConvexInventoryWorld();
    await post(world, {
      requestId: "0193f2c1-0000-7000-8000-000000000002",
      locationId: world.a.rack,
      itemId: world.a.item,
      lotId: world.a.lot,
      minorUnits: 5_000,
    });

    await world.t.run(async (ctx) => {
      const balances = await ctx.db.query("inventoryBalances").collect();
      const target = balances.find((row) => row.orgId === world.orgA);
      if (target === undefined)
        throw new Error("fixture: no balance to corrupt");
      await ctx.db.patch("inventoryBalances", target._id, {
        quantity: { uom: FIXTURE_UOM, minorUnits: 999_999 },
      });
    });

    const result = value(
      await callAs(world, "a", reconcileWarehouse, {
        warehouseId: world.warehouses.alphaA,
      }),
    );

    const drift = result["drift"] as { kind: string }[];
    expect(drift.length).toBeGreaterThan(0);
    expect(drift.some((record) => record.kind === "QUANTITY_MISMATCH")).toBe(
      true,
    );
  });

  it("stops at its page budget and resumes from the checkpoint", async () => {
    const world = await createConvexInventoryWorld();
    for (const [index, location] of [world.a.rack, world.a.dock].entries()) {
      await post(world, {
        requestId: `0193f2c1-0000-7000-8000-00000000010${index}`,
        locationId: location,
        itemId: world.a.item,
        lotId: world.a.lot,
        minorUnits: 1_000 * (index + 1),
      });
    }

    const first = value(
      await callAs(world, "a", reconcileWarehouse, {
        warehouseId: world.warehouses.alphaA,
        maxPageSize: 1,
      }),
    );

    expect(first["status"]).toBe("BUDGET_EXHAUSTED");
    expect(first["pagesThisRun"]).toBe(1);
    const checkpoint = first["checkpoint"] as {
      cursor: string | null;
      itemsProcessed: number;
    };
    expect(checkpoint.cursor).not.toBeNull();

    let current: Record<string, unknown> = first;
    let guard = 0;
    while (current["status"] === "BUDGET_EXHAUSTED") {
      current = value(
        await callAs(world, "a", reconcileWarehouse, {
          warehouseId: world.warehouses.alphaA,
          checkpoint: current["checkpoint"],
          maxPageSize: 1,
        }),
      );
      expect((guard += 1)).toBeLessThan(20);
    }

    expect(current["status"]).toBe("COMPLETE");

    const finalCheckpoint = current["checkpoint"] as { itemsProcessed: number };
    expect(finalCheckpoint.itemsProcessed).toBeGreaterThan(
      checkpoint.itemsProcessed,
    );
  });

  it("visits every bucket exactly once across an interrupted sweep", async () => {
    const world = await createConvexInventoryWorld();
    for (const [index, location] of [world.a.rack, world.a.dock].entries()) {
      await post(world, {
        requestId: `0193f2c1-0000-7000-8000-00000000020${index}`,
        locationId: location,
        itemId: world.a.item,
        lotId: world.a.lot,
        minorUnits: 2_000 * (index + 1),
      });
    }

    let checkpoint: unknown = undefined;
    let checked = 0;
    let guard = 0;

    for (;;) {
      const args: Record<string, unknown> = {
        warehouseId: world.warehouses.alphaA,
        maxPageSize: 1,
      };
      if (checkpoint !== undefined) args["checkpoint"] = checkpoint;

      const result = value(await callAs(world, "a", reconcileWarehouse, args));
      checked += result["bucketsChecked"] as number;
      checkpoint = result["checkpoint"];

      if (result["status"] === "COMPLETE") break;
      expect(result["status"]).toBe("BUDGET_EXHAUSTED");
      expect((guard += 1)).toBeLessThan(20);
    }

    const balances = await world.t.run(async (ctx) =>
      ctx.db.query("inventoryBalances").collect(),
    );
    const own = balances.filter((row) => row.orgId === world.orgA);
    expect(checked).toBe(own.length);
  });

  it("refuses a page size above the cap rather than clamping it", async () => {
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, "a", reconcileWarehouse, {
        warehouseId: world.warehouses.alphaA,
        maxPageSize: MAX_JOB_PAGE_SIZE + 1,
      }),
    );

    expect(result["ok"]).toBe(false);
    expect((result["error"] as { code: string }).code).toBe(
      "PAGE_SIZE_TOO_LARGE",
    );
  });

  it("reads exactly one page per invocation, as Convex requires", async () => {
    const world = await createConvexInventoryWorld();
    for (const [index, location] of [world.a.rack, world.a.dock].entries()) {
      await post(world, {
        requestId: `0193f2c1-0000-7000-8000-00000000040${index}`,
        locationId: location,
        itemId: world.a.item,
        lotId: world.a.lot,
        minorUnits: 500 * (index + 1),
      });
    }

    const result = value(
      await callAs(world, "a", reconcileWarehouse, {
        warehouseId: world.warehouses.alphaA,
        maxPageSize: 1,
      }),
    );

    expect(result["pagesThisRun"]).toBe(1);
    expect(result["status"]).toBe("BUDGET_EXHAUSTED");
  });

  it("writes nothing, because a reconciliation must not repair", async () => {
    // `OPS-0003-02`. A query cannot write, so this is the runtime's guarantee;
    // the assertion documents the intent and catches a future change of
    // registration path.
    const world = await createConvexInventoryWorld();
    await post(world, {
      requestId: "0193f2c1-0000-7000-8000-000000000003",
      locationId: world.a.rack,
      itemId: world.a.item,
      lotId: world.a.lot,
      minorUnits: 3_000,
    });

    const before = await world.t.run(async (ctx) => ({
      transactions: (await ctx.db.query("inventoryTransactions").collect())
        .length,
      balances: (await ctx.db.query("inventoryBalances").collect()).length,
      audit: (await ctx.db.query("auditEvents").collect()).length,
    }));

    await callAs(world, "a", reconcileWarehouse, {
      warehouseId: world.warehouses.alphaA,
    });

    const after = await world.t.run(async (ctx) => ({
      transactions: (await ctx.db.query("inventoryTransactions").collect())
        .length,
      balances: (await ctx.db.query("inventoryBalances").collect()).length,
      audit: (await ctx.db.query("auditEvents").collect()).length,
    }));

    expect(after).toEqual(before);
  });

  it("re-exports the caps a scheduler needs to size its own loop", () => {
    expect(maxPagesPerRun).toBe(MAX_PAGES_PER_RUN);
    expect(maxJobPageSize).toBe(MAX_JOB_PAGE_SIZE);
  });
});

describe("planExpiry", () => {
  it("finds stock whose lot expired before the business date", async () => {
    const world = await createConvexInventoryWorld();
    await world.t.run(async (ctx) => {
      await ctx.db.patch("lots", world.a.lot, {
        expirationDate: "2026-01-31",
      });
    });
    await post(world, {
      requestId: "0193f2c1-0000-7000-8000-000000000010",
      locationId: world.a.rack,
      itemId: world.a.item,
      lotId: world.a.lot,
      minorUnits: 4_000,
    });

    const result = value(
      await callAs(world, "a", planExpiry, {
        warehouseId: world.warehouses.alphaA,
        asOf: "2026-08-11",
      }),
    );

    expect(result["status"]).toBe("COMPLETE");
    const expired = result["expired"] as {
      bucketKey: string;
      minorUnits: number;
    }[];

    expect(expired).toHaveLength(1);
    expect(expired[0]?.minorUnits).toBe(4_000);
  });

  it("leaves stock alone whose lot has not expired", async () => {
    const world = await createConvexInventoryWorld();
    await world.t.run(async (ctx) => {
      await ctx.db.patch("lots", world.a.lot, {
        expirationDate: "2027-12-31",
      });
    });
    await post(world, {
      requestId: "0193f2c1-0000-7000-8000-000000000011",
      locationId: world.a.rack,
      itemId: world.a.item,
      lotId: world.a.lot,
      minorUnits: 4_000,
    });

    const result = value(
      await callAs(world, "a", planExpiry, {
        warehouseId: world.warehouses.alphaA,
        asOf: "2026-08-11",
      }),
    );
    expect(result["expired"]).toEqual([]);
  });

  it("skips a bucket with no lot, which has no expiry", async () => {
    const world = await createConvexInventoryWorld();
    await post(world, {
      requestId: "0193f2c1-0000-7000-8000-000000000012",
      locationId: world.a.rack,
      itemId: world.a.untrackedItem,
      minorUnits: 1_000,
    });

    const result = value(
      await callAs(world, "a", planExpiry, {
        warehouseId: world.warehouses.alphaA,
        asOf: "2999-01-01",
      }),
    );
    expect(result["expired"]).toEqual([]);
  });

  it("considers only stock that has not already been dispositioned", async () => {
    expect(expirySourceStatuses).toBe(EXPIRY_SOURCE_STATUSES);
    expect([...expirySourceStatuses]).toEqual(["AVAILABLE"]);
  });

  it("refuses a malformed as-of date rather than shifting it", async () => {
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, "a", planExpiry, {
        warehouseId: world.warehouses.alphaA,
        asOf: "2026-8-11",
      }),
    );

    expect(result["ok"]).toBe(false);
    expect((result["error"] as { field?: string }).field).toBe("asOf");
  });

  it("defaults the as-of date to the organization's timezone", async () => {
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, "a", planExpiry, {
        warehouseId: world.warehouses.alphaA,
      }),
    );

    expect(result["ok"]).toBe(true);
    expect(String(result["asOf"])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is resumable, like the reconciliation sweep", async () => {
    const world = await createConvexInventoryWorld();
    for (const [index, location] of [world.a.rack, world.a.dock].entries()) {
      await post(world, {
        requestId: `0193f2c1-0000-7000-8000-00000000030${index}`,
        locationId: location,
        itemId: world.a.item,
        lotId: world.a.lot,
        minorUnits: 1_500 * (index + 1),
      });
    }

    let current = value(
      await callAs(world, "a", planExpiry, {
        warehouseId: world.warehouses.alphaA,
        asOf: "2026-08-11",
        maxPageSize: 1,
      }),
    );
    expect(current["status"]).toBe("BUDGET_EXHAUSTED");

    let guard = 0;
    while (current["status"] === "BUDGET_EXHAUSTED") {
      current = value(
        await callAs(world, "a", planExpiry, {
          warehouseId: world.warehouses.alphaA,
          asOf: "2026-08-11",
          checkpoint: current["checkpoint"],
          maxPageSize: 1,
        }),
      );
      expect((guard += 1)).toBeLessThan(20);
    }

    expect(current["status"]).toBe("COMPLETE");
    expect(current["balancesScanned"]).toBeGreaterThan(0);
  });

  it("writes nothing: it plans, and posting is a separate transaction", async () => {
    const world = await createConvexInventoryWorld();
    await world.t.run(async (ctx) => {
      await ctx.db.patch("lots", world.a.lot, {
        expirationDate: "2020-01-01",
      });
    });
    await post(world, {
      requestId: "0193f2c1-0000-7000-8000-000000000013",
      locationId: world.a.rack,
      itemId: world.a.item,
      lotId: world.a.lot,
      minorUnits: 2_000,
    });

    const before = await world.t.run(
      async (ctx) =>
        (await ctx.db.query("inventoryTransactions").collect()).length,
    );
    await callAs(world, "a", planExpiry, {
      warehouseId: world.warehouses.alphaA,
      asOf: "2026-08-11",
    });
    const after = await world.t.run(
      async (ctx) =>
        (await ctx.db.query("inventoryTransactions").collect()).length,
    );

    expect(after).toBe(before);
  });
});
