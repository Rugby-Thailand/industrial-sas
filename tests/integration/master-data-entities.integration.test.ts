/**
 * Integration tier — the five Phase 2 master-data entities over `convex-test`.
 *
 * Scope: suppliers, item barcodes, alternate UOMs, storage classes, and label
 * templates — their reads, their idempotent audited writes, and the domain rules
 * each one owns. Cross-tenant claims live in
 * `tests/isolation/master-data-entities.isolation.test.ts`.
 *
 * All data is synthetic (`tests/fixtures/README.md`).
 */
import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import {
  getItemUomProfile,
  getLabelTemplate,
  listBarcodesForItem,
  listItemUoms,
  listLabelTemplates,
  listStorageClasses,
  listSuppliers,
  resolveBarcode,
} from "../../convex/masterData/catalogue";
import {
  createBarcode,
  createItemUom,
  createStorageClass,
  createSupplier,
  deactivateBarcode,
  deactivateItemUom,
  draftLabelTemplate,
  publishLabelTemplate,
  updateStorageClass,
  updateSupplier,
  MASTER_DATA_OPERATIONS,
} from "../../convex/masterData/writes";
import type { DataModel } from "../../convex/schema";
import {
  createConvexInventoryWorld,
  type ConvexInventoryWorld,
} from "../fixtures/convex-inventory-world";
import {
  recordStepUp,
  seedSecondActorForOrgA,
} from "../fixtures/convex-tenant-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const run = (value: unknown) => value as RuntimeFunction;

const identity = (subject: string, org: "a" | "b" = "a") => ({
  subject,
  org_id: `org_fixture_${org}`,
});

const ACTOR_A = "user_fixture_a";
const ACTOR_A2 = "user_fixture_a2";

async function callAs(
  world: ConvexInventoryWorld,
  subject: string,
  fn: unknown,
  args: unknown,
  org: "a" | "b" = "a",
): Promise<Record<string, unknown>> {
  return (await world.t
    .withIdentity(identity(subject, org))
    .run(async (ctx) =>
      run(fn)._handler(ctx as GenericMutationCtx<DataModel>, args),
    )) as Record<string, unknown>;
}

function value(outcome: Record<string, unknown>): Record<string, unknown> {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
}

const errorOf = (result: Record<string, unknown>) =>
  result["error"] as { code: string; field?: string; reason?: string };

const auditRows = async (world: ConvexInventoryWorld) =>
  await world.t.run(async (ctx) => ctx.db.query("auditEvents").collect());

/* -------------------------------------------------------------------------- */
/* Suppliers                                                                   */
/* -------------------------------------------------------------------------- */

describe("suppliers", () => {
  it("creates, normalizes, and lists a supplier", async () => {
    const world = await createConvexInventoryWorld();
    const created = value(
      await callAs(world, ACTOR_A, createSupplier, {
        requestId: "req_sup_1",
        code: "  acme-co  ",
        name: "  บริษัท แอคมี จำกัด  ",
      }),
    );
    expect(created["written"]).toBe(true);

    const page = value(await callAs(world, ACTOR_A, listSuppliers, {}));
    const rows = page["items"] as { code: string; name: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("ACME-CO");
    // A display name keeps its Thai characters and its case.
    expect(rows[0]?.name).toBe("บริษัท แอคมี จำกัด");
  });

  it("refuses a duplicate supplier code by field, never by value", async () => {
    const world = await createConvexInventoryWorld();
    const args = { code: "DUP", name: "First" };
    await callAs(world, ACTOR_A, createSupplier, {
      ...args,
      requestId: "req_sup_a",
    });

    const second = value(
      await callAs(world, ACTOR_A, createSupplier, {
        ...args,
        requestId: "req_sup_b",
        name: "Second",
      }),
    );

    expect(errorOf(second).code).toBe("DUPLICATE_KEY");
    expect(errorOf(second).field).toBe("code");
    expect(JSON.stringify(second)).not.toContain("First");
  });

  it("replays an identical create rather than making a second row", async () => {
    const world = await createConvexInventoryWorld();
    const args = { requestId: "req_sup_retry", code: "RETRY", name: "Retry" };

    const first = value(await callAs(world, ACTOR_A, createSupplier, args));
    const retry = value(await callAs(world, ACTOR_A, createSupplier, args));

    expect(retry["replayed"]).toBe(true);
    expect(retry["documentId"]).toBe(first["documentId"]);
  });

  it("renames and withdraws, but has no field for the code", async () => {
    const world = await createConvexInventoryWorld();
    const created = value(
      await callAs(world, ACTOR_A, createSupplier, {
        requestId: "req_sup_u",
        code: "REN",
        name: "Before",
      }),
    );

    const updated = value(
      await callAs(world, ACTOR_A, updateSupplier, {
        requestId: "req_sup_u2",
        supplierId: created["documentId"],
        name: "After",
        status: "INACTIVE",
      }),
    );
    expect(updated["written"]).toBe(true);

    // The code is the key a lot's provenance will resolve against.
    const exported = (
      updateSupplier as unknown as { exportArgs: () => string }
    ).exportArgs();
    expect(exported).not.toContain('"code"');

    const audit = (await auditRows(world)).find(
      (row) => row.action === MASTER_DATA_OPERATIONS.updateSupplier,
    );
    expect(audit?.changes).toEqual([
      { field: "name", from: "Before", to: "After" },
      { field: "status", from: "ACTIVE", to: "INACTIVE" },
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* Storage classes                                                             */
/* -------------------------------------------------------------------------- */

describe("storage classes", () => {
  it("creates and lists an organization-scoped class", async () => {
    // Organization-scoped: no warehouse argument anywhere, because a class means
    // the same thing at every site (D-13).
    const world = await createConvexInventoryWorld();
    value(
      await callAs(world, ACTOR_A, createStorageClass, {
        requestId: "req_sc_1",
        code: "flammable",
        name: "วัตถุไวไฟ",
      }),
    );

    const page = value(await callAs(world, ACTOR_A, listStorageClasses, {}));
    const rows = page["items"] as { code: string; name: string }[];
    expect(rows[0]?.code).toBe("FLAMMABLE");
    expect(rows[0]?.name).toBe("วัตถุไวไฟ");
  });

  it("filters by status through a status-first index", async () => {
    const world = await createConvexInventoryWorld();
    const created = value(
      await callAs(world, ACTOR_A, createStorageClass, {
        requestId: "req_sc_2",
        code: "COLD",
        name: "Cold chain",
      }),
    );
    await callAs(world, ACTOR_A, updateStorageClass, {
      requestId: "req_sc_3",
      storageClassId: created["documentId"],
      status: "INACTIVE",
    });

    const active = value(
      await callAs(world, ACTOR_A, listStorageClasses, { status: "ACTIVE" }),
    );
    const inactive = value(
      await callAs(world, ACTOR_A, listStorageClasses, { status: "INACTIVE" }),
    );

    expect(active["items"]).toEqual([]);
    expect((inactive["items"] as unknown[]).length).toBe(1);
  });

  it("declares its own permission rather than borrowing the location code", async () => {
    const world = await createConvexInventoryWorld();
    await callAs(world, ACTOR_A, createStorageClass, {
      requestId: "req_sc_4",
      code: "PERM",
      name: "Permission",
    });

    const audit = (await auditRows(world)).find(
      (row) => row.action === MASTER_DATA_OPERATIONS.createStorageClass,
    );
    expect(audit?.permissionCode).toBe("masterData.storageClass.manage");
  });
});

/* -------------------------------------------------------------------------- */
/* Item barcodes                                                               */
/* -------------------------------------------------------------------------- */

describe("item barcodes", () => {
  it("registers a GTIN, padding it and verifying its check digit", async () => {
    const world = await createConvexInventoryWorld();
    value(
      await callAs(world, ACTOR_A, createBarcode, {
        requestId: "req_bc_1",
        itemId: world.a.item,
        barcode: "0614141000036",
        kind: "GTIN",
      }),
    );

    const page = value(
      await callAs(world, ACTOR_A, listBarcodesForItem, {
        itemId: world.a.item,
      }),
    );
    const rows = page["items"] as { barcode: string; kind: string }[];
    expect(rows[0]?.barcode).toHaveLength(14);
    expect(rows[0]?.kind).toBe("GTIN");
  });

  it("refuses a GTIN whose check digit is wrong", async () => {
    /*
     * A row the scan resolver would never produce is an alias no scan can ever
     * match — a dead catalogue entry an operator would blame the scanner for.
     */
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, ACTOR_A, createBarcode, {
        requestId: "req_bc_bad",
        itemId: world.a.item,
        barcode: "0614141000037",
        kind: "GTIN",
      }),
    );

    expect(result["written"]).toBe(false);
    expect(errorOf(result).field).toBe("barcode");
    expect(errorOf(result).reason).toBe("BARCODE_KIND_MISMATCH");
  });

  it("refuses the same barcode on a second item", async () => {
    // Uniqueness is on the barcode alone: a scan must resolve to at most one
    // item, or receiving has to ask which SKU while holding the carton.
    const world = await createConvexInventoryWorld();
    await callAs(world, ACTOR_A, createBarcode, {
      requestId: "req_bc_u1",
      itemId: world.a.item,
      barcode: "SHARED-ALIAS",
      kind: "SUPPLIER",
    });

    const clash = value(
      await callAs(world, ACTOR_A, createBarcode, {
        requestId: "req_bc_u2",
        itemId: world.a.untrackedItem,
        barcode: "SHARED-ALIAS",
        kind: "SUPPLIER",
      }),
    );

    expect(errorOf(clash).code).toBe("DUPLICATE_KEY");
    expect(errorOf(clash).field).toBe("barcode");
  });

  it("resolves a registered barcode to its item", async () => {
    const world = await createConvexInventoryWorld();
    await callAs(world, ACTOR_A, createBarcode, {
      requestId: "req_bc_r1",
      itemId: world.a.item,
      barcode: "RESOLVE-ME",
      kind: "SUPPLIER",
    });

    const found = value(
      await callAs(world, ACTOR_A, resolveBarcode, {
        barcode: "RESOLVE-ME",
        kind: "SUPPLIER",
      }),
    );

    expect(found["found"]).toBe(true);
    expect(found["itemId"]).toBe(world.a.item);
    expect(found["sku"]).toBe("WIDGET-001");
  });

  it("answers an unknown and a deactivated barcode identically", async () => {
    /*
     * "No such barcode" and "a barcode you may not use" are the same instruction
     * to an operator, and distinguishing them would make the function an oracle
     * over the catalogue.
     */
    const world = await createConvexInventoryWorld();
    const created = value(
      await callAs(world, ACTOR_A, createBarcode, {
        requestId: "req_bc_d1",
        itemId: world.a.item,
        barcode: "GONE-SOON",
        kind: "SUPPLIER",
      }),
    );
    await callAs(world, ACTOR_A, deactivateBarcode, {
      requestId: "req_bc_d2",
      barcodeId: created["documentId"],
    });

    const deactivated = value(
      await callAs(world, ACTOR_A, resolveBarcode, {
        barcode: "GONE-SOON",
        kind: "SUPPLIER",
      }),
    );
    const neverExisted = value(
      await callAs(world, ACTOR_A, resolveBarcode, {
        barcode: "NEVER-EXISTED",
        kind: "SUPPLIER",
      }),
    );

    expect(deactivated).toEqual(neverExisted);
    expect(deactivated["found"]).toBe(false);
  });

  it("keeps the deactivated alias's unique key occupied", async () => {
    // The value still means what it meant; it just may not be used.
    const world = await createConvexInventoryWorld();
    const created = value(
      await callAs(world, ACTOR_A, createBarcode, {
        requestId: "req_bc_k1",
        itemId: world.a.item,
        barcode: "KEEP-KEY",
        kind: "SUPPLIER",
      }),
    );
    await callAs(world, ACTOR_A, deactivateBarcode, {
      requestId: "req_bc_k2",
      barcodeId: created["documentId"],
    });

    const reuse = value(
      await callAs(world, ACTOR_A, createBarcode, {
        requestId: "req_bc_k3",
        itemId: world.a.untrackedItem,
        barcode: "KEEP-KEY",
        kind: "SUPPLIER",
      }),
    );
    expect(errorOf(reuse).code).toBe("DUPLICATE_KEY");
  });

  it("refuses a barcode for an item this tenant does not own", async () => {
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, ACTOR_A, createBarcode, {
        requestId: "req_bc_x",
        itemId: world.b.item,
        barcode: "FOREIGN",
        kind: "SUPPLIER",
      }),
    );
    expect(errorOf(result).code).toBe("REFERENCE_NOT_FOUND");
  });
});

/* -------------------------------------------------------------------------- */
/* Alternate item UOMs                                                         */
/* -------------------------------------------------------------------------- */

describe("alternate item UOMs", () => {
  it("stores a reduced exact ratio", async () => {
    const world = await createConvexInventoryWorld();
    value(
      await callAs(world, ACTOR_A, createItemUom, {
        requestId: "req_uom_1",
        itemId: world.a.item,
        uom: "case",
        toBaseNumerator: 24,
        toBaseDenominator: 2,
      }),
    );

    const page = value(
      await callAs(world, ACTOR_A, listItemUoms, { itemId: world.a.item }),
    );
    const rows = page["items"] as {
      uom: string;
      toBaseNumerator: number;
      toBaseDenominator: number;
    }[];
    expect(rows[0]?.uom).toBe("CASE");
    expect(rows[0]?.toBaseNumerator).toBe(12);
    expect(rows[0]?.toBaseDenominator).toBe(1);
  });

  it("refuses the item's own base UOM as an alternate", async () => {
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, ACTOR_A, createItemUom, {
        requestId: "req_uom_base",
        itemId: world.a.item,
        // The fixture's items use `PCS` as their base.
        uom: "pcs",
        toBaseNumerator: 1,
        toBaseDenominator: 1,
      }),
    );

    expect(result["written"]).toBe(false);
    expect(errorOf(result).reason).toBe("BASE_UOM_AS_ALTERNATE");
  });

  it("refuses a non-positive factor rather than normalizing its sign", async () => {
    const world = await createConvexInventoryWorld();
    for (const [numerator, denominator] of [
      [-12, 1],
      [12, 0],
      [0, 1],
    ] as const) {
      const result = value(
        await callAs(world, ACTOR_A, createItemUom, {
          requestId: `req_uom_${numerator}_${denominator}`,
          itemId: world.a.item,
          uom: `U${numerator}${denominator}`,
          toBaseNumerator: numerator,
          toBaseDenominator: denominator,
        }),
      );
      expect(result["written"], `${numerator}/${denominator}`).toBe(false);
    }
  });

  it("refuses a second factor for the same unit", async () => {
    const world = await createConvexInventoryWorld();
    await callAs(world, ACTOR_A, createItemUom, {
      requestId: "req_uom_d1",
      itemId: world.a.item,
      uom: "BOX",
      toBaseNumerator: 6,
      toBaseDenominator: 1,
    });

    const clash = value(
      await callAs(world, ACTOR_A, createItemUom, {
        requestId: "req_uom_d2",
        itemId: world.a.item,
        uom: "BOX",
        toBaseNumerator: 8,
        toBaseDenominator: 1,
      }),
    );
    expect(errorOf(clash).code).toBe("DUPLICATE_KEY");
    expect(errorOf(clash).field).toBe("uom");
  });

  it("lets two different items each declare the same unit", async () => {
    const world = await createConvexInventoryWorld();
    for (const [index, itemId] of [
      world.a.item,
      world.a.untrackedItem,
    ].entries()) {
      const result = value(
        await callAs(world, ACTOR_A, createItemUom, {
          requestId: `req_uom_s${index}`,
          itemId,
          uom: "CASE",
          toBaseNumerator: 12,
          toBaseDenominator: 1,
        }),
      );
      expect(result["written"], String(index)).toBe(true);
    }
  });

  it("rebuilds a profile the conversion kernel accepts", async () => {
    const world = await createConvexInventoryWorld();
    await callAs(world, ACTOR_A, createItemUom, {
      requestId: "req_uom_p1",
      itemId: world.a.item,
      uom: "CASE",
      toBaseNumerator: 12,
      toBaseDenominator: 1,
    });
    await callAs(world, ACTOR_A, createItemUom, {
      requestId: "req_uom_p2",
      itemId: world.a.item,
      uom: "PALLET",
      toBaseNumerator: 960,
      toBaseDenominator: 1,
    });

    const profile = value(
      await callAs(world, ACTOR_A, getItemUomProfile, { itemId: world.a.item }),
    );

    expect(profile["ok"]).toBe(true);
    expect(profile["baseUom"]).toBe("PCS");
    const alternates = profile["alternates"] as { uom: string }[];
    expect(alternates.map((row) => row.uom).sort()).toEqual(["CASE", "PALLET"]);
  });

  it("omits a retired unit from the profile", async () => {
    // A retired unit must stop being offered for capture; leaving it in the
    // profile would keep it convertible.
    const world = await createConvexInventoryWorld();
    const created = value(
      await callAs(world, ACTOR_A, createItemUom, {
        requestId: "req_uom_r1",
        itemId: world.a.item,
        uom: "OLDCASE",
        toBaseNumerator: 10,
        toBaseDenominator: 1,
      }),
    );
    await callAs(world, ACTOR_A, deactivateItemUom, {
      requestId: "req_uom_r2",
      itemUomId: created["documentId"],
    });

    const profile = value(
      await callAs(world, ACTOR_A, getItemUomProfile, { itemId: world.a.item }),
    );
    expect(profile["alternates"]).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Label templates                                                             */
/* -------------------------------------------------------------------------- */

const ZPL = "^XA\n^FO50,50^A0N,40,40^FDSTEEL^FS\n^XZ";

describe("label templates", () => {
  it("drafts version one and derives the version server-side", async () => {
    const world = await createConvexInventoryWorld();
    const created = value(
      await callAs(world, ACTOR_A, draftLabelTemplate, {
        requestId: "req_lt_1",
        code: "pallet-label",
        name: "ฉลากพาเลท",
        format: "ZPL",
        body: ZPL,
      }),
    );
    expect(created["written"]).toBe(true);

    const page = value(await callAs(world, ACTOR_A, listLabelTemplates, {}));
    const rows = page["items"] as {
      code: string;
      version: number;
      status: string;
    }[];
    expect(rows[0]?.code).toBe("PALLET-LABEL");
    expect(rows[0]?.version).toBe(1);
    expect(rows[0]?.status).toBe("DRAFT");
  });

  it("has no client-supplied version argument", async () => {
    // A client-chosen version would let two drafts claim one number, and a
    // printed label cites the version as evidence.
    const exported = (
      draftLabelTemplate as unknown as { exportArgs: () => string }
    ).exportArgs();
    expect(exported).not.toContain('"version"');
  });

  it("increments the version for a second draft of the same code", async () => {
    const world = await createConvexInventoryWorld();
    for (const index of [1, 2, 3]) {
      value(
        await callAs(world, ACTOR_A, draftLabelTemplate, {
          requestId: `req_lt_v${index}`,
          code: "CARTON",
          name: `Carton v${index}`,
          format: "ZPL",
          body: `${ZPL}\n^FX v${index}`,
        }),
      );
    }

    const page = value(await callAs(world, ACTOR_A, listLabelTemplates, {}));
    const versions = (page["items"] as { version: number }[]).map(
      (row) => row.version,
    );
    expect(versions.sort()).toEqual([1, 2, 3]);
  });

  it("refuses an empty or control-character body", async () => {
    const world = await createConvexInventoryWorld();
    for (const [index, body] of ["", "   ", "^XA ^XZ"].entries()) {
      const result = value(
        await callAs(world, ACTOR_A, draftLabelTemplate, {
          requestId: `req_lt_b${index}`,
          code: `BAD${index}`,
          name: "Bad",
          format: "ZPL",
          body,
        }),
      );
      expect(result["written"], JSON.stringify(body)).toBe(false);
      expect(errorOf(result).field).toBe("body");
    }
  });

  it("returns the body only from the detail read, never from the list", async () => {
    // A list is for choosing a template; shipping every version's payload to
    // render a table would be an unbounded response for no reader.
    const world = await createConvexInventoryWorld();
    const created = value(
      await callAs(world, ACTOR_A, draftLabelTemplate, {
        requestId: "req_lt_body",
        code: "BODY",
        name: "Body",
        format: "ZPL",
        body: ZPL,
      }),
    );

    const page = value(await callAs(world, ACTOR_A, listLabelTemplates, {}));
    expect(JSON.stringify(page)).not.toContain("^FO50,50");

    const detail = value(
      await callAs(world, ACTOR_A, getLabelTemplate, {
        labelTemplateId: created["documentId"],
      }),
    );
    expect(detail["body"]).toBe(ZPL);
  });

  describe("publishing is genuine maker-checker", () => {
    it("denies the drafter publishing their own version", async () => {
      /*
       * `INV-0006-05`, and the repository's first workflow that actually
       * exercises it: one person writes the label, another approves what will be
       * printed on every carton.
       *
       * The acting role is `ORG_ADMIN` because `label.template.manage` is granted
       * to nobody else (catalogue §4). With a narrower role the denial would be
       * `NO_PERMISSION`, which is a different and less interesting statement.
       */
      const world = await createConvexInventoryWorld(
        {},
        { roleA: "ORG_ADMIN" },
      );
      const created = value(
        await callAs(world, ACTOR_A, draftLabelTemplate, {
          requestId: "req_lt_own1",
          code: "OWN",
          name: "Own",
          format: "ZPL",
          body: ZPL,
        }),
      );

      const outcome = await callAs(world, ACTOR_A, publishLabelTemplate, {
        requestId: "req_lt_own2",
        labelTemplateId: created["documentId"],
      });

      expect(outcome["ok"]).toBe(false);
      expect((outcome["denial"] as { code: string }).code).toBe(
        "AUTHORIZATION_DENIED",
      );

      const denied = (await auditRows(world)).find(
        (row) =>
          row.permissionCode === "label.template.manage" &&
          row.outcome === "DENIED",
      );
      expect(denied?.denialReason).toBe("APPROVAL_REQUIRED");
    });

    it("still denies a second actor without step-up, and says which gate", async () => {
      /*
       * Two independent gates. With a different publisher the maker-checker
       * requirement is satisfied, and `label.template.manage` *also* carries
       * step-up — which needs a recent reverification only a Clerk instance can
       * produce. The denial reason distinguishes them, which is the whole point
       * of recording it.
       */
      const world = await createConvexInventoryWorld(
        {},
        { roleA: "ORG_ADMIN" },
      );
      await seedSecondActorForOrgA(world, "ORG_ADMIN");

      const created = value(
        await callAs(world, ACTOR_A, draftLabelTemplate, {
          requestId: "req_lt_two1",
          code: "TWO",
          name: "Two",
          format: "ZPL",
          body: ZPL,
        }),
      );

      const outcome = await callAs(world, ACTOR_A2, publishLabelTemplate, {
        requestId: "req_lt_two2",
        labelTemplateId: created["documentId"],
      });

      expect(outcome["ok"]).toBe(false);
      const denied = (await auditRows(world)).filter(
        (row) =>
          row.permissionCode === "label.template.manage" &&
          row.outcome === "DENIED",
      );
      // Maker-checker is satisfied by the second actor; step-up is not.
      expect(denied.at(-1)?.denialReason).toBe("REVERIFICATION_REQUIRED");
    });

    it("publishes when a different actor has recently reverified", async () => {
      const world = await createConvexInventoryWorld(
        {},
        { roleA: "ORG_ADMIN" },
      );
      const second = await seedSecondActorForOrgA(world, "ORG_ADMIN");

      const created = value(
        await callAs(world, ACTOR_A, draftLabelTemplate, {
          requestId: "req_lt_ok1",
          code: "OK",
          name: "Ok",
          format: "ZPL",
          body: ZPL,
        }),
      );

      // A fresh step-up for the *publisher*, which is what the evaluator reads.
      const now = Date.now();
      await recordStepUp(world, {
        orgId: world.orgA,
        userId: second.userId,
        occurredAt: now,
        reverifiedAt: now,
      });

      const outcome = await callAs(world, ACTOR_A2, publishLabelTemplate, {
        requestId: "req_lt_ok2",
        labelTemplateId: created["documentId"],
      });

      expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
      const result = value(outcome);
      expect(result["written"]).toBe(true);

      const detail = value(
        await callAs(world, ACTOR_A2, getLabelTemplate, {
          labelTemplateId: created["documentId"],
        }),
      );
      expect(detail["status"]).toBe("ACTIVE");
    });

    it("refuses to publish a version that is not a draft", async () => {
      const world = await createConvexInventoryWorld(
        {},
        { roleA: "ORG_ADMIN" },
      );
      const second = await seedSecondActorForOrgA(world, "ORG_ADMIN");
      const created = value(
        await callAs(world, ACTOR_A, draftLabelTemplate, {
          requestId: "req_lt_re1",
          code: "REPUB",
          name: "Republish",
          format: "ZPL",
          body: ZPL,
        }),
      );
      const republishNow = Date.now();
      await recordStepUp(world, {
        orgId: world.orgA,
        userId: second.userId,
        occurredAt: republishNow,
        reverifiedAt: republishNow,
      });

      value(
        await callAs(world, ACTOR_A2, publishLabelTemplate, {
          requestId: "req_lt_re2",
          labelTemplateId: created["documentId"],
        }),
      );
      const again = value(
        await callAs(world, ACTOR_A2, publishLabelTemplate, {
          requestId: "req_lt_re3",
          labelTemplateId: created["documentId"],
        }),
      );

      expect(again["written"]).toBe(false);
      expect(errorOf(again).reason).toBe("NOT_A_DRAFT");
    });
  });
});
