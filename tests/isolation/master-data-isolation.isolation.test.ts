import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import {
  listHandlingUnits,
  listItems,
  listLocations,
  listLotsForItem,
  listOwners,
  listReasonCodes,
  listWarehouses,
} from "../../convex/masterData/catalogue";
import type { DataModel } from "../../convex/schema";
import {
  createConvexInventoryWorld,
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

async function refusalOf(operation: Promise<unknown>): Promise<{
  readonly kind?: unknown;
  readonly code?: unknown;
  readonly message?: unknown;
  readonly requestId?: unknown;
}> {
  try {
    const value = await operation;
    throw new Error(
      `expected a refusal, received ${JSON.stringify(value).slice(0, 200)}`,
    );
  } catch (error) {
    const data = (error as { readonly data?: unknown }).data;
    if (data === undefined) throw error;
    return data as Record<string, unknown>;
  }
}

const page = (outcome: Record<string, unknown>): Record<string, unknown> => {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
};

const rowsOf = (
  outcome: Record<string, unknown>,
): Record<string, unknown>[] => {
  const value = page(outcome);
  expect(value["ok"], JSON.stringify(value)).toBe(true);
  return value["items"] as Record<string, unknown>[];
};

const identifiersIn = (rows: readonly Record<string, unknown>[]): string[] =>
  rows.flatMap((row) =>
    Object.entries(row)
      .filter(([key]) => key.endsWith("Id"))
      .map(([, id]) => String(id)),
  );

describe("master-data reads are tenant-confined", () => {
  it("never returns another tenant's items, though both tenants have the same SKUs", async () => {
    const world = await createConvexInventoryWorld();

    const mine = rowsOf(await callAs(world, "a", listItems, {}));
    const theirs = rowsOf(await callAs(world, "b", listItems, {}));

    expect(mine.map((row) => row["sku"])).toEqual(
      theirs.map((row) => row["sku"]),
    );
    const mineIds = new Set(identifiersIn(mine));
    for (const id of identifiersIn(theirs)) {
      expect(mineIds.has(id), id).toBe(false);
    }
  });

  it("never returns another tenant's warehouses", async () => {
    const world = await createConvexInventoryWorld();

    const mine = identifiersIn(
      rowsOf(await callAs(world, "a", listWarehouses, {})),
    );
    const theirs = identifiersIn(
      rowsOf(await callAs(world, "b", listWarehouses, {})),
    );

    expect(mine).not.toEqual([]);
    expect(theirs).not.toEqual([]);
    expect(mine.some((id) => theirs.includes(id))).toBe(false);
  });

  it("refuses another tenant's warehouse ID before authorization is reached", async () => {
    const world = await createConvexInventoryWorld();

    for (const fn of [listLocations, listHandlingUnits]) {
      const denial = await refusalOf(
        callAs(world, "a", fn, { warehouseId: world.warehouses.alphaB }),
      );

      expect(denial.kind).toBe("TENANT_CONTEXT_DENIED");
      expect(denial.code).toBe("WAREHOUSE_UNKNOWN");
      expect(typeof denial.requestId).toBe("string");
    }
  });

  it("answers a foreign warehouse exactly as it answers a nonexistent one", async () => {
    const world = await createConvexInventoryWorld();

    const foreign = await refusalOf(
      callAs(world, "a", listLocations, {
        warehouseId: world.warehouses.alphaB,
      }),
    );
    const invented = await refusalOf(
      callAs(world, "a", listLocations, {
        warehouseId: world.warehouses.alphaB.replace(/.$/, "z"),
      }),
    );

    expect(foreign.code).toBe(invented.code);
    expect(foreign.message).toBe(invented.message);
  });

  it("answers a foreign item ID exactly as it answers a deleted one", async () => {
    const world = await createConvexInventoryWorld();

    const foreign = page(
      await callAs(world, "a", listLotsForItem, { itemId: world.b.item }),
    );
    const deleted = page(
      await callAs(world, "a", listLotsForItem, { itemId: world.vanishedItem }),
    );

    expect(foreign).toEqual(deleted);
  });

  it("never returns another tenant's lots for an item of the same name", async () => {
    const world = await createConvexInventoryWorld();

    const mine = rowsOf(
      await callAs(world, "a", listLotsForItem, { itemId: world.a.item }),
    );
    const theirs = rowsOf(
      await callAs(world, "b", listLotsForItem, { itemId: world.b.item }),
    );

    expect(mine.length).toBeGreaterThan(0);
    const mineIds = new Set(identifiersIn(mine));
    for (const id of identifiersIn(theirs)) {
      expect(mineIds.has(id), id).toBe(false);
    }
  });

  it("never returns another tenant's reason codes or owners", async () => {
    const world = await createConvexInventoryWorld();

    for (const fn of [listReasonCodes, listOwners]) {
      const mine = identifiersIn(rowsOf(await callAs(world, "a", fn, {})));
      const theirs = identifiersIn(rowsOf(await callAs(world, "b", fn, {})));

      expect(mine).not.toEqual([]);
      expect(mine.some((id) => theirs.includes(id))).toBe(false);
    }
  });

  it("does not let a cursor from one tenant page another tenant's rows", async () => {
    const world = await createConvexInventoryWorld();

    const first = page(await callAs(world, "a", listItems, { maxPageSize: 1 }));
    const cursor = first["nextCursor"];
    expect(typeof cursor).toBe("string");

    const asB = await callAs(world, "b", listItems, {
      maxPageSize: 1,
      cursor,
    });

    if (asB["ok"] === true) {
      const value = asB["value"] as Record<string, unknown>;
      if (value["ok"] === true) {
        const aIds = new Set(
          identifiersIn(rowsOf(await callAs(world, "a", listItems, {}))),
        );
        for (const id of identifiersIn(
          value["items"] as Record<string, unknown>[],
        )) {
          expect(aIds.has(id), id).toBe(false);
        }
      }
    }
  });
});
