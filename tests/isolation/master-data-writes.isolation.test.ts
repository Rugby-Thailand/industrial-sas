/**
 * Isolation tier — the master-data writes, from two tenants at once.
 *
 * A write is where isolation is most expensive to get wrong: a read that leaked
 * shows one tenant another's data, and a write that leaked *changes* it. Every
 * claim here is a two-tenant claim, and this tier is a blocking merge gate
 * (`INV-0012-02`, `RG-031`).
 *
 * The fixture seeds both tenants identically — same SKUs, same location codes,
 * same lot codes — so nothing here can pass by accident of distinct values.
 *
 * All data is synthetic (`tests/fixtures/README.md`).
 */
import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import {
  createItem,
  createLocation,
  createLot,
  updateItem,
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

/** Both tenants' actors share one Clerk subject; only the org claim differs. */
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

const itemRows = async (world: ConvexInventoryWorld) =>
  await world.t.run(async (ctx) => ctx.db.query("items").collect());
const lotRows = async (world: ConvexInventoryWorld) =>
  await world.t.run(async (ctx) => ctx.db.query("lots").collect());
const idempotencyRows = async (world: ConvexInventoryWorld) =>
  await world.t.run(async (ctx) =>
    ctx.db.query("idempotencyRecords").collect(),
  );
const auditRows = async (world: ConvexInventoryWorld) =>
  await world.t.run(async (ctx) => ctx.db.query("auditEvents").collect());

describe("master-data writes are tenant-confined", () => {
  it("stamps the writing tenant, never the caller's choice", async () => {
    // `orgId` is derived from the resolved context and is not an argument
    // anywhere in the write path (`INV-0001-02`).
    const world = await createConvexInventoryWorld();

    const created = value(
      await callAs(world, "a", createItem, {
        requestId: "req_stamp",
        sku: "STAMPED",
        name: "Stamped",
        baseUom: "PCS",
        trackingMode: "NONE",
      }),
    );

    const row = (await itemRows(world)).find(
      (item) => item._id === created["documentId"],
    );
    expect(row?.orgId).toBe(world.orgA);
  });

  it("lets both tenants hold the same SKU without either colliding", async () => {
    /*
     * `(orgId, sku)`. A uniqueness check that forgot the organization would
     * refuse the second tenant's create — and, worse, would have told them the
     * SKU exists somewhere.
     */
    const world = await createConvexInventoryWorld();
    const args = {
      sku: "SHARED-SKU",
      name: "Shared",
      baseUom: "PCS",
      trackingMode: "NONE" as const,
    };

    const a = value(
      await callAs(world, "a", createItem, { ...args, requestId: "req_a" }),
    );
    const b = value(
      await callAs(world, "b", createItem, { ...args, requestId: "req_b" }),
    );

    expect(a["written"]).toBe(true);
    expect(b["written"]).toBe(true);
    expect(a["documentId"]).not.toBe(b["documentId"]);

    const rows = (await itemRows(world)).filter(
      (item) => item.sku === "SHARED-SKU",
    );
    expect(rows.map((item) => item.orgId).sort()).toEqual(
      [world.orgA, world.orgB].sort(),
    );
  });

  it("does not let one tenant's request ID replay into another's", async () => {
    /*
     * The idempotency key is `(orgId, operation, requestId)`. If the organization
     * were not part of it, tenant B's first create would silently return tenant
     * A's document ID — a cross-tenant leak dressed as a retry.
     */
    const world = await createConvexInventoryWorld();
    const shared = "req_shared_id";

    const a = value(
      await callAs(world, "a", createItem, {
        requestId: shared,
        sku: "ID-A",
        name: "A",
        baseUom: "PCS",
        trackingMode: "NONE",
      }),
    );
    const b = value(
      await callAs(world, "b", createItem, {
        requestId: shared,
        sku: "ID-B",
        name: "B",
        baseUom: "PCS",
        trackingMode: "NONE",
      }),
    );

    expect(a["replayed"]).toBe(false);
    expect(b["replayed"]).toBe(false);
    expect(a["documentId"]).not.toBe(b["documentId"]);

    const records = await idempotencyRows(world);
    const shareds = records.filter((row) => row.requestId === shared);
    expect(shareds).toHaveLength(2);
    expect(shareds.map((row) => row.orgId).sort()).toEqual(
      [world.orgA, world.orgB].sort(),
    );
  });

  it("refuses to update another tenant's document, and changes nothing", async () => {
    const world = await createConvexInventoryWorld();
    const before = (await itemRows(world)).find(
      (item) => item._id === world.b.item,
    );

    const result = value(
      await callAs(world, "a", updateItem, {
        requestId: "req_cross_update",
        itemId: world.b.item,
        name: "Renamed by the wrong tenant",
      }),
    );

    expect(result["written"]).toBe(false);
    expect(errorOf(result).code).toBe("NOT_FOUND");

    const after = (await itemRows(world)).find(
      (item) => item._id === world.b.item,
    );
    expect(after?.name).toBe(before?.name);
  });

  it("answers a foreign document exactly as it answers a deleted one", async () => {
    // `INV-0002-03`: a caller holding a foreign ID must not be able to learn
    // that it exists.
    const world = await createConvexInventoryWorld();

    const foreign = value(
      await callAs(world, "a", updateItem, {
        requestId: "req_foreign",
        itemId: world.b.item,
        name: "X",
      }),
    );
    const deleted = value(
      await callAs(world, "a", updateItem, {
        requestId: "req_deleted",
        itemId: world.vanishedItem,
        name: "X",
      }),
    );

    expect(foreign).toEqual(deleted);
  });

  it("refuses a lot whose item belongs to another tenant", async () => {
    const world = await createConvexInventoryWorld();

    const result = value(
      await callAs(world, "a", createLot, {
        requestId: "req_cross_lot",
        itemId: world.b.item,
        lotCode: "X1",
      }),
    );

    expect(result["written"]).toBe(false);
    expect(errorOf(result).code).toBe("REFERENCE_NOT_FOUND");
    // No orphan lot was created under either tenant.
    expect((await lotRows(world)).some((lot) => lot.lotCode === "X1")).toBe(
      false,
    );
  });

  it("refuses a location in another tenant's warehouse before authorization", async () => {
    /*
     * A foreign warehouse is revalidated during tenant-context resolution, so
     * the request never reaches the handler — and the refusal is the same one a
     * warehouse that never existed produces.
     */
    const world = await createConvexInventoryWorld();

    let refused = false;
    try {
      await callAs(world, "a", createLocation, {
        requestId: "req_cross_location",
        warehouseId: world.warehouses.alphaB,
        code: "INTRUDER",
        locationType: "DOCK",
      });
    } catch (error) {
      refused = true;
      const data = (error as { readonly data?: Record<string, unknown> }).data;
      expect(data?.["kind"]).toBe("TENANT_CONTEXT_DENIED");
      expect(data?.["code"]).toBe("WAREHOUSE_UNKNOWN");
    }
    expect(refused).toBe(true);
  });

  it("writes each tenant's audit rows under its own organization", async () => {
    const world = await createConvexInventoryWorld();

    await callAs(world, "a", createItem, {
      requestId: "req_audit_a",
      sku: "AUD-A",
      name: "A",
      baseUom: "PCS",
      trackingMode: "NONE",
    });
    await callAs(world, "b", createItem, {
      requestId: "req_audit_b",
      sku: "AUD-B",
      name: "B",
      baseUom: "PCS",
      trackingMode: "NONE",
    });

    const domain = (await auditRows(world)).filter(
      (row) => row.action === MASTER_DATA_OPERATIONS.createItem,
    );
    expect(domain.length).toBeGreaterThanOrEqual(2);

    const byOrg = new Map(domain.map((row) => [row.orgId, row]));
    expect(byOrg.has(world.orgA)).toBe(true);
    expect(byOrg.has(world.orgB)).toBe(true);
    // No audit row names an entity belonging to the other tenant.
    const items = await itemRows(world);
    for (const row of domain) {
      const entity = items.find((item) => item._id === row.entityId);
      expect(entity?.orgId, String(row.entityId)).toBe(row.orgId);
    }
  });

  it("does not let a duplicate refusal reveal the other tenant's rows", async () => {
    /*
     * Tenant B holds `WIDGET-001` too. Tenant A creating it must succeed or fail
     * on *its own* catalogue alone — and here it fails, because tenant A also has
     * one. The point is that the refusal is identical either way and names no
     * organization.
     */
    const world = await createConvexInventoryWorld();

    const result = value(
      await callAs(world, "a", createItem, {
        requestId: "req_dupe_iso",
        sku: "WIDGET-001",
        name: "Duplicate",
        baseUom: "PCS",
        trackingMode: "LOT",
      }),
    );

    expect(errorOf(result).code).toBe("DUPLICATE_KEY");
    expect(errorOf(result).field).toBe("sku");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(world.orgA);
    expect(serialized).not.toContain(world.orgB);
    expect(serialized).not.toContain(world.a.item);
  });
});
