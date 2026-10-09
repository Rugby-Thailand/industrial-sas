import { ConvexError, type Value } from "convex/values";
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTestModuleMap,
} from "../fixtures/convex-tenant-world";

/**
 * Registered-function boundaries (T3).
 *
 * Most domain suites call `fn._handler(ctx, args)` for speed, which skips the
 * argument and return validators Convex applies to a real client call. These
 * cases go through `t.query` / `t.mutation` with the shipping modules, so a
 * narrowed validator, a spoofed tenant field or a result that no longer
 * matches its declared `returns` fails here exactly as it would in production.
 */

const MODULES: ConvexTestModuleMap = Object.fromEntries(
  Object.entries(
    import.meta.glob([
      "../../convex/**/*.ts",
      "!../../convex/_generated/**",
      "!../../convex/**/*.test.ts",
    ]) as Record<string, () => Promise<unknown>>,
  ).map(([path, load]) => [path.replace("../../convex/", "../convex/"), load]),
);

const A = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const B = { subject: "user_fixture_a", org_id: "org_fixture_b" };

async function world(roleA: "ORG_ADMIN" | "SUPERVISOR" = "ORG_ADMIN") {
  const created = await createConvexTenantWorld(MODULES);
  await seedConvexAuthorization(created, { roleA });
  return created;
}

async function thrown(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the registered call to fail.");
}

function denied(outcome: unknown) {
  expect(outcome).toMatchObject({
    ok: false,
    denial: { code: "AUTHORIZATION_DENIED" },
  });
}

async function contextDenied(operation: Promise<unknown>, code: string) {
  const error = await thrown(operation);
  expect(error).toBeInstanceOf(ConvexError);
  const data = (error as ConvexError<Value>).data as Record<string, unknown>;
  expect(data).toMatchObject({ kind: "TENANT_CONTEXT_DENIED", code });
  // The public denial never reveals which tenant owns the warehouse.
  expect(JSON.stringify(data)).not.toMatch(/org_fixture|Tenant [AB]/);
}

const building = (warehouseId: Id<"warehouses">, code = "B-1") => ({
  warehouseId,
  requestId: `req-${code}`,
  code,
  name: `Building ${code}`,
  widthMm: 10_000,
  depthMm: 20_000,
  defaultFloorHeightMm: 3_000,
  floorCount: 1,
});

describe("registered public functions", () => {
  it("returns only the caller's tenant and in-scope warehouses through the validated query", async () => {
    const t = await world();
    const outcome = (await t.t
      .withIdentity(A)
      .query(api.workspace.current.readCurrent, {})) as {
      ok: true;
      value: { organization: { id: string }; warehouses: { id: string }[] };
    };

    expect(outcome.ok).toBe(true);
    expect(outcome.value.organization.id).toBe(t.orgA);
    // Membership A is WAREHOUSE_SCOPED to ALPHA only.
    expect(outcome.value.warehouses.map(({ id }) => id)).toEqual([
      t.warehouses.alphaA,
    ]);
  });

  it("rejects a spoofed tenant argument at the validator, before any handler runs", async () => {
    const t = await world();
    const error = await thrown(
      t.t.withIdentity(A).query(api.workspace.current.readCurrent, {
        orgId: t.orgB,
      } as unknown as Record<string, never>),
    );
    expect(String(error)).toMatch(
      /extra field|Object contains extra field|Validator error/i,
    );
  });

  it("refuses an anonymous caller with a generic correlated error", async () => {
    const t = await world();
    const error = await thrown(
      t.t.query(api.workspace.current.readCurrent, {}),
    );
    expect(error).toBeInstanceOf(ConvexError);
    expect((error as ConvexError<Value>).data).toMatchObject({
      code: "ANONYMOUS",
    });
  });

  it("validates mutation argument types and IDs at the registered boundary", async () => {
    const t = await world();
    const wrongType = await thrown(
      t.t
        .withIdentity(A)
        .mutation(api.storageLayouts.writes.createStorageBuilding, {
          ...building(t.warehouses.alphaA),
          floorCount: "1" as unknown as number,
        }),
    );
    expect(String(wrongType)).toMatch(/Validator error/i);

    const wrongTable = await thrown(
      t.t
        .withIdentity(A)
        .mutation(api.storageLayouts.writes.createStorageBuilding, {
          ...building(t.orgA as unknown as Id<"warehouses">),
        } as never),
    );
    expect(String(wrongTable)).toMatch(/Validator error|warehouses/i);
  });

  it("denies a write into another tenant's warehouse and writes nothing", async () => {
    const t = await world();
    // A warehouse ID from another tenant resolves as unknown.
    await contextDenied(
      t.t
        .withIdentity(A)
        .mutation(
          api.storageLayouts.writes.createStorageBuilding,
          building(t.warehouses.alphaB),
        ),
      "WAREHOUSE_UNKNOWN",
    );
    // Out-of-scope warehouse inside the caller's own tenant is denied too.
    await contextDenied(
      t.t
        .withIdentity(A)
        .mutation(
          api.storageLayouts.writes.createStorageBuilding,
          building(t.warehouses.bravoA, "B-2"),
        ),
      "WAREHOUSE_OUT_OF_SCOPE",
    );
    const rows = await t.t.run(
      async (ctx) => await ctx.db.query("storageBuildings").collect(),
    );
    expect(rows).toEqual([]);
  });

  it("denies a read-only role the manage permission, then allows the manager", async () => {
    const supervisor = await world("SUPERVISOR");
    denied(
      await supervisor.t
        .withIdentity(A)
        .mutation(
          api.storageLayouts.writes.createStorageBuilding,
          building(supervisor.warehouses.alphaA),
        ),
    );

    const admin = await world("ORG_ADMIN");
    const created = (await admin.t
      .withIdentity(A)
      .mutation(
        api.storageLayouts.writes.createStorageBuilding,
        building(admin.warehouses.alphaA),
      )) as { ok: boolean; value: { written: boolean; documentId: string } };
    expect(created).toMatchObject({ ok: true, value: { written: true } });

    // Read back through a registered query in the same tenant ...
    const read = (await admin.t
      .withIdentity(A)
      .query(api.storageLayouts.catalogue.getStorageBuilding, {
        warehouseId: admin.warehouses.alphaA,
        buildingId: created.value.documentId,
      } as never)) as { ok: boolean; value: { found: boolean } };
    expect(read).toMatchObject({ ok: true, value: { found: true } });

    // ... and prove the other tenant's identity cannot see it.
    await contextDenied(
      admin.t
        .withIdentity(B)
        .query(api.storageLayouts.catalogue.getStorageBuilding, {
          warehouseId: admin.warehouses.alphaA,
          buildingId: created.value.documentId,
        } as never),
      "WAREHOUSE_UNKNOWN",
    );
  });
});
