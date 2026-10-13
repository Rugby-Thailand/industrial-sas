import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import {
  createMasterDataRow,
  normalizeDisplayName,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
} from "../lib/masterDataStore";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { refusal, writeContextOf } from "../lib/writeEnvelope";
import { STORAGE_LAYOUT_LIMITS } from "../model/storageLayout/storageLayout";
import {
  makeStorageZoneQrValue,
  STORAGE_ZONE_LIMITS,
  validateStorageZone,
} from "../model/storageLayout/storageZone";
import { ensureDefaultPosition } from "./zones";

/**
 * "Complete layout" for a location registered by name with layout later.
 *
 * The registration keeps its location row: the same id, code, label and QR
 * (`ISAS:LOCATION:1:<locationId>`), so every job record and printed label that
 * references it keeps resolving. Only measured geometry the manager enters is
 * added; nothing is inferred and no stock is created.
 */
const OPERATION = "storageLayout.namedLocation.completeLayout";
const failure = (code: string, field?: string) => refusal({ code, field });

type LocationDocument = Doc<"locations">;
type BuildingDocument = Doc<"storageBuildings">;
type FloorDocument = Doc<"storageFloors">;
type ZoneDocument = Doc<"storageZones">;

async function namedLocation(
  ctx: TenantFunctionContext,
  warehouseId: string,
  locationId: string,
) {
  const location = await ctx.tenantDb.get<LocationDocument>(
    "locations",
    locationId,
  );
  if (location === null || location.warehouseId !== warehouseId) return null;
  return location;
}

export const namedLocationLayoutTarget = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), locationId: v.id("locations") },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "locations", id: ({ locationId }) => locationId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const location = await namedLocation(
      ctx,
      args.warehouseId,
      args.locationId,
    );
    if (location === null) return { found: false as const };
    const building = location.buildingId
      ? await ctx.tenantDb.get<BuildingDocument>(
          "storageBuildings",
          location.buildingId,
        )
      : null;
    const floor = location.floorId
      ? await ctx.tenantDb.get<FloorDocument>("storageFloors", location.floorId)
      : null;
    return {
      found: true as const,
      locationId: location._id,
      code: location.code,
      label: location.label ?? location.code,
      version: location.version ?? 1,
      layoutPending:
        location.locationType === "NAMED_STORAGE" &&
        location.status === "ACTIVE",
      ...(building && building.warehouseId === args.warehouseId
        ? {
            buildingId: building._id,
            buildingCode: building.code,
            buildingName: building.name,
            buildingStatus: building.status,
          }
        : {}),
      ...(floor ? { floorNumber: floor.floorNumber } : {}),
    };
  },
});

export const completeNamedLocationLayout = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    locationId: v.id("locations"),
    buildingId: v.id("storageBuildings"),
    requestId: v.string(),
    expectedVersion: v.number(),
    floorNumber: v.number(),
    xMm: v.number(),
    yMm: v.number(),
    widthMm: v.number(),
    depthMm: v.number(),
    maxStackHeightMm: v.number(),
    storageCondition: v.optional(v.string()),
  },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "storageBuildings", id: ({ buildingId }) => buildingId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    // Each record keeps its own idempotency operation: one request id spans
    // the new spot and the converted location row.
    const context = (table: "storageZones" | "locations") =>
      writeContextOf(ctx, {
        table,
        operation: table === "locations" ? `${OPERATION}.location` : OPERATION,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      });
    const replay = await replayTenantWriteIfPresent({
      ...context("storageZones"),
      fingerprint: args,
    });
    if (!replay.ok) return failure(replay.error.code);
    if (replay.value !== null) {
      const zone = await ctx.tenantDb.get<ZoneDocument>(
        "storageZones",
        replay.value.documentId,
      );
      return {
        written: true as const,
        documentId: replay.value.documentId,
        replayed: true,
        ...(zone ? { code: zone.code, qrValue: zone.qrValue } : {}),
      };
    }
    const location = await namedLocation(
      ctx,
      args.warehouseId,
      args.locationId,
    );
    if (location === null) return failure("NOT_FOUND");
    if (
      location.locationType !== "NAMED_STORAGE" ||
      location.status !== "ACTIVE"
    )
      return failure("LOCATION_ALREADY_MAPPED");
    if ((location.version ?? 1) !== args.expectedVersion)
      return failure("VERSION_CONFLICT");
    if (location.buildingId !== args.buildingId)
      return failure("REFERENCE_NOT_FOUND", "buildingId");
    const building = await ctx.tenantDb.get<BuildingDocument>(
      "storageBuildings",
      args.buildingId,
    );
    if (building === null || building.warehouseId !== args.warehouseId)
      return failure("REFERENCE_NOT_FOUND", "buildingId");
    if (building.status === "ARCHIVED") return failure("LAYOUT_NOT_EDITABLE");
    const floor = await ctx.tenantDb
      .byIndex<FloorDocument>(
        "storageFloors",
        "by_orgId_buildingId_floorNumber",
        [
          { field: "buildingId", value: building._id },
          { field: "floorNumber", value: args.floorNumber },
        ],
      )
      .unique();
    if (floor === null || floor.warehouseId !== args.warehouseId)
      return failure("REFERENCE_NOT_FOUND", "floorNumber");
    // Job tickets retain the registered floor in their historical projection.
    // Completing geometry may choose a floor only when none was registered.
    if (location.floorId !== undefined && location.floorId !== floor._id)
      return failure("NAMED_LOCATION_FLOOR_CONFLICT", "floorNumber");
    const label = normalizeDisplayName(
      "label",
      location.label ?? location.code,
    );
    if (!label.ok) return failure(label.error.code, "label");
    const storageCondition = (args.storageCondition ?? "").trim() || undefined;
    if ((storageCondition?.length ?? 0) > 100)
      return failure("TEXT_TOO_LONG", "storageCondition");
    const [reserved, zones] = await Promise.all([
      ctx.tenantDb
        .byIndex<Doc<"storageFloorReservedBlocks">>(
          "storageFloorReservedBlocks",
          "by_orgId_floorId",
          [{ field: "floorId", value: floor._id }],
        )
        .all(STORAGE_LAYOUT_LIMITS.maximumReservedBlocksPerFloor),
      ctx.tenantDb
        .byIndex<ZoneDocument>("storageZones", "by_orgId_floorId_status_code", [
          { field: "floorId", value: floor._id },
          { field: "status", value: "ACTIVE" },
        ])
        .all(STORAGE_ZONE_LIMITS.maximumZonesPerFloor),
    ]);
    if (zones.length >= STORAGE_ZONE_LIMITS.maximumZonesPerFloor)
      return failure("ZONE_LIMIT_EXCEEDED");
    const candidate = {
      xMm: args.xMm,
      yMm: args.yMm,
      widthMm: args.widthMm,
      depthMm: args.depthMm,
      maxStackHeightMm: args.maxStackHeightMm,
    };
    const valid = validateStorageZone({
      floorWidthMm: floor.widthMm ?? building.widthMm,
      floorDepthMm: floor.depthMm ?? building.depthMm,
      floorHeightMm: floor.heightMm ?? building.defaultFloorHeightMm,
      candidate,
      reserved,
      zones,
    });
    if (!valid.ok)
      return failure(
        valid.error.code,
        "field" in valid.error ? valid.error.field : undefined,
      );
    const qrValue = makeStorageZoneQrValue(location._id);
    const now = Date.now();
    const zone = await createMasterDataRow({
      ...context("storageZones"),
      fingerprint: args,
      uniqueness: [
        {
          field: "code",
          index: "by_orgId_warehouseId_code",
          equality: [
            { field: "warehouseId", value: args.warehouseId },
            { field: "code", value: location.code },
          ],
        },
        {
          field: "locationId",
          index: "by_orgId_locationId",
          equality: [{ field: "locationId", value: location._id }],
        },
        {
          field: "qrValue",
          index: "by_orgId_qrValue",
          equality: [{ field: "qrValue", value: qrValue }],
        },
      ],
      document: {
        buildingId: building._id,
        floorId: floor._id,
        warehouseId: args.warehouseId,
        locationId: location._id,
        code: location.code,
        label: label.value,
        qrValue,
        ...(storageCondition === undefined ? {} : { storageCondition }),
        mode: "SIMPLE",
        version: 1,
        ...candidate,
        status: "ACTIVE",
        createdAt: now,
        createdByUserId: ctx.tenant.actor._id,
        updatedAt: now,
        updatedByUserId: ctx.tenant.actor._id,
      },
    });
    if (!zone.ok) return failure(zone.error.code);
    const converted = await updateMasterDataRow({
      ...context("locations"),
      documentId: location._id,
      fingerprint: args,
      uniqueness: [],
      patch: {
        locationType: "FLOOR_BLOCK",
        floorId: floor._id,
        status: building.status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
        version: (location.version ?? 1) + 1,
        updatedAt: now,
        updatedByUserId: ctx.tenant.actor._id,
      },
    });
    if (!converted.ok)
      throw new Error(`NAMED_LAYOUT_FAILED:${converted.error.code}`);
    const createdZone = await ctx.tenantDb.get<ZoneDocument>(
      "storageZones",
      zone.value.documentId,
    );
    if (
      createdZone === null ||
      (await ensureDefaultPosition(ctx, createdZone, args.requestId)) === null
    )
      throw new Error("NAMED_LAYOUT_FAILED:DEFAULT_POSITION");
    return {
      written: true as const,
      documentId: zone.value.documentId,
      replayed: false,
      code: location.code,
      qrValue,
    };
  },
});
