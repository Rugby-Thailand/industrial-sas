import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

/**
 * The explicit-result pilot (layout readiness query, zone archive command).
 * Other storage tests call `_handler` directly, which skips the registered
 * result validator; these calls go through the registered functions, so a
 * result with an unexpected field or type fails here.
 */
const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };

async function world() {
  const w = await createConvexTenantWorld({
    "../convex/storageLayouts/writes.ts": () =>
      import("../../convex/storageLayouts/writes"),
    "../convex/storageLayouts/zones.ts": () =>
      import("../../convex/storageLayouts/zones"),
  });
  await seedConvexAuthorization(w, { roleA: "ORG_ADMIN" });
  const client = w.t.withIdentity(identity);
  const warehouseId = w.warehouses.alphaA;
  const created = await client.mutation(
    api.storageLayouts.writes.createStorageBuilding,
    {
      warehouseId,
      requestId: "explicit-building",
      code: "EXP",
      name: "Explicit",
      widthMm: 20_000,
      depthMm: 12_000,
      defaultFloorHeightMm: 4_000,
      floorCount: 1,
    },
  );
  if (!created.ok || !created.value.written) throw new Error("setup");
  const buildingId = created.value.documentId as Id<"storageBuildings">;
  return { w, client, warehouseId, buildingId };
}

describe("explicit storage results", () => {
  it("validates layout readiness through the registered query", async () => {
    const { client, warehouseId, buildingId } = await world();
    const empty = await client.query(
      api.storageLayouts.writes.layoutReadiness,
      { warehouseId, buildingId },
    );
    expect(empty).toMatchObject({
      ok: true,
      value: {
        found: true,
        status: "DRAFT",
        zoneCount: 0,
        ready: false,
        issues: expect.arrayContaining([
          { code: "STORAGE_STACK_REQUIRED", blocking: true },
          { code: "FLOOR_HAS_NO_STORAGE", blocking: false, floorNumber: 1 },
        ]),
      },
    });
    await client.mutation(api.storageLayouts.zones.createStorageZone, {
      warehouseId,
      buildingId,
      floorNumber: 1,
      requestId: "explicit-zone",
      label: "Area",
      xMm: 0,
      yMm: 0,
      widthMm: 2_000,
      depthMm: 2_000,
      maxStackHeightMm: 3_000,
    });
    const ready = await client.query(
      api.storageLayouts.writes.layoutReadiness,
      { warehouseId, buildingId },
    );
    expect(ready).toMatchObject({
      ok: true,
      value: { found: true, zoneCount: 1, ready: true, issues: [] },
    });
  });

  it("validates archive receipts, replays and refusals through the registered command", async () => {
    const { w, client, warehouseId, buildingId } = await world();
    const zone = async (requestId: string, xMm: number) => {
      const outcome = await client.mutation(
        api.storageLayouts.zones.createStorageZone,
        {
          warehouseId,
          buildingId,
          floorNumber: 1,
          requestId,
          label: requestId,
          xMm,
          yMm: 0,
          widthMm: 2_000,
          depthMm: 2_000,
          maxStackHeightMm: 3_000,
        },
      );
      if (!outcome.ok || !outcome.value.written) throw new Error("zone");
      return outcome.value.documentId as Id<"storageZones">;
    };
    const kept = await zone("explicit-a", 0);
    const removed = await zone("explicit-b", 3_000);
    const args = { warehouseId, zoneId: kept, requestId: "explicit-archive" };
    const archive = api.storageLayouts.zones.archiveStorageZone;
    expect(await client.mutation(archive, args)).toMatchObject({
      ok: true,
      value: { written: true, documentId: kept, replayed: false },
    });
    expect(await client.mutation(archive, args)).toMatchObject({
      ok: true,
      value: { written: true, documentId: kept, replayed: true },
    });
    await w.t.run((ctx) => ctx.db.delete(removed));
    expect(
      await client.mutation(archive, {
        warehouseId,
        zoneId: removed,
        requestId: "explicit-missing",
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "NOT_FOUND" } },
    });
  });
});
