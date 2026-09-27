import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import {
  queryWithOrg,
  mutationWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { fingerprintArguments } from "../lib/idempotency";
import { appendDomainAudit } from "../lib/masterDataStore";
import {
  pdApprovedPlan,
  PD_REVISION,
} from "../model/storageLayout/pdApprovedPlan";

const targetArgs = {
  warehouseId: v.id("warehouses"),
  buildingId: v.id("storageBuildings"),
};
type Target = { warehouseId: string; buildingId: string };
const ordered = <T extends { _id: string }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => a._id.localeCompare(b._id));
async function digest(value: unknown) {
  const result = await fingerprintArguments(value);
  if (!result.ok) throw new Error("PD_INVALID_SNAPSHOT");
  return result.value;
}
async function snapshot(ctx: TenantFunctionContext, args: Target) {
  if (
    ctx.tenant.organization.clerkOrganizationId !==
    "org_3Je6JpUXsjAZcHyLD5lodjFdLmQ"
  )
    throw new Error("PD_WRONG_ORGANIZATION");
  const db = ctx.tenantDb;
  const warehouse = await db.getX<Doc<"warehouses">>(
    "warehouses",
    args.warehouseId,
  );
  if (warehouse.code !== "TG-OPT") throw new Error("PD_WRONG_WAREHOUSE");
  const warehouses = await db
    .byIndex<Doc<"warehouses">>("warehouses", "by_orgId_code", [
      { field: "code", value: "TG-OPT" },
    ])
    .all(2);
  if (warehouses.length !== 1 || warehouses[0]!._id !== args.warehouseId)
    throw new Error("PD_WAREHOUSE_NOT_UNIQUE");
  const matches = await db
    .byIndex<Doc<"storageBuildings">>(
      "storageBuildings",
      "by_orgId_warehouseId_code",
      [
        { field: "warehouseId", value: args.warehouseId },
        { field: "code", value: "PD" },
      ],
    )
    .all(2);
  if (matches.length !== 1 || matches[0]!._id !== args.buildingId)
    throw new Error("PD_BUILDING_NOT_UNIQUE");
  const building = matches[0]!;
  const floors = ordered(
    await db
      .byIndex<Doc<"storageFloors">>(
        "storageFloors",
        "by_orgId_buildingId_floorNumber",
        [{ field: "buildingId", value: args.buildingId }],
      )
      .all(50),
  );
  if (floors.length !== 1 || floors[0]!.floorNumber !== 1)
    throw new Error("PD_FLOOR_MISMATCH");
  const blocks = ordered(
    await db
      .byIndex<Doc<"storageFloorReservedBlocks">>(
        "storageFloorReservedBlocks",
        "by_orgId_floorId",
        [{ field: "floorId", value: floors[0]!._id }],
      )
      .all(100),
  );
  const zones = ordered(
    await db
      .byIndex<Doc<"storageZones">>(
        "storageZones",
        "by_orgId_floorId_status_code",
        [{ field: "floorId", value: floors[0]!._id }],
      )
      .all(500),
  );
  const expected = new Set(pdApprovedPlan().cells.map((c) => c.code));
  if (
    zones.length !== 198 ||
    new Set(zones.map((z) => z.code)).size !== 198 ||
    zones.some(
      (z) =>
        !expected.has(z.code) ||
        z.status !== "ACTIVE" ||
        z.warehouseId !== warehouse._id ||
        z.buildingId !== building._id ||
        (z.mode ?? "SIMPLE") !== "SIMPLE",
    )
  )
    throw new Error("PD_CODE_SET_MISMATCH");
  const positions = ordered(
    (
      await Promise.all(
        zones.map((z) =>
          db
            .byIndex<Doc<"storagePositions">>(
              "storagePositions",
              "by_orgId_zoneId_status_code",
              [{ field: "zoneId", value: z._id }],
            )
            .all(100),
        ),
      )
    ).flat(),
  );
  const locationIds = [
    ...new Set([
      ...zones.map((z) => z.locationId),
      ...positions.map((p) => p.locationId),
    ]),
  ];
  const locations = ordered(
    await Promise.all(
      locationIds.map((id) => db.getX<Doc<"locations">>("locations", id)),
    ),
  );
  if (
    positions.some((p) => !p.isDefault || p.status !== "ACTIVE") ||
    positions.length !== 198 ||
    zones.some(
      (z) =>
        positions.filter(
          (p) =>
            p.zoneId === z._id &&
            p.locationId === z.locationId &&
            p.code === z.code,
        ).length !== 1,
    )
  )
    throw new Error("PD_POSITION_SET_MISMATCH");
  if (
    locations.length !== 198 ||
    zones.some(
      (z) =>
        !locations.some(
          (l) =>
            l._id === z.locationId &&
            l.code === z.code &&
            l.warehouseId === warehouse._id,
        ),
    )
  )
    throw new Error("PD_LOCATION_SET_MISMATCH");
  // Include released placement/history references: changes invalidate rollback too.
  const placements = ordered(
    (
      await db
        .byIndex<Doc<"finishedGoodsPlacements">>(
          "finishedGoodsPlacements",
          "by_orgId_warehouseId_positionCode",
          [{ field: "warehouseId", value: args.warehouseId }],
        )
        .all(10000)
    ).filter((p) => p.buildingId === building._id),
  );
  const placementIds = new Set(placements.map((p) => p._id));
  const moves = ordered(
    (
      await db
        .byIndex<Doc<"finishedGoodsMoves">>(
          "finishedGoodsMoves",
          "by_orgId_warehouseId_status",
          [{ field: "warehouseId", value: args.warehouseId }],
        )
        .all(10000)
    ).filter(
      (m) =>
        placementIds.has(m.sourcePlacementId) ||
        placementIds.has(m.targetPlacementId),
    ),
  );
  const assignments = ordered(
    (
      await db
        .byIndex<Doc<"finishedGoodsScanAssignments">>(
          "finishedGoodsScanAssignments",
          "by_orgId_warehouseId",
          [{ field: "warehouseId", value: args.warehouseId }],
        )
        .all(10000)
    ).filter((a) => a.buildingId === building._id),
  );
  const pallets = ordered(
    await Promise.all(
      [...new Set(placements.map((p) => p.palletId))].map((id) =>
        db.getX<Doc<"finishedGoodsPallets">>("finishedGoodsPallets", id),
      ),
    ),
  );
  return {
    warehouse,
    building,
    floors,
    blocks,
    zones,
    positions,
    locations,
    placements,
    moves,
    assignments,
    pallets,
  };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
function assertEmpty(s: Snapshot) {
  if (
    s.placements.some(
      (p) => p.status === "STORED" || p.status === "RESERVED",
    ) ||
    s.moves.some((m) => m.status === "RESERVED" || m.status === "IN_TRANSIT")
  )
    throw new Error("PD_OCCUPIED_OR_MOVING");
}
export const preflight = queryWithOrg({
  args: targetArgs,
  returns: v.any(),
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageBuildings", id: (a) => a.buildingId },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const backup = await snapshot(ctx, args);
    const blocked =
      backup.placements.some((p) => p.status !== "RELEASED") ||
      backup.moves.some(
        (m) => m.status === "RESERVED" || m.status === "IN_TRANSIT",
      );
    return {
      revision: PD_REVISION,
      blocked,
      digest: await digest(backup),
      backup,
      plan: pdApprovedPlan(),
    };
  },
});
export const apply = mutationWithOrg({
  args: {
    ...targetArgs,
    revision: v.literal(PD_REVISION),
    expectedDigest: v.string(),
  },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageBuildings", id: (a) => a.buildingId },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const before = await snapshot(ctx, args);
    if (before.building.pdImport?.revision === args.revision)
      throw new Error("PD_ALREADY_IMPORTED");
    assertEmpty(before);
    if ((await digest(before)) !== args.expectedDigest)
      throw new Error("PD_VERSION_CONFLICT");
    const plan = pdApprovedPlan(),
      now = Date.now(),
      userId = ctx.tenant.actor._id;
    const db = ctx.tenantDb,
      floor = before.floors[0]!;
    const fields = {
      widthMm: plan.widthMm,
      depthMm: plan.depthMm,
      grossAreaSqMm: plan.grossAreaSqMm,
      reservedAreaSqMm: plan.reservedAreaSqMm,
      usableAreaSqMm: plan.usableAreaSqMm,
      updatedAt: now,
      updatedByUserId: userId,
    };
    await db.patch("storageBuildings", before.building._id, {
      ...fields,
      version: before.building.version + 1,
      pdImport: {
        revision: args.revision,
        beforeDigest: args.expectedDigest,
        importedAt: now,
      },
    });
    await db.patch("storageFloors", floor._id, {
      ...fields,
      offsetXMm: 0,
      offsetYMm: 0,
      version: floor.version + 1,
    });
    for (const cell of plan.cells) {
      const zone = before.zones.find((z) => z.code === cell.code)!;
      const { code: _code, ...rectangle } = cell;
      void _code;
      await db.patch("storageZones", zone._id, {
        ...rectangle,
        updatedAt: now,
        updatedByUserId: userId,
      });
      const position = before.positions.find((p) => p.zoneId === zone._id)!;
      await db.patch("storagePositions", position._id, {
        xMm: cell.xMm,
        yMm: cell.yMm,
        widthMm: cell.widthMm,
        depthMm: cell.depthMm,
        updatedAt: now,
        updatedByUserId: userId,
      });
    }
    if (before.blocks.length > plan.blocks.length)
      throw new Error("PD_RESERVED_BLOCK_COUNT_UNEXPECTED");
    for (const [i, block] of plan.blocks.entries()) {
      const previous = before.blocks[i];
      if (previous)
        await db.patch("storageFloorReservedBlocks", previous._id, {
          ...block,
          updatedAt: now,
        });
      else
        await db.insert("storageFloorReservedBlocks", {
          ...block,
          buildingId: before.building._id,
          floorId: floor._id,
          warehouseId: before.warehouse._id,
          createdAt: now,
          updatedAt: now,
        });
    }
    const after = await snapshot(ctx, args);
    await appendDomainAudit(
      {
        tenantDb: db,
        table: "storageBuildings",
        operation: "storageLayout.pdImport",
        requestId: ctx.requestId,
        permissionCode: "masterData.storageLayout.manage",
        actorUserId: userId,
        warehouseId: args.warehouseId,
        now,
      },
      {
        entityTable: "storageBuildings",
        entityId: args.buildingId,
        changes: [
          { field: "pdImport.revision", to: args.revision },
          {
            field: "snapshotDigest",
            from: args.expectedDigest,
            to: await digest(after),
          },
        ],
      },
    );
    return {
      revision: args.revision,
      beforeDigest: args.expectedDigest,
      afterDigest: await digest(after),
      counts: {
        zones: after.zones.length,
        positions: after.positions.length,
        locations: after.locations.length,
      },
    };
  },
});

/** Restores only an authentic pre-import snapshot and refuses any later activity. */
export const rollback = mutationWithOrg({
  args: { ...targetArgs, expectedAfterDigest: v.string(), backup: v.any() },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageBuildings", id: (a) => a.buildingId },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const current = await snapshot(ctx, args);
    assertEmpty(current);
    if (
      !current.building.pdImport ||
      (await digest(current)) !== args.expectedAfterDigest
    )
      throw new Error("PD_ROLLBACK_CONFLICT");
    if ((await digest(args.backup)) !== current.building.pdImport.beforeDigest)
      throw new Error("PD_BACKUP_MISMATCH");
    const backup = args.backup as Snapshot;
    // Backup authenticity was bound to this building inside the import transaction.
    if (
      backup.building._id !== current.building._id ||
      backup.warehouse._id !== current.warehouse._id
    )
      throw new Error("PD_BACKUP_TARGET_MISMATCH");
    const restore = async (
      table:
        | "storageBuildings"
        | "storageFloors"
        | "storageZones"
        | "storagePositions"
        | "storageFloorReservedBlocks",
      rows: readonly { _id: string; _creationTime: number; orgId: string }[],
    ) => {
      for (const row of rows) {
        const { _id, _creationTime, orgId, ...fields } = row;
        void _creationTime;
        void orgId;
        await ctx.tenantDb.replace(table, _id, fields);
      }
    };
    await restore("storageBuildings", [backup.building]);
    await restore("storageFloors", backup.floors);
    await restore("storageZones", backup.zones);
    await restore("storagePositions", backup.positions);
    await restore("storageFloorReservedBlocks", backup.blocks);
    const oldBlockIds = new Set(backup.blocks.map((b) => b._id));
    for (const block of current.blocks)
      if (!oldBlockIds.has(block._id))
        await ctx.tenantDb.delete("storageFloorReservedBlocks", block._id);
    await appendDomainAudit(
      {
        tenantDb: ctx.tenantDb,
        table: "storageBuildings",
        operation: "storageLayout.pdRollback",
        requestId: ctx.requestId,
        permissionCode: "masterData.storageLayout.manage",
        actorUserId: ctx.tenant.actor._id,
        warehouseId: args.warehouseId,
        now: Date.now(),
      },
      {
        entityTable: "storageBuildings",
        entityId: args.buildingId,
        changes: [
          {
            field: "pdImport.revision",
            from: current.building.pdImport.revision,
          },
        ],
      },
    );
    return { restored: true, digest: await digest(await snapshot(ctx, args)) };
  },
});
