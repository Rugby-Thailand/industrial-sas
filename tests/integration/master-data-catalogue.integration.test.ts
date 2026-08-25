import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import {
  listHandlingUnits,
  listBarcodesForItem,
  listItems,
  listLocations,
  listLotsForItem,
  listOwners,
  listReasonCodes,
  listReceivingLocations,
  listWarehouses,
  maxMasterDataPageSize,
  resolveScanToItem,
} from "../../convex/masterData/catalogue";
import { MAX_JOB_PAGE_SIZE } from "../../convex/model/inventory/jobPage";
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
  const outcome = await world.t
    .withIdentity(identity(org))
    .run(async (ctx) =>
      run(fn)._handler(ctx as GenericMutationCtx<DataModel>, args),
    );
  return outcome as Record<string, unknown>;
}

function value(outcome: Record<string, unknown>): Record<string, unknown> {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
}

describe("master-data catalogue", () => {
  it("lists the tenant's items by SKU", async () => {
    const world = await createConvexInventoryWorld();
    const page = value(await callAs(world, "a", listItems, {}));

    expect(page["ok"]).toBe(true);
    const skus = (page["items"] as { sku: string }[]).map((row) => row.sku);

    expect(skus).toEqual(["BULK-001", "SERIAL-001", "WIDGET-001"]);
  });

  it("serves a status filter from a status-first index", async () => {
    const world = await createConvexInventoryWorld();
    await world.t.run(async (ctx) => {
      const rows = await ctx.db.query("items").collect();
      const first = rows.find((row) => row.sku === "BULK-001");
      if (first !== undefined) {
        await ctx.db.patch("items", first._id, { status: "INACTIVE" });
      }
    });

    const active = value(
      await callAs(world, "a", listItems, { status: "ACTIVE" }),
    );
    const inactive = value(
      await callAs(world, "a", listItems, { status: "INACTIVE" }),
    );

    expect((active["items"] as { sku: string }[]).map((r) => r.sku)).toEqual([
      "SERIAL-001",
      "WIDGET-001",
    ]);
    expect((inactive["items"] as { sku: string }[]).map((r) => r.sku)).toEqual([
      "BULK-001",
    ]);
  });

  it("refuses a page larger than the cap rather than clamping it", async () => {
    const world = await createConvexInventoryWorld();
    const page = value(
      await callAs(world, "a", listItems, {
        maxPageSize: maxMasterDataPageSize + 1,
      }),
    );

    expect(page["ok"]).toBe(false);
    expect((page["error"] as { code: string }).code).toBe(
      "PAGE_SIZE_TOO_LARGE",
    );
  });

  it("restates the server's own page cap", () => {
    expect(maxMasterDataPageSize).toBe(MAX_JOB_PAGE_SIZE);
  });

  it("pages deterministically and returns every row exactly once", async () => {
    const world = await createConvexInventoryWorld();

    const seen: string[] = [];
    let cursor: string | undefined = undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const args: Record<string, unknown> = { maxPageSize: 1 };
      if (cursor !== undefined) args["cursor"] = cursor;
      const page = value(await callAs(world, "a", listItems, args));
      seen.push(...(page["items"] as { sku: string }[]).map((r) => r.sku));
      if (page["complete"] === true) break;
      cursor = page["nextCursor"] as string;
    }

    expect(seen).toEqual(["BULK-001", "SERIAL-001", "WIDGET-001"]);
  });

  it("lists warehouses, which the warehouse selector needs before any scope exists", async () => {
    const world = await createConvexInventoryWorld();
    const page = value(await callAs(world, "a", listWarehouses, {}));

    const codes = (page["items"] as { code: string }[]).map((row) => row.code);
    expect(codes.length).toBeGreaterThan(0);
  });

  it("lists one warehouse's locations and no other site's", async () => {
    const world = await createConvexInventoryWorld();
    const page = value(
      await callAs(world, "a", listLocations, {
        warehouseId: world.warehouses.alphaA,
      }),
    );

    const rows = page["items"] as { code: string; warehouseId: string }[];
    expect(rows.map((row) => row.code).sort()).toEqual(["DOCK-01", "RACK-01"]);
    expect(
      rows.every((row) => row.warehouseId === world.warehouses.alphaA),
    ).toBe(true);
  });

  it("lists an item's lots and refuses an item that is not this tenant's", async () => {
    const world = await createConvexInventoryWorld();

    const mine = value(
      await callAs(world, "a", listLotsForItem, { itemId: world.a.item }),
    );
    expect((mine["items"] as { lotCode: string }[]).length).toBeGreaterThan(0);

    const theirs = value(
      await callAs(world, "a", listLotsForItem, { itemId: world.b.item }),
    );
    expect(theirs["ok"]).toBe(false);
    expect((theirs["error"] as { code: string }).code).toBe(
      "REFERENCE_NOT_FOUND",
    );

    const vanished = value(
      await callAs(world, "a", listLotsForItem, { itemId: world.vanishedItem }),
    );
    expect((vanished["error"] as { code: string }).code).toBe(
      "REFERENCE_NOT_FOUND",
    );
  });

  it("serves an item's lot status filter from the index, not from the page", async () => {
    const world = await createConvexInventoryWorld();

    await world.t.run(async (ctx) => {
      await ctx.db.insert("lots", {
        orgId: world.orgA,
        itemId: world.a.item,
        lotCode: "LOT-A00",
        status: "INACTIVE",
      });
      await ctx.db.insert("lots", {
        orgId: world.orgA,
        itemId: world.a.item,
        lotCode: "LOT-A01",
        status: "INACTIVE",
      });
    });

    const page = value(
      await callAs(world, "a", listLotsForItem, {
        itemId: world.a.item,
        status: "ACTIVE",
        maxPageSize: 2,
      }),
    );

    const rows = page["items"] as { lotCode: string; status: string }[];

    expect(rows.map((row) => row.lotCode)).toEqual(["LOT-A"]);
    expect(rows.every((row) => row.status === "ACTIVE")).toBe(true);
    expect(page["complete"]).toBe(true);
    expect(page["nextCursor"]).toBeNull();
  });

  it("still lists an item's lots of every status when none is asked for", async () => {
    // The no-status branch reads the plain index; adding the status-carrying one
    // must not narrow the unfiltered answer.
    const world = await createConvexInventoryWorld();
    await world.t.run(async (ctx) => {
      await ctx.db.insert("lots", {
        orgId: world.orgA,
        itemId: world.a.item,
        lotCode: "LOT-A00",
        status: "INACTIVE",
      });
    });

    const page = value(
      await callAs(world, "a", listLotsForItem, { itemId: world.a.item }),
    );

    const rows = page["items"] as { lotCode: string; status: string }[];
    expect(rows.map((row) => row.lotCode)).toEqual(["LOT-A", "LOT-A00"]);
    expect(page["complete"]).toBe(true);
  });

  it("serves an item's barcode status filter from the index, not from the page", async () => {
    const world = await createConvexInventoryWorld();
    await world.t.run(async (ctx) => {
      await ctx.db.insert("itemBarcodes", {
        orgId: world.orgA,
        itemId: world.a.item,
        barcode: "08850000000010",
        kind: "GTIN",
        status: "INACTIVE",
      });
      await ctx.db.insert("itemBarcodes", {
        orgId: world.orgA,
        itemId: world.a.item,
        barcode: "08850000000027",
        kind: "GTIN",
        status: "INACTIVE",
      });
      await ctx.db.insert("itemBarcodes", {
        orgId: world.orgA,
        itemId: world.a.item,
        barcode: "08850000000034",
        kind: "GTIN",
        status: "ACTIVE",
      });
    });

    const page = value(
      await callAs(world, "a", listBarcodesForItem, {
        itemId: world.a.item,
        status: "ACTIVE",
        maxPageSize: 2,
      }),
    );

    const rows = page["items"] as { barcode: string; status: string }[];

    expect(rows.map((row) => row.barcode)).toEqual(["08850000000034"]);
    expect(page["complete"]).toBe(true);
    expect(page["nextCursor"]).toBeNull();
  });

  it("pages a status-filtered lot list without dropping or repeating a row", async () => {
    const world = await createConvexInventoryWorld();
    await world.t.run(async (ctx) => {
      for (const [index, status] of (
        ["INACTIVE", "ACTIVE", "INACTIVE", "ACTIVE"] as const
      ).entries()) {
        await ctx.db.insert("lots", {
          orgId: world.orgA,
          itemId: world.a.item,
          lotCode: `LOT-B0${index}`,
          status,
        });
      }
    });

    const seen: string[] = [];
    let cursor: string | undefined = undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const args: Record<string, unknown> = {
        itemId: world.a.item,
        status: "ACTIVE",
        maxPageSize: 1,
      };
      if (cursor !== undefined) args["cursor"] = cursor;
      const page = value(await callAs(world, "a", listLotsForItem, args));
      seen.push(
        ...(page["items"] as { lotCode: string }[]).map((row) => row.lotCode),
      );
      if (page["complete"] === true) break;
      cursor = page["nextCursor"] as string;
    }

    expect(seen).toEqual(["LOT-A", "LOT-B01", "LOT-B03"]);
  });

  it("lists handling units for one warehouse and status", async () => {
    const world = await createConvexInventoryWorld();
    const page = value(
      await callAs(world, "a", listHandlingUnits, {
        warehouseId: world.warehouses.alphaA,
      }),
    );

    const rows = page["items"] as { lpn: string; status: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.status === "ACTIVE")).toBe(true);
  });

  it("lists reason codes, optionally by scope", async () => {
    const world = await createConvexInventoryWorld();

    const all = value(await callAs(world, "a", listReasonCodes, {}));
    expect((all["items"] as unknown[]).length).toBeGreaterThanOrEqual(3);

    const reversal = value(
      await callAs(world, "a", listReasonCodes, { scope: "REVERSAL" }),
    );
    const scopes = (reversal["items"] as { scope: string }[]).map(
      (row) => row.scope,
    );
    expect(scopes.every((scope) => scope === "REVERSAL")).toBe(true);
    expect(scopes.length).toBeGreaterThan(0);
  });

  it("lists owners even though consigned stock ships disabled", async () => {
    const world = await createConvexInventoryWorld();
    const page = value(await callAs(world, "a", listOwners, {}));

    expect(page["ok"]).toBe(true);
    expect((page["items"] as unknown[]).length).toBeGreaterThan(0);
  });

  it("mints a request ID on every read, for correlation", async () => {
    const world = await createConvexInventoryWorld();
    const outcome = await callAs(world, "a", listItems, {});

    expect(typeof outcome["requestId"]).toBe("string");
    expect((outcome["requestId"] as string).length).toBeGreaterThan(8);
  });
});

describe("master-data catalogue authorization", () => {
  it("denies a role that holds the entity's read on no other grounds than its own grants", async () => {
    const world = await createConvexInventoryWorld({}, { roleA: "VIEWER" });
    const outcome = await callAs(world, "a", listOwners, {});

    expect(outcome["ok"]).toBe(false);
    expect((outcome["denial"] as { code: string }).code).toBe(
      "AUTHORIZATION_DENIED",
    );
  });

  it("allows the same role the reads it does hold", async () => {
    const world = await createConvexInventoryWorld({}, { roleA: "VIEWER" });

    expect((await callAs(world, "a", listItems, {}))["ok"]).toBe(true);
    expect((await callAs(world, "a", listReasonCodes, {}))["ok"]).toBe(true);
  });

  it("does not let a read permission stand in for its manage sibling", async () => {
    // Least privilege, stated as a test: the catalogue defines the read codes
    // separately precisely so a list cannot require the right to edit.
    const world = await createConvexInventoryWorld({}, { roleA: "VIEWER" });
    const outcome = await callAs(world, "a", listItems, {});

    expect(outcome["ok"]).toBe(true);
    // VIEWER holds `masterData.item.read` and not `masterData.item.manage`.
  });
});

describe("listReceivingLocations", () => {
  it("finds a dock behind more racks than any bounded scan would read", async () => {
    const world = await createConvexInventoryWorld();

    await world.t.run(async (ctx) => {
      for (let index = 0; index < 150; index += 1) {
        await ctx.db.insert("locations", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,

          code: `AAA-${String(index).padStart(4, "0")}`,
          locationType: "RACK_BIN",
          status: "ACTIVE",
        });
      }
    });

    const result = value(
      await callAs(world, "a", listReceivingLocations, {
        warehouseId: world.warehouses.alphaA,
      }),
    );

    const codes = (result["items"] as { code: string }[]).map(
      (row) => row.code,
    );
    expect(codes).toContain("DOCK-01");
    expect(codes.some((code) => code.startsWith("AAA-"))).toBe(false);
  });

  it("offers staging lanes as well as docks", async () => {
    const world = await createConvexInventoryWorld();
    await world.t.run(async (ctx) => {
      await ctx.db.insert("locations", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        code: "STAGE-01",
        locationType: "STAGING",
        status: "ACTIVE",
      });
    });

    const result = value(
      await callAs(world, "a", listReceivingLocations, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const codes = (result["items"] as { code: string }[]).map(
      (row) => row.code,
    );

    expect(codes).toEqual(expect.arrayContaining(["DOCK-01", "STAGE-01"]));
  });

  it("omits a deactivated dock", async () => {
    // A withdrawn dock is not a choice, and a picker that offered one would
    // produce a refusal the operator cannot act on.
    const world = await createConvexInventoryWorld();
    await world.t.run(async (ctx) => {
      await ctx.db.patch(world.a.dock, { status: "INACTIVE" });
    });

    const result = value(
      await callAs(world, "a", listReceivingLocations, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    expect(result["items"]).toEqual([]);
  });

  it("never answers with another warehouse's dock", async () => {
    const world = await createConvexInventoryWorld();

    const result = value(
      await callAs(world, "a", listReceivingLocations, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const ids = (result["items"] as { locationId: string }[]).map(
      (row) => row.locationId,
    );
    expect(ids).not.toContain(world.a.otherWarehouseLocation);
  });
});

describe("resolveScanToItem", () => {
  it("answers an item for one of its barcodes", async () => {
    const world = await createConvexInventoryWorld();
    await world.t.run(async (ctx) => {
      await ctx.db.insert("itemBarcodes", {
        orgId: world.orgA,
        itemId: world.a.item,
        barcode: "SIAM-W1-001",
        kind: "SUPPLIER",
        status: "ACTIVE",
      });
    });

    const result = value(
      await callAs(world, "a", resolveScanToItem, {
        scan: "SIAM-W1-001",
      }),
    );
    expect(result["found"]).toBe(true);
    expect(result["itemId"]).toBe(world.a.item);
    expect(result["sku"]).toBe("WIDGET-001");
    expect(result["via"]).toBe("BARCODE");
  });

  it("answers an item for its SKU, because a packing note carries one", async () => {
    const world = await createConvexInventoryWorld();

    const result = value(
      await callAs(world, "a", resolveScanToItem, {
        scan: "widget-001",
      }),
    );

    expect(result["found"]).toBe(true);
    expect(result["itemId"]).toBe(world.a.item);
    expect(result["via"]).toBe("SKU");
  });

  it("does not answer with a deactivated item", async () => {
    const world = await createConvexInventoryWorld();
    await world.t.run(async (ctx) => {
      await ctx.db.patch(world.a.item, { status: "INACTIVE" });
    });

    const result = value(
      await callAs(world, "a", resolveScanToItem, {
        scan: "WIDGET-001",
      }),
    );
    expect(result["found"]).toBe(false);
    expect(result["reason"]).toBe("UNKNOWN_SCAN");
  });

  it("ignores a withdrawn barcode", async () => {
    const world = await createConvexInventoryWorld();
    await world.t.run(async (ctx) => {
      await ctx.db.insert("itemBarcodes", {
        orgId: world.orgA,
        itemId: world.a.item,
        barcode: "OLD-LABEL-1",
        kind: "SUPPLIER",
        status: "INACTIVE",
      });
    });

    const result = value(
      await callAs(world, "a", resolveScanToItem, {
        scan: "OLD-LABEL-1",
      }),
    );
    expect(result["found"]).toBe(false);
  });

  it("refuses a scan that is only whitespace rather than guessing", async () => {
    const world = await createConvexInventoryWorld();

    const result = value(
      await callAs(world, "a", resolveScanToItem, { scan: "   " }),
    );
    expect(result["found"]).toBe(false);
    expect(result["reason"]).toBe("EMPTY_SCAN");
  });

  it("answers a foreign tenant's barcode exactly as it answers a nonexistent one", async () => {
    // `INV-0002-03`: the read must not become an existence oracle for another
    // tenant's catalogue.
    const world = await createConvexInventoryWorld();
    await world.t.run(async (ctx) => {
      await ctx.db.insert("itemBarcodes", {
        orgId: world.orgB,
        itemId: world.b.item,
        barcode: "TENANT-B-ONLY",
        kind: "SUPPLIER",
        status: "ACTIVE",
      });
    });

    expect(
      value(
        await callAs(world, "a", resolveScanToItem, { scan: "TENANT-B-ONLY" }),
      ),
    ).toEqual(
      value(
        await callAs(world, "a", resolveScanToItem, { scan: "NOTHING-AT-ALL" }),
      ),
    );
  });
});
