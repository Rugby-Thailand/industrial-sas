/**
 * Isolation tier — reporting must not leak across tenants.
 *
 * A dashboard and an export are the two surfaces where a tenant boundary failure
 * would be most damaging and least visible: a counter is a single number with no
 * provenance on screen, and an export is tenant data in its most portable form —
 * once it is in somebody's downloads folder, the boundary is gone.
 *
 * Every statement here is a two-tenant one, which is why it lives in this tier
 * rather than beside the behaviour tests.
 */
import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";

import { readDashboard, readOccupancy } from "../../convex/reporting/dashboard";
import { getReportJob, requestExport } from "../../convex/reporting/exports";
import {
  readOperationalExceptions,
  readStockMovements,
  readStockReports,
} from "../../convex/reporting/operationalViews";
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

const value = (outcome: Record<string, unknown>): Record<string, unknown> => {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
};

const requestId = (name: string): string => {
  let hash = 0;
  for (const character of name) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return `0193f2c1-0000-7000-8000-0000${hash.toString(16).padStart(8, "0")}`;
};

describe("reporting across tenants", () => {
  it("counts one tenant's rollup rows and never the other's", async () => {
    const world = await createConvexInventoryWorld();

    // Written directly, because the point is the *read* boundary: a counter that
    // exists for A must be invisible to B even when B asks about its own site.
    await world.t.run(async (ctx) => {
      await ctx.db.insert("operationsRollups", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        metric: "RECEIPTS_OPENED",
        subjectKey: "-",
        count: 7,
        updatedAt: 1,
      });
    });

    const asA = value(
      await callAs(world, "a", readDashboard, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const asB = value(
      await callAs(world, "b", readDashboard, {
        warehouseId: world.warehouses.alphaB,
      }),
    );

    const countOf = (tiles: unknown) =>
      (tiles as { metric: string; count: number }[]).find(
        (tile) => tile.metric === "RECEIPTS_OPENED",
      )?.count;

    expect(countOf(asA["tiles"])).toBe(7);
    expect(countOf(asB["tiles"])).toBe(0);
  });

  it("denies a warehouse the caller is not a member of", async () => {
    /*
     * `INV-0006-04`: the warehouse is revalidated against membership before the
     * handler runs, so asking about another tenant's site is a *denial* rather
     * than an empty dashboard. The distinction matters — an empty answer would
     * say "that site exists and has no work", which is one fact more than a
     * stranger should learn.
     */
    const world = await createConvexInventoryWorld();

    await expect(
      callAs(world, "b", readDashboard, {
        warehouseId: world.warehouses.alphaA,
      }),
    ).rejects.toThrow(/WAREHOUSE_UNKNOWN/);
  });

  it("applies the same warehouse boundary to stock and exception reports", async () => {
    const world = await createConvexInventoryWorld();
    for (const report of [
      readStockReports,
      readStockMovements,
      readOperationalExceptions,
    ]) {
      await expect(
        callAs(world, "b", report, {
          warehouseId: world.warehouses.alphaA,
        }),
      ).rejects.toThrow(/WAREHOUSE_UNKNOWN/);
    }
  });

  it("draws only the asking tenant's locations on the occupancy map", async () => {
    const world = await createConvexInventoryWorld();

    const asA = value(
      await callAs(world, "a", readOccupancy, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const asB = value(
      await callAs(world, "b", readOccupancy, {
        warehouseId: world.warehouses.alphaB,
      }),
    );

    const idsA = (asA["cells"] as { locationId: string }[]).map(
      (cell) => cell.locationId,
    );
    const idsB = (asB["cells"] as { locationId: string }[]).map(
      (cell) => cell.locationId,
    );

    expect(idsA.length).toBeGreaterThan(0);
    expect(idsB.length).toBeGreaterThan(0);
    expect(idsA.some((id) => idsB.includes(id))).toBe(false);
  });

  it("answers another tenant's export exactly as it answers a deleted one", async () => {
    /*
     * `INV-0002-03`. The artifact is the whole point: an export ID that answered
     * "exists but forbidden" would already have told the caller that a warehouse
     * they cannot see is producing extracts.
     *
     * The control is a **real `reportJobs` ID whose document is gone** — created
     * and then deleted — rather than the same foreign ID asked twice. Comparing
     * an ID to itself proves only that the function is deterministic; the claim
     * under test is that two *different* unreachable IDs are indistinguishable,
     * and a well-formed ID of the right table is the only honest control for it.
     */
    const world = await createConvexInventoryWorld();

    const requested = value(
      await callAs(world, "a", requestExport, {
        requestId: requestId("iso_export"),
        warehouseId: world.warehouses.alphaA,
        kind: "PUTAWAY_TASKS",
      }),
    );

    // Tenant B's own job, then deleted: a valid ID of this table, owned by the
    // asking tenant, referring to nothing.
    const vanished = value(
      await callAs(world, "b", requestExport, {
        requestId: requestId("iso_export_vanished"),
        warehouseId: world.warehouses.alphaB,
        kind: "PUTAWAY_TASKS",
      }),
    );
    await world.t.run(async (ctx) => {
      await ctx.db.delete(
        "reportJobs",
        vanished["documentId"] as GenericId<"reportJobs">,
      );
    });

    const foreign = value(
      await callAs(world, "b", getReportJob, {
        warehouseId: world.warehouses.alphaB,
        reportJobId: requested["documentId"],
      }),
    );
    const deleted = value(
      await callAs(world, "b", getReportJob, {
        warehouseId: world.warehouses.alphaB,
        reportJobId: vanished["documentId"],
      }),
    );

    expect(foreign).toEqual({ found: false });
    expect(foreign).toEqual(deleted);
  });

  it("lets each tenant hold the same request ID without colliding", async () => {
    // The idempotency namespace is `(orgId, requestId)`. Two tenants retrying
    // with the same generated ID must get two jobs, not one shared one.
    const world = await createConvexInventoryWorld();
    const shared = requestId("iso_shared_export");

    const asA = value(
      await callAs(world, "a", requestExport, {
        requestId: shared,
        warehouseId: world.warehouses.alphaA,
        kind: "PUTAWAY_TASKS",
      }),
    );
    const asB = value(
      await callAs(world, "b", requestExport, {
        requestId: shared,
        warehouseId: world.warehouses.alphaB,
        kind: "PUTAWAY_TASKS",
      }),
    );

    expect(asA["replayed"]).toBe(false);
    expect(asB["replayed"]).toBe(false);
    expect(asA["documentId"]).not.toBe(asB["documentId"]);
  });
});
