/**
 * Isolation tier — the five Phase 2 master-data entities, from two tenants.
 *
 * The barcode cases matter most. A barcode's unique key is `(orgId, barcode)`,
 * and the whole point of the `orgId` half is that two tenants may print the same
 * GTIN on different products — a check that forgot it would refuse the second
 * tenant's registration *and* tell them the value exists somewhere.
 *
 * Blocking merge gate (`INV-0012-02`, `RG-031`). All data is synthetic.
 */
import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import {
  getItemUomProfile,
  listLabelTemplates,
  listStorageClasses,
  listSuppliers,
  resolveBarcode,
  resolveScanToItem,
} from "../../convex/masterData/catalogue";
import {
  createBarcode,
  createItemUom,
  createStorageClass,
  createSupplier,
  draftLabelTemplate,
  publishLabelTemplate,
  updateSupplier,
} from "../../convex/masterData/writes";
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

/** Both tenants' actors share one subject; only the org claim differs. */
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

const errorOf = (result: Record<string, unknown>) =>
  result["error"] as { code: string; field?: string };

/*
 * One reader per table rather than a union-typed helper: a union of five row
 * shapes has only the fields they share, so `row.barcode` would not type-check
 * even where it is the right field.
 */
const supplierRows = async (world: ConvexInventoryWorld) =>
  await world.t.run(async (ctx) => ctx.db.query("suppliers").collect());
const storageClassRows = async (world: ConvexInventoryWorld) =>
  await world.t.run(async (ctx) => ctx.db.query("storageClasses").collect());
const barcodeRows = async (world: ConvexInventoryWorld) =>
  await world.t.run(async (ctx) => ctx.db.query("itemBarcodes").collect());
const itemUomRows = async (world: ConvexInventoryWorld) =>
  await world.t.run(async (ctx) => ctx.db.query("itemUoms").collect());
const labelTemplateRows = async (world: ConvexInventoryWorld) =>
  await world.t.run(async (ctx) => ctx.db.query("labelTemplates").collect());

describe("the new master-data entities are tenant-confined", () => {
  it("lets both tenants hold the same supplier code", async () => {
    const world = await createConvexInventoryWorld();
    const args = { code: "SHARED-SUP", name: "Shared" };

    const a = value(
      await callAs(world, "a", createSupplier, { ...args, requestId: "r_a" }),
    );
    const b = value(
      await callAs(world, "b", createSupplier, { ...args, requestId: "r_b" }),
    );

    expect(a["written"]).toBe(true);
    expect(b["written"]).toBe(true);
    expect(a["documentId"]).not.toBe(b["documentId"]);

    const rows = await supplierRows(world);
    expect(rows.map((row) => row.orgId).sort()).toEqual(
      [world.orgA, world.orgB].sort(),
    );
  });

  it("lets both tenants hold the same storage-class code", async () => {
    const world = await createConvexInventoryWorld();
    const args = { code: "FLAMMABLE", name: "Flammable" };

    expect(
      value(
        await callAs(world, "a", createStorageClass, {
          ...args,
          requestId: "sc_a",
        }),
      )["written"],
    ).toBe(true);
    expect(
      value(
        await callAs(world, "b", createStorageClass, {
          ...args,
          requestId: "sc_b",
        }),
      )["written"],
    ).toBe(true);
  });

  it("lets both tenants register the same GTIN on different products", async () => {
    /*
     * The case the `orgId` half of the key exists for. Two manufacturers may
     * legitimately stock the same purchased part, and a uniqueness check that
     * forgot the organization would refuse the second one — and, worse, would
     * have disclosed that the value exists somewhere.
     */
    const world = await createConvexInventoryWorld();
    const barcode = "0614141000036";

    const a = value(
      await callAs(world, "a", createBarcode, {
        requestId: "bc_a",
        itemId: world.a.item,
        barcode,
        kind: "GTIN",
      }),
    );
    const b = value(
      await callAs(world, "b", createBarcode, {
        requestId: "bc_b",
        itemId: world.b.item,
        barcode,
        kind: "GTIN",
      }),
    );

    expect(a["written"]).toBe(true);
    expect(b["written"]).toBe(true);
    expect(a["documentId"]).not.toBe(b["documentId"]);
  });

  it("resolves a shared barcode to each tenant's own item", async () => {
    const world = await createConvexInventoryWorld();
    const barcode = "SHARED-SCAN";

    await callAs(world, "a", createBarcode, {
      requestId: "bcr_a",
      itemId: world.a.item,
      barcode,
      kind: "SUPPLIER",
    });
    await callAs(world, "b", createBarcode, {
      requestId: "bcr_b",
      itemId: world.b.untrackedItem,
      barcode,
      kind: "SUPPLIER",
    });

    const asA = value(
      await callAs(world, "a", resolveBarcode, { barcode, kind: "SUPPLIER" }),
    );
    const asB = value(
      await callAs(world, "b", resolveBarcode, { barcode, kind: "SUPPLIER" }),
    );

    expect(asA["itemId"]).toBe(world.a.item);
    expect(asB["itemId"]).toBe(world.b.untrackedItem);
    expect(asA["itemId"]).not.toBe(asB["itemId"]);
  });

  it("does not resolve a barcode only the other tenant registered", async () => {
    const world = await createConvexInventoryWorld();
    await callAs(world, "b", createBarcode, {
      requestId: "bconly_b",
      itemId: world.b.item,
      barcode: "ONLY-B",
      kind: "SUPPLIER",
    });

    const asA = value(
      await callAs(world, "a", resolveBarcode, {
        barcode: "ONLY-B",
        kind: "SUPPLIER",
      }),
    );
    const nonexistent = value(
      await callAs(world, "a", resolveBarcode, {
        barcode: "NOBODY-HAS-THIS",
        kind: "SUPPLIER",
      }),
    );

    // Byte-identical: a caller must not learn that another tenant holds it.
    expect(asA).toEqual(nonexistent);
  });

  it("resolves a shared SKU to each tenant's own item", async () => {
    /*
     * Two tenants routinely stock the same part and buy it under the same
     * supplier's SKU. The capture screen resolves the string a person read off a
     * box, so this is the read that decides *whose* part it is.
     */
    const world = await createConvexInventoryWorld();

    const asA = value(
      await callAs(world, "a", resolveScanToItem, { scan: "WIDGET-001" }),
    );
    const asB = value(
      await callAs(world, "b", resolveScanToItem, { scan: "WIDGET-001" }),
    );

    expect(asA["itemId"]).toBe(world.a.item);
    expect(asB["itemId"]).toBe(world.b.item);
    expect(asA["itemId"]).not.toBe(asB["itemId"]);
  });

  it("refuses a barcode whose item belongs to another tenant", async () => {
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, "a", createBarcode, {
        requestId: "bcx",
        itemId: world.b.item,
        barcode: "CROSS",
        kind: "SUPPLIER",
      }),
    );

    expect(errorOf(result).code).toBe("REFERENCE_NOT_FOUND");
    expect(
      (await barcodeRows(world)).some((row) => row.barcode === "CROSS"),
    ).toBe(false);
  });

  it("keeps each tenant's UOM profile to its own rows", async () => {
    const world = await createConvexInventoryWorld();

    await callAs(world, "a", createItemUom, {
      requestId: "uom_a",
      itemId: world.a.item,
      uom: "CASE",
      toBaseNumerator: 12,
      toBaseDenominator: 1,
    });
    await callAs(world, "b", createItemUom, {
      requestId: "uom_b",
      itemId: world.b.item,
      uom: "CASE",
      toBaseNumerator: 24,
      toBaseDenominator: 1,
    });

    const a = value(
      await callAs(world, "a", getItemUomProfile, { itemId: world.a.item }),
    );
    const b = value(
      await callAs(world, "b", getItemUomProfile, { itemId: world.b.item }),
    );

    const factorOf = (profile: Record<string, unknown>) =>
      (profile["alternates"] as { toBaseNumerator: number }[])[0]
        ?.toBaseNumerator;

    // The same unit code, two different factors, neither leaking into the other.
    expect(factorOf(a)).toBe(12);
    expect(factorOf(b)).toBe(24);
  });

  it("refuses a profile read for an item this tenant does not own", async () => {
    const world = await createConvexInventoryWorld();
    const foreign = value(
      await callAs(world, "a", getItemUomProfile, { itemId: world.b.item }),
    );
    const deleted = value(
      await callAs(world, "a", getItemUomProfile, {
        itemId: world.vanishedItem,
      }),
    );

    expect(foreign["ok"]).toBe(false);
    expect(foreign).toEqual(deleted);
  });

  it("never lists another tenant's suppliers, classes, or templates", async () => {
    const world = await createConvexInventoryWorld();

    await callAs(world, "b", createSupplier, {
      requestId: "iso_sup_b",
      code: "B-ONLY",
      name: "B only",
    });
    await callAs(world, "b", createStorageClass, {
      requestId: "iso_sc_b",
      code: "B-CLASS",
      name: "B class",
    });
    await callAs(world, "b", draftLabelTemplate, {
      requestId: "iso_lt_b",
      code: "B-LABEL",
      name: "B label",
      format: "ZPL",
      body: "^XA^XZ",
    });

    for (const fn of [listSuppliers, listStorageClasses, listLabelTemplates]) {
      const page = value(await callAs(world, "a", fn, {}));
      expect(page["items"], String(fn)).toEqual([]);
    }
  });

  it("does not let one tenant publish another tenant's draft", async () => {
    /*
     * The publish policy reads `draftedByUserId` from the row. A row this tenant
     * does not own reads as `null`, which yields no maker and therefore a
     * denial — the same answer a foreign ID gets everywhere else, and crucially
     * *not* an error that would confirm the draft exists.
     */
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const draft = value(
      await callAs(world, "b", draftLabelTemplate, {
        requestId: "iso_pub_b",
        code: "B-DRAFT",
        name: "B draft",
        format: "ZPL",
        body: "^XA^XZ",
      }),
    );

    const outcome = await callAs(world, "a", publishLabelTemplate, {
      requestId: "iso_pub_a",
      labelTemplateId: draft["documentId"],
    });

    expect(outcome["ok"]).toBe(false);
    const rows = await labelTemplateRows(world);
    expect(rows.find((row) => row._id === draft["documentId"])?.status).toBe(
      "DRAFT",
    );
  });

  it("refuses to update another tenant's supplier, and changes nothing", async () => {
    const world = await createConvexInventoryWorld();
    const created = value(
      await callAs(world, "b", createSupplier, {
        requestId: "iso_up_b",
        code: "B-UP",
        name: "Original",
      }),
    );

    const result = value(
      await callAs(world, "a", updateSupplier, {
        requestId: "iso_up_a",
        supplierId: created["documentId"],
        name: "Hijacked",
      }),
    );

    expect(errorOf(result).code).toBe("NOT_FOUND");
    const row = (await supplierRows(world)).find(
      (candidate) => candidate._id === created["documentId"],
    );
    expect(row?.name).toBe("Original");
  });

  it("stamps every new row with the writing tenant", async () => {
    const world = await createConvexInventoryWorld();

    await callAs(world, "a", createSupplier, {
      requestId: "stamp_sup",
      code: "STAMP",
      name: "Stamp",
    });
    await callAs(world, "a", createStorageClass, {
      requestId: "stamp_sc",
      code: "STAMP",
      name: "Stamp",
    });
    await callAs(world, "a", createBarcode, {
      requestId: "stamp_bc",
      itemId: world.a.item,
      barcode: "STAMP-BC",
      kind: "SUPPLIER",
    });
    await callAs(world, "a", createItemUom, {
      requestId: "stamp_uom",
      itemId: world.a.item,
      uom: "STAMPU",
      toBaseNumerator: 2,
      toBaseDenominator: 1,
    });
    await callAs(world, "a", draftLabelTemplate, {
      requestId: "stamp_lt",
      code: "STAMP",
      name: "Stamp",
      format: "ZPL",
      body: "^XA^XZ",
    });

    const tables: readonly (readonly [string, { orgId: unknown }[]])[] = [
      ["suppliers", await supplierRows(world)],
      ["storageClasses", await storageClassRows(world)],
      ["itemBarcodes", await barcodeRows(world)],
      ["itemUoms", await itemUomRows(world)],
      ["labelTemplates", await labelTemplateRows(world)],
    ];

    for (const [table, rows] of tables) {
      expect(rows.length, table).toBeGreaterThan(0);
      // `orgId` is derived from the resolved context; it is not an argument
      // anywhere in the write path (`INV-0001-02`).
      expect(
        rows.every((row) => row.orgId === world.orgA),
        table,
      ).toBe(true);
    }
  });
});
