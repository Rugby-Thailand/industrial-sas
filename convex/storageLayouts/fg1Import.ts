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
  fg1ApprovedPlan,
  fg1PreviousPlan,
  FG1_PREVIOUS_REVISION,
  FG1_REVISION,
} from "../model/storageLayout/fg1ApprovedPlan";

const targetArgs = {
  warehouseId: v.id("warehouses"),
  buildingId: v.id("storageBuildings"),
};
type Target = { warehouseId: string; buildingId: string };
const ordered = <T extends { _id: string }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => a._id.localeCompare(b._id));
async function digest(value: unknown) {
  const result = await fingerprintArguments(value);
  if (!result.ok) throw new Error("FG1_INVALID_SNAPSHOT");
  return result.value;
}
async function snapshot(ctx: TenantFunctionContext, args: Target) {
  if (
    ctx.tenant.organization.clerkOrganizationId !==
    "org_3Je6JpUXsjAZcHyLD5lodjFdLmQ"
  )
    throw new Error("FG1_WRONG_ORGANIZATION");
  const db = ctx.tenantDb;
  const warehouse = await db.getX<Doc<"warehouses">>(
    "warehouses",
    args.warehouseId,
  );
  if (warehouse.code !== "TG-OPT") throw new Error("FG1_WRONG_WAREHOUSE");
  const warehouses = await db
    .byIndex<Doc<"warehouses">>("warehouses", "by_orgId_code", [
      { field: "code", value: "TG-OPT" },
    ])
    .all(2);
  if (warehouses.length !== 1 || warehouses[0]!._id !== args.warehouseId)
    throw new Error("FG1_WAREHOUSE_NOT_UNIQUE");
  const matches = await db
    .byIndex<Doc<"storageBuildings">>(
      "storageBuildings",
      "by_orgId_warehouseId_code",
      [
        { field: "warehouseId", value: args.warehouseId },
        { field: "code", value: "FG1" },
      ],
    )
    .all(2);
  if (matches.length !== 1 || matches[0]!._id !== args.buildingId)
    throw new Error("FG1_BUILDING_NOT_UNIQUE");
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
    throw new Error("FG1_FLOOR_MISMATCH");
  const blocks = ordered(
    await db
      .byIndex<Doc<"storageFloorReservedBlocks">>(
        "storageFloorReservedBlocks",
        "by_orgId_floorId",
        [{ field: "floorId", value: floors[0]!._id }],
      )
      .all(100),
  );
  const allZones = ordered(
    await db
      .byIndex<Doc<"storageZones">>(
        "storageZones",
        "by_orgId_floorId_status_code",
        [{ field: "floorId", value: floors[0]!._id }],
      )
      .all(500),
  );
  const zones = allZones.filter((z) => z.status === "ACTIVE");
  const legacyZones = allZones.filter((z) => z.status !== "ACTIVE");
  if (legacyZones.length !== 0)
    throw new Error("FG1_UNEXPECTED_INACTIVE_ZONES");
  const expected = new Set(fg1ApprovedPlan().cells.map((c) => c.code));
  if (
    zones.length !== 15 ||
    new Set(zones.map((z) => z.code)).size !== 15 ||
    zones.some(
      (z) =>
        !expected.has(z.code) ||
        z.status !== "ACTIVE" ||
        z.warehouseId !== warehouse._id ||
        z.buildingId !== building._id ||
        (z.mode ?? "SIMPLE") !== "SIMPLE",
    )
  ) {
    console.error("FG1_CODE_SET_COUNTS", {
      total: zones.length,
      unique: new Set(zones.map((z) => z.code)).size,
      unexpectedCodes: zones.filter((z) => !expected.has(z.code)).length,
      inactive: zones.filter((z) => z.status !== "ACTIVE").length,
      wrongWarehouse: zones.filter((z) => z.warehouseId !== warehouse._id)
        .length,
      wrongBuilding: zones.filter((z) => z.buildingId !== building._id).length,
      nonSimple: zones.filter((z) => (z.mode ?? "SIMPLE") !== "SIMPLE").length,
    });
    throw new Error("FG1_CODE_SET_MISMATCH");
  }
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
  // User-approved inactive groups are backed up and fingerprinted, never patched.
  const legacyPositions = ordered(
    (
      await Promise.all(
        legacyZones.map((z) =>
          db
            .byIndex<Doc<"storagePositions">>(
              "storagePositions",
              "by_orgId_zoneId_status_code",
              [{ field: "zoneId", value: z._id }],
            )
            .all(500),
        ),
      )
    ).flat(),
  );
  if (
    legacyPositions.some(
      (p) =>
        p.status === "ACTIVE" ||
        p.warehouseId !== warehouse._id ||
        p.buildingId !== building._id,
    )
  )
    throw new Error("FG1_LEGACY_POSITION_MISMATCH");
  const legacyLocations = ordered(
    await Promise.all(
      [
        ...new Set([
          ...legacyZones.map((z) => z.locationId),
          ...legacyPositions.map((p) => p.locationId),
        ]),
      ].map((id) => db.getX<Doc<"locations">>("locations", id)),
    ),
  );
  if (legacyLocations.some((l) => l.warehouseId !== warehouse._id))
    throw new Error("FG1_LEGACY_LOCATION_MISMATCH");
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
    positions.some(
      (p) =>
        !p.isDefault ||
        p.status !== "ACTIVE" ||
        p.buildingId !== building._id ||
        p.warehouseId !== warehouse._id ||
        p.floorId !== floors[0]!._id,
    ) ||
    positions.length !== 15 ||
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
    throw new Error("FG1_POSITION_SET_MISMATCH");
  if (
    locations.length !== 15 ||
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
    throw new Error("FG1_LOCATION_SET_MISMATCH");
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
  const zoneIds = new Set(allZones.map((z) => z._id));
  const positionIds = new Set(
    [...positions, ...legacyPositions].map((p) => p._id),
  );
  const codes = new Set(allZones.map((z) => z.code));
  const jobScans = ordered(
    (
      await db
        .byIndex<Doc<"finishedGoodsJobScans">>(
          "finishedGoodsJobScans",
          "by_orgId_warehouseId_createdAt",
          [{ field: "warehouseId", value: args.warehouseId }],
        )
        .all(10000)
    ).filter(
      (s) =>
        (s.zoneId && zoneIds.has(s.zoneId)) ||
        (s.supportPositionId && positionIds.has(s.supportPositionId)) ||
        (s.locationCode && codes.has(s.locationCode)),
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
    legacyZones,
    legacyPositions,
    legacyLocations,
    placements,
    moves,
    assignments,
    pallets,
    jobScans,
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
    throw new Error("FG1_OCCUPIED_OR_MOVING");
}
export const preflight = queryWithOrg({
  args: targetArgs,
  returns: v.any(),
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageBuildings", id: (a) => a.buildingId },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    let backup: Snapshot;
    try {
      backup = await snapshot(ctx, args);
    } catch (error) {
      // Fixed diagnostic codes only: never log records, credentials, or raw errors.
      const code =
        error instanceof Error && /^FG1_[A-Z_]+$/.test(error.message)
          ? error.message
          : "FG1_SNAPSHOT_READ_FAILED";
      console.error(code);
      throw error;
    }
    const blocked =
      backup.placements.some((p) => p.status !== "RELEASED") ||
      backup.moves.some(
        (m) => m.status === "RESERVED" || m.status === "IN_TRANSIT",
      );
    let snapshotDigest: string;
    try {
      snapshotDigest = await digest(backup);
    } catch (error) {
      console.error("FG1_SNAPSHOT_DIGEST_FAILED");
      throw error;
    }
    return {
      revision: FG1_REVISION,
      blocked,
      digest: snapshotDigest,
      backup,
      plan: fg1ApprovedPlan(),
    };
  },
});
export const apply = mutationWithOrg({
  args: {
    ...targetArgs,
    revision: v.literal(FG1_REVISION),
    expectedDigest: v.string(),
  },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageBuildings", id: (a) => a.buildingId },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const before = await snapshot(ctx, args);
    if (before.building.fg1Import?.revision === args.revision)
      throw new Error("FG1_ALREADY_IMPORTED");
    assertEmpty(before);
    if ((await digest(before)) !== args.expectedDigest)
      throw new Error("FG1_VERSION_CONFLICT");
    const plan = fg1ApprovedPlan(),
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
      fg1Import: {
        revision: args.revision,
        beforeDigest: args.expectedDigest,
        importedAt: now,
        coordinateBasis: "APPROVED_LAYOUT_ENVELOPE",
        rightAisleWidthEstimated: true,
        obstaclePositionEstimated: true,
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
      throw new Error("FG1_RESERVED_BLOCK_COUNT_UNEXPECTED");
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
        operation: "storageLayout.fg1Import",
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
          { field: "fg1Import.revision", to: args.revision },
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

const blockShape = (block: {
  label: string;
  areaKind?: string;
  color?: string;
  displayHeightMm?: number;
  xMm: number;
  yMm: number;
  widthMm: number;
  depthMm: number;
}) =>
  JSON.stringify([
    block.label,
    block.areaKind,
    block.color,
    block.displayHeightMm,
    block.xMm,
    block.yMm,
    block.widthMm,
    block.depthMm,
  ]);

/** Converts only the confirmed FG1 rear aisle to a non-walkable edge. */
export const correctRearAisle = mutationWithOrg({
  args: {
    ...targetArgs,
    revision: v.literal(FG1_REVISION),
    expectedDigest: v.string(),
  },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageBuildings", id: (a) => a.buildingId },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const before = await snapshot(ctx, args);
    if (before.building.fg1Import?.revision !== FG1_PREVIOUS_REVISION)
      throw new Error("FG1_REAR_AISLE_REVISION_MISMATCH");
    if (
      before.placements.length ||
      before.moves.length ||
      before.assignments.length ||
      before.jobScans.length
    )
      throw new Error("FG1_REAR_AISLE_OCCUPIED_OR_ACTIVE");
    if ((await digest(before)) !== args.expectedDigest)
      throw new Error("FG1_VERSION_CONFLICT");

    const previous = fg1PreviousPlan();
    const plan = fg1ApprovedPlan();
    if (
      before.building.widthMm !== previous.widthMm ||
      before.building.depthMm !== previous.depthMm ||
      before.building.reservedAreaSqMm !== previous.reservedAreaSqMm ||
      before.building.usableAreaSqMm !== previous.usableAreaSqMm ||
      before.floors[0]!.reservedAreaSqMm !== previous.reservedAreaSqMm ||
      before.floors[0]!.usableAreaSqMm !== previous.usableAreaSqMm ||
      before.blocks.length !== previous.blocks.length ||
      previous.blocks.some(
        (expected) =>
          before.blocks.filter(
            (actual) => blockShape(actual) === blockShape(expected),
          ).length !== 1,
      ) ||
      previous.cells.some((expected) => {
        const zone = before.zones.find((z) => z.code === expected.code);
        const position = before.positions.find((p) => p.zoneId === zone?._id);
        return (
          !zone ||
          !position ||
          [zone, position].some(
            (row) =>
              row.xMm !== expected.xMm ||
              row.yMm !== expected.yMm ||
              row.widthMm !== expected.widthMm ||
              row.depthMm !== expected.depthMm,
          )
        );
      })
    )
      throw new Error("FG1_REAR_AISLE_SOURCE_MISMATCH");
    if (plan.reservedAreaSqMm !== previous.reservedAreaSqMm)
      throw new Error("FG1_REAR_AISLE_AREA_MISMATCH");

    const now = Date.now();
    const db = ctx.tenantDb;
    const seen = new Set<string>();
    let inserted = 0;
    let updated = 0;
    for (const block of plan.blocks) {
      const oldLabel = block.label.match(/^ขอบหลัง (FG1-R\d+) ·/)?.[1];
      const previousBlock = before.blocks.find(
        (row) =>
          row.label ===
          (oldLabel ? `ทางเดินริมขวา ${oldLabel} · ขนาดประมาณ` : block.label),
      );
      if (previousBlock) {
        if (seen.has(previousBlock._id))
          throw new Error("FG1_REAR_AISLE_DUPLICATE_BLOCK");
        seen.add(previousBlock._id);
        if (blockShape(previousBlock) !== blockShape(block)) {
          await db.patch("storageFloorReservedBlocks", previousBlock._id, {
            ...block,
            updatedAt: now,
          });
          updated++;
        }
      } else if (block.label.startsWith("ขอบหลังระหว่าง ")) {
        await db.insert("storageFloorReservedBlocks", {
          ...block,
          buildingId: before.building._id,
          floorId: before.floors[0]!._id,
          warehouseId: before.warehouse._id,
          createdAt: now,
          updatedAt: now,
        });
        inserted++;
      } else {
        throw new Error("FG1_REAR_AISLE_BLOCK_MISSING");
      }
    }
    if (seen.size !== before.blocks.length || updated !== 9 || inserted !== 4)
      throw new Error("FG1_REAR_AISLE_BLOCK_COUNT_MISMATCH");

    const fields = {
      reservedAreaSqMm: plan.reservedAreaSqMm,
      usableAreaSqMm: plan.usableAreaSqMm,
      updatedAt: now,
      updatedByUserId: ctx.tenant.actor._id,
    };
    await db.patch("storageBuildings", before.building._id, {
      ...fields,
      version: before.building.version + 1,
      fg1Import: {
        revision: FG1_REVISION,
        beforeDigest: args.expectedDigest,
        importedAt: now,
        coordinateBasis: "APPROVED_LAYOUT_ENVELOPE",
        rightAisleWidthEstimated: false,
        obstaclePositionEstimated:
          before.building.fg1Import.obstaclePositionEstimated,
      },
    });
    await db.patch("storageFloors", before.floors[0]!._id, {
      ...fields,
      version: before.floors[0]!.version + 1,
    });
    const after = await snapshot(ctx, args);
    if (
      after.blocks.length !== plan.blocks.length ||
      plan.blocks.some(
        (expected) =>
          after.blocks.filter(
            (actual) => blockShape(actual) === blockShape(expected),
          ).length !== 1,
      )
    )
      throw new Error("FG1_REAR_AISLE_RESULT_MISMATCH");
    const afterDigest = await digest(after);
    await appendDomainAudit(
      {
        tenantDb: db,
        table: "storageBuildings",
        operation: "storageLayout.fg1RearAisleCorrection",
        requestId: ctx.requestId,
        permissionCode: "masterData.storageLayout.manage",
        actorUserId: ctx.tenant.actor._id,
        warehouseId: args.warehouseId,
        now,
      },
      {
        entityTable: "storageBuildings",
        entityId: args.buildingId,
        changes: [
          {
            field: "fg1Import.revision",
            from: FG1_PREVIOUS_REVISION,
            to: FG1_REVISION,
          },
          {
            field: "snapshotDigest",
            from: args.expectedDigest,
            to: afterDigest,
          },
        ],
      },
    );
    return {
      revision: FG1_REVISION,
      beforeDigest: args.expectedDigest,
      afterDigest,
      counts: { updated, inserted, blocks: after.blocks.length },
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
      !current.building.fg1Import ||
      (await digest(current)) !== args.expectedAfterDigest
    )
      throw new Error("FG1_ROLLBACK_CONFLICT");
    if ((await digest(args.backup)) !== current.building.fg1Import.beforeDigest)
      throw new Error("FG1_BACKUP_MISMATCH");
    const backup = args.backup as Snapshot;
    // Backup authenticity was bound to this building inside the import transaction.
    if (
      backup.building._id !== current.building._id ||
      backup.warehouse._id !== current.warehouse._id
    )
      throw new Error("FG1_BACKUP_TARGET_MISMATCH");
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
        operation: "storageLayout.fg1Rollback",
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
            field: "fg1Import.revision",
            from: current.building.fg1Import.revision,
          },
        ],
      },
    );
    return { restored: true, digest: await digest(await snapshot(ctx, args)) };
  },
});
