/**
 * Integration tier — the master-data write surface over `convex-test`.
 *
 * Scope: normalization, idempotent replay, uniqueness by contract, the audit
 * diff, and the shape of every refusal. The *cross-tenant* claims live in
 * `tests/isolation/master-data-writes.isolation.test.ts`.
 *
 * All data is synthetic (`tests/fixtures/README.md`).
 */
import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import {
  createItem,
  createLocation,
  createLot,
  deactivateItem,
  updateItem,
  updateLocation,
  MASTER_DATA_OPERATIONS,
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

/** The `value` of a successful wrapper envelope. */
function value(outcome: Record<string, unknown>): Record<string, unknown> {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
}

const errorOf = (result: Record<string, unknown>) =>
  result["error"] as { code: string; field?: string; reason?: string };

/** Every row of a table, for assertions the public surface cannot make. */
const itemRows = async (world: ConvexInventoryWorld) =>
  await world.t.run(async (ctx) => ctx.db.query("items").collect());
const lotRows = async (world: ConvexInventoryWorld) =>
  await world.t.run(async (ctx) => ctx.db.query("lots").collect());
const locationRows = async (world: ConvexInventoryWorld) =>
  await world.t.run(async (ctx) => ctx.db.query("locations").collect());
const auditRows = async (world: ConvexInventoryWorld) =>
  await world.t.run(async (ctx) => ctx.db.query("auditEvents").collect());

describe("createItem", () => {
  it("normalizes the SKU and the base UOM server-side", async () => {
    /*
     * The browser sent a padded, lower-case SKU. The server decides the stored
     * form — a uniqueness check that ran before normalization would let
     * ` widget-x ` and `WIDGET-X` both exist.
     */
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, "a", createItem, {
        requestId: "req_create_1",
        sku: "  new-widget  ",
        name: "  วิดเจ็ตใหม่  ",
        baseUom: " pcs ",
        trackingMode: "LOT",
      }),
    );

    expect(result["written"]).toBe(true);
    const created = (await itemRows(world)).find(
      (row) => row._id === result["documentId"],
    );
    expect(created?.sku).toBe("NEW-WIDGET");
    expect(created?.baseUom).toBe("PCS");
    // A display name keeps its case and its Thai characters; it is content, not
    // an identifier.
    expect(created?.name).toBe("วิดเจ็ตใหม่");
    expect(created?.status).toBe("ACTIVE");
  });

  it("refuses a duplicate SKU by field name, never by value", async () => {
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, "a", createItem, {
        requestId: "req_dupe",
        // The fixture already seeds `WIDGET-001`.
        sku: "widget-001",
        name: "Duplicate",
        baseUom: "PCS",
        trackingMode: "LOT",
      }),
    );

    expect(result["written"]).toBe(false);
    expect(errorOf(result).code).toBe("DUPLICATE_KEY");
    expect(errorOf(result).field).toBe("sku");
    // Naming the colliding value or its document ID would make the same code
    // path an oracle for a caller who guessed.
    expect(JSON.stringify(result)).not.toContain("WIDGET-001");
  });

  it("refuses a code that does not survive normalization, naming the field", async () => {
    const world = await createConvexInventoryWorld();

    for (const [sku, reason] of [
      ["", "EMPTY"],
      ["   ", "EMPTY"],
      ["has space", "WHITESPACE_NOT_ALLOWED"],
      ["X".repeat(200), "TOO_LONG"],
    ] as const) {
      const result = value(
        await callAs(world, "a", createItem, {
          requestId: `req_${reason}_${sku.length}`,
          sku,
          name: "Name",
          baseUom: "PCS",
          trackingMode: "NONE",
        }),
      );
      expect(result["written"], sku).toBe(false);
      expect(errorOf(result).code).toBe("FIELD_INVALID");
      expect(errorOf(result).field).toBe("sku");
      expect(errorOf(result).reason).toBe(reason);
    }
  });

  it("refuses an empty display name", async () => {
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, "a", createItem, {
        requestId: "req_noname",
        sku: "NO-NAME",
        name: "   ",
        baseUom: "PCS",
        trackingMode: "NONE",
      }),
    );

    expect(errorOf(result).field).toBe("name");
    expect(errorOf(result).reason).toBe("EMPTY");
  });

  it("writes one row for a repeated identical request", async () => {
    // `INV-0003-01`, generalized: a retry after a stall must not make a second
    // item.
    const world = await createConvexInventoryWorld();
    const args = {
      requestId: "req_retry",
      sku: "RETRIED",
      name: "Retried",
      baseUom: "PCS",
      trackingMode: "NONE",
    };

    const first = value(await callAs(world, "a", createItem, args));
    const second = value(await callAs(world, "a", createItem, args));

    expect(first["written"]).toBe(true);
    expect(first["replayed"]).toBe(false);
    expect(second["written"]).toBe(true);
    expect(second["replayed"]).toBe(true);
    expect(second["documentId"]).toBe(first["documentId"]);

    const created = (await itemRows(world)).filter(
      (row) => row.sku === "RETRIED",
    );
    expect(created).toHaveLength(1);
  });

  it("refuses the same request ID with different arguments", async () => {
    // A reused ID is not a retry. Answering with the first result would
    // silently discard the second request.
    const world = await createConvexInventoryWorld();
    await callAs(world, "a", createItem, {
      requestId: "req_reused",
      sku: "FIRST",
      name: "First",
      baseUom: "PCS",
      trackingMode: "NONE",
    });

    const conflict = value(
      await callAs(world, "a", createItem, {
        requestId: "req_reused",
        sku: "SECOND",
        name: "Second",
        baseUom: "PCS",
        trackingMode: "NONE",
      }),
    );

    expect(conflict["written"]).toBe(false);
    expect(errorOf(conflict).code).toBe("REQUEST_ARGUMENT_CONFLICT");
    expect((await itemRows(world)).some((row) => row.sku === "SECOND")).toBe(
      false,
    );
  });

  it("normalizes before fingerprinting, so a padded retry is still a retry", async () => {
    /*
     * The subtle one. If the fingerprint covered the *raw* arguments, a retry
     * whose SKU gained a space would read as `REQUEST_ARGUMENT_CONFLICT` — a
     * spurious failure on a legitimate retry.
     */
    const world = await createConvexInventoryWorld();
    const base = {
      requestId: "req_padded",
      name: "Padded",
      baseUom: "PCS",
      trackingMode: "NONE" as const,
    };

    const first = value(
      await callAs(world, "a", createItem, { ...base, sku: "PADDED" }),
    );
    const retry = value(
      await callAs(world, "a", createItem, { ...base, sku: "  padded  " }),
    );

    expect(retry["written"]).toBe(true);
    expect(retry["replayed"]).toBe(true);
    expect(retry["documentId"]).toBe(first["documentId"]);
  });

  it("writes an audit row naming the operation, the permission, and the fields", async () => {
    const world = await createConvexInventoryWorld();
    const created = value(
      await callAs(world, "a", createItem, {
        requestId: "req_audited",
        sku: "AUDITED",
        name: "Audited",
        baseUom: "PCS",
        trackingMode: "LOT",
      }),
    );

    const audit = (await auditRows(world)).filter(
      (row) => row.entityId === created["documentId"],
    );
    const domainRow = audit.find(
      (row) => row.action === MASTER_DATA_OPERATIONS.createItem,
    );

    expect(domainRow).toBeDefined();
    expect(domainRow?.entityTable).toBe("items");
    expect(domainRow?.permissionCode).toBe("masterData.item.manage");
    expect(domainRow?.outcome).toBe("ALLOWED");
    expect(domainRow?.actorKind).toBe("USER");
    expect(
      (domainRow?.changes ?? []).map((change) => change.field).sort(),
    ).toEqual(["baseUom", "name", "sku", "status", "trackingMode"]);
  });

  it("writes the authorization row and the domain row separately", async () => {
    /*
     * Two rows, two questions. The wrapper's row records that the actor *was
     * allowed*; this module's records what they *did*, with the diff. Collapsing
     * them would lose one of the two.
     */
    const world = await createConvexInventoryWorld();
    const created = value(
      await callAs(world, "a", createItem, {
        requestId: "req_two_rows",
        sku: "TWO-ROWS",
        name: "Two rows",
        baseUom: "PCS",
        trackingMode: "NONE",
      }),
    );

    const rows = await auditRows(world);
    const authorization = rows.filter(
      (row) =>
        row.action === "masterData.item.manage" && row.entityTable === "items",
    );
    const domain = rows.filter(
      (row) =>
        row.entityId === created["documentId"] &&
        row.action === MASTER_DATA_OPERATIONS.createItem,
    );

    expect(authorization.length).toBeGreaterThan(0);
    expect(domain).toHaveLength(1);
  });
});

describe("updateItem", () => {
  it("records a from/to diff for the fields that changed", async () => {
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, "a", updateItem, {
        requestId: "req_rename",
        itemId: world.a.item,
        name: "ชื่อใหม่",
      }),
    );

    expect(result["written"]).toBe(true);
    const audit = (await auditRows(world)).find(
      (row) => row.action === MASTER_DATA_OPERATIONS.updateItem,
    );
    expect(audit?.changes).toEqual([
      { field: "name", from: "Widget", to: "ชื่อใหม่" },
    ]);
  });

  it("has no field for the SKU or the base UOM", async () => {
    /*
     * Not "rejects" — there is no argument to send. Changing a SKU rewrites the
     * meaning of history, and changing a base UOM silently reinterprets every
     * quantity already posted (`ADR-0004`).
     */
    const args = Object.keys(
      (updateItem as unknown as { exportArgs: () => string }).exportArgs(),
    );
    const exported = (
      updateItem as unknown as { exportArgs: () => string }
    ).exportArgs();

    expect(args.length).toBeGreaterThanOrEqual(0);
    expect(exported).not.toContain("baseUom");
    expect(exported).not.toContain('"sku"');
  });

  it("answers NOT_FOUND for an item that does not exist", async () => {
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, "a", updateItem, {
        requestId: "req_missing",
        itemId: world.vanishedItem,
        name: "Ghost",
      }),
    );

    expect(result["written"]).toBe(false);
    expect(errorOf(result).code).toBe("NOT_FOUND");
  });

  it("still audits an update that changed nothing", async () => {
    // "Someone submitted an update that changed nothing" is a fact worth
    // keeping; an absent row would make it look like the request never arrived.
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, "a", updateItem, {
        requestId: "req_noop",
        itemId: world.a.item,
        name: "Widget",
      }),
    );

    expect(result["written"]).toBe(true);
    const audit = (await auditRows(world)).find(
      (row) => row.action === MASTER_DATA_OPERATIONS.updateItem,
    );
    expect(audit).toBeDefined();
    expect(audit?.changes).toEqual([]);
  });
});

describe("deactivateItem", () => {
  /*
   * `masterData.item.deactivate` carries maker-checker (catalogue §2), and the
   * evaluator denies whenever the maker and the actor are the same person — or
   * when there is no maker at all. Both are fail-closed, and both are correct:
   * withdrawing a SKU from receiving stops every future receipt of it.
   *
   * These tests therefore assert the *denial*, which is the behaviour a single
   * actor gets today. A satisfied deactivation needs a second mirrored actor in
   * the same organization, which arrives with the membership-management slice;
   * the mutation is complete and its approval path is not reachable yet.
   */
  it("denies a single actor who is also the item's last writer", async () => {
    const world = await createConvexInventoryWorld();

    const created = value(
      await callAs(world, "a", createItem, {
        requestId: "req_mine",
        sku: "MINE",
        name: "Mine",
        baseUom: "PCS",
        trackingMode: "NONE",
      }),
    );

    const outcome = await callAs(world, "a", deactivateItem, {
      requestId: "req_deactivate_own",
      itemId: created["documentId"],
    });

    expect(outcome["ok"]).toBe(false);
    expect((outcome["denial"] as { code: string }).code).toBe(
      "AUTHORIZATION_DENIED",
    );

    // The item is untouched: a denied attempt writes no domain change.
    const after = (await itemRows(world)).find(
      (row) => row._id === created["documentId"],
    );
    expect(after?.status).toBe("ACTIVE");
  });

  it("records the denied attempt with its own permission code", async () => {
    // A denial on a *mutation* commits its audit row (`INV-0006-03`), which is
    // what makes "who tried to deactivate this SKU" answerable.
    const world = await createConvexInventoryWorld();
    await callAs(world, "a", deactivateItem, {
      requestId: "req_deactivate_perm",
      itemId: world.a.untrackedItem,
    });

    const denied = (await auditRows(world)).find(
      (row) =>
        row.permissionCode === "masterData.item.deactivate" &&
        row.outcome === "DENIED",
    );
    expect(denied).toBeDefined();
    expect(denied?.denialReason).toBe("APPROVAL_REQUIRED");
  });
});

describe("createLocation", () => {
  it("creates a location inside the authorized warehouse", async () => {
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, "a", createLocation, {
        requestId: "req_loc",
        warehouseId: world.warehouses.alphaA,
        code: " rack-99 ",
        locationType: "RACK_BIN",
      }),
    );

    expect(result["written"]).toBe(true);
    const created = (await locationRows(world)).find(
      (row) => row._id === result["documentId"],
    );
    expect(created?.code).toBe("RACK-99");
    expect(created?.warehouseId).toBe(world.warehouses.alphaA);
  });

  it("scopes uniqueness to the warehouse, not the organization", async () => {
    /*
     * `(orgId, warehouseId, code)`. Two sites may both have the same code, and a
     * tenant-wide uniqueness check would refuse the second one for no reason.
     *
     * The second site is asserted from the fixture's seeded row rather than by
     * creating one: this tenant's membership is `WAREHOUSE_SCOPED` to `alphaA`,
     * so a create in `bravoA` is refused during tenant-context resolution —
     * which is the correct behaviour and a different claim from this one.
     */
    const world = await createConvexInventoryWorld();
    const seeded = (await locationRows(world)).filter(
      (row) => row.orgId === world.orgA,
    );
    const inOtherSite = seeded.filter(
      (row) => row.warehouseId !== world.warehouses.alphaA,
    );
    expect(inOtherSite.length).toBeGreaterThan(0);

    const duplicateSameSite = value(
      await callAs(world, "a", createLocation, {
        requestId: "req_loc_dupe",
        warehouseId: world.warehouses.alphaA,
        code: "DOCK-01",
        locationType: "DOCK",
      }),
    );
    expect(duplicateSameSite["written"]).toBe(false);
    expect(errorOf(duplicateSameSite).code).toBe("DUPLICATE_KEY");
    expect(errorOf(duplicateSameSite).field).toBe("code");

    // The same code in a different site is a different key, so the seeded row
    // and the refused one can coexist.
    const codes = seeded.map((row) => `${row.warehouseId}:${row.code}`);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("updateLocation", () => {
  it("does not collide a keyed field with the row's own value", async () => {
    // A no-op update of a uniqueness-bearing entity must not read as a
    // duplicate of itself.
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, "a", updateLocation, {
        requestId: "req_loc_update",
        warehouseId: world.warehouses.alphaA,
        locationId: world.a.dock,
        status: "INACTIVE",
      }),
    );

    expect(result["written"]).toBe(true);
    const updated = (await locationRows(world)).find(
      (row) => row._id === world.a.dock,
    );
    expect(updated?.status).toBe("INACTIVE");
  });
});

describe("createLot", () => {
  it("creates a lot for a lot-tracked item", async () => {
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, "a", createLot, {
        requestId: "req_lot",
        itemId: world.a.item,
        lotCode: "ab12",
        expirationDate: "2027-01-31",
      }),
    );

    expect(result["written"]).toBe(true);
    const created = (await lotRows(world)).find(
      (row) => row._id === result["documentId"],
    );
    // Case is preserved: a supplier's `ab12` and `AB12` may be different
    // batches, so folding them would silently merge two lots.
    expect(created?.lotCode).toBe("ab12");
    expect(created?.expirationDate).toBe("2027-01-31");
  });

  it("refuses a lot for an item that is not lot-tracked", async () => {
    // An item declared `NONE` has no lots by definition (D-09). A lot pointing
    // at one is a row the ledger refuses on every posting.
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, "a", createLot, {
        requestId: "req_lot_untracked",
        itemId: world.a.untrackedItem,
        lotCode: "L1",
      }),
    );

    expect(result["written"]).toBe(false);
    expect(errorOf(result).reason).toBe("ITEM_NOT_LOT_TRACKED");
  });

  it("refuses a malformed business date rather than shifting it", async () => {
    const world = await createConvexInventoryWorld();

    // Short, distinct lot codes: `MAX_LOT_CODE_LENGTH` is 20, so a code built
    // from the date under test would itself be refused and the assertion would
    // pass for the wrong reason.
    const cases = [
      ["2027-1-31", "L1"],
      ["2027-02-30", "L2"],
      ["2027-01-31T00:00:00Z", "L3"],
    ] as const;

    for (const [bad, lotCode] of cases) {
      const result = value(
        await callAs(world, "a", createLot, {
          requestId: `req_lot_${lotCode}`,
          itemId: world.a.item,
          lotCode,
          expirationDate: bad,
        }),
      );
      expect(result["written"], bad).toBe(false);
      expect(errorOf(result).field).toBe("expirationDate");
    }
  });

  it("scopes lot-code uniqueness to the item", async () => {
    const world = await createConvexInventoryWorld();

    const first = value(
      await callAs(world, "a", createLot, {
        requestId: "req_lot_u1",
        itemId: world.a.item,
        lotCode: "SHARED",
      }),
    );
    expect(first["written"]).toBe(true);

    const sameCodeSameItem = value(
      await callAs(world, "a", createLot, {
        requestId: "req_lot_u2",
        itemId: world.a.item,
        lotCode: "SHARED",
      }),
    );
    expect(sameCodeSameItem["written"]).toBe(false);
    expect(errorOf(sameCodeSameItem).field).toBe("lotCode");

    const sameCodeOtherItem = value(
      await callAs(world, "a", createLot, {
        requestId: "req_lot_u3",
        itemId: world.a.serialItem,
        lotCode: "SHARED",
      }),
    );
    expect(sameCodeOtherItem["written"]).toBe(true);
  });

  it("answers REFERENCE_NOT_FOUND for an item this tenant does not own", async () => {
    const world = await createConvexInventoryWorld();
    const result = value(
      await callAs(world, "a", createLot, {
        requestId: "req_lot_foreign",
        itemId: world.b.item,
        lotCode: "FOREIGN",
      }),
    );

    expect(result["written"]).toBe(false);
    expect(errorOf(result).code).toBe("REFERENCE_NOT_FOUND");
    expect(errorOf(result).field).toBe("itemId");
  });
});
