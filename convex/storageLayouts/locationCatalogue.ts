import { summaryReadiness } from "../lib/finishedGoodsSummary";
import { isGeometricPlacement } from "../model/finishedGoods/scanning";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import {
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { occupiedFootprintAreaSqMm } from "../model/storageLayout/occupancy";
import {
  paginatedScan,
  remainingScanCapacity,
} from "../lib/cataloguePagination";

async function locationRow(
  ctx: TenantFunctionContext,
  zone: Doc<"storageZones">,
  includePositions = true,
) {
  const [building, floor, positions] = await Promise.all([
    ctx.tenantDb.get<Doc<"storageBuildings">>(
      "storageBuildings",
      zone.buildingId,
    ),
    ctx.tenantDb.get<Doc<"storageFloors">>("storageFloors", zone.floorId),
    includePositions
      ? ctx.tenantDb
          .byIndex<Doc<"storagePositions">>(
            "storagePositions",
            "by_orgId_zoneId_status_code",
            [{ field: "zoneId", value: zone._id }],
          )
          .all(10_000)
      : Promise.resolve([] as Doc<"storagePositions">[]),
  ]);
  if (
    !building ||
    !floor ||
    floor.buildingId !== building._id ||
    building.warehouseId !== zone.warehouseId
  )
    throw new Error("Storage location parent is missing");
  return {
    _id: zone._id,
    warehouseId: zone.warehouseId,
    zoneId: zone._id,
    label: zone.label,
    code: zone.code,
    qrValue: zone.qrValue,
    buildingId: building._id,
    buildingName: building.name,
    buildingCode: building.code,
    floorNumber: floor.floorNumber,
    status:
      zone.status === "INACTIVE" ? ("ARCHIVED" as const) : building.status,
    widthMm: zone.widthMm,
    depthMm: zone.depthMm,
    heightMm: zone.maxStackHeightMm,
    positions: positions
      .filter((p) => !p.isDefault)
      .map((p) => ({
        id: p._id,
        label: p.label,
        code: p.code,
        status: p.status,
        xMm: p.xMm,
        yMm: p.yMm,
        zMm: p.elevationMm ?? zone.baseElevationMm ?? 0,
      })),
  };
}
async function withOccupancy(
  ctx: TenantFunctionContext,
  row: NonNullable<Awaited<ReturnType<typeof locationRow>>>,
) {
  const placements = (
    await Promise.all(
      (["RESERVED", "STORED"] as const).map((status) =>
        ctx.tenantDb
          .byIndex<Doc<"finishedGoodsPlacements">>(
            "finishedGoodsPlacements",
            "by_orgId_zoneId_status",
            [
              { field: "zoneId", value: row.zoneId },
              { field: "status", value: status },
            ],
          )
          .all(10_000),
      ),
    )
  ).flat();
  const moveByPallet = new Map(
    await Promise.all(
      [...new Set(placements.map((p) => p.palletId))].map(async (palletId) => {
        const moves = await Promise.all(
          (["RESERVED", "IN_TRANSIT"] as const).map((status) =>
            ctx.tenantDb
              .byIndex<Doc<"finishedGoodsMoves">>(
                "finishedGoodsMoves",
                "by_orgId_palletId_status",
                [
                  { field: "palletId", value: palletId },
                  { field: "status", value: status },
                ],
              )
              .first(),
          ),
        );
        return [palletId, moves.find((m) => m !== null)] as const;
      }),
    ),
  );
  return {
    ...row,
    palletCount: new Set(placements.map((p) => p.palletId)).size,
    unmeasuredPalletCount: placements.filter((p) => !isGeometricPlacement(p))
      .length,
    measuredAreaPartial: placements.some((p) => !isGeometricPlacement(p)),
    occupiedFootprintAreaSqMm: occupiedFootprintAreaSqMm(
      placements.filter(isGeometricPlacement),
    ),
    placements: placements.map((p) => {
      if (!isGeometricPlacement(p))
        return {
          id: p._id,
          palletId: p.palletId,
          code: p.positionCode,
          status: p.status,
          mode: "LOCATION_ONLY" as const,
          assignmentId: p.assignmentId,
          sequence: p.sequence,
        };
      const move = moveByPallet.get(p.palletId);
      return {
        mode: "GEOMETRIC" as const,
        id: p._id,
        palletId: p.palletId,
        code: p.positionCode,
        xMm: p.xMm,
        yMm: p.yMm,
        zMm: p.zMm,
        status: p.status,
        rotation: p.rotation,
        ...(move
          ? {
              moveId: move._id,
              moveState: move.status as "RESERVED" | "IN_TRANSIT",
              moveRole:
                move.targetPlacementId === p._id
                  ? ("TARGET" as const)
                  : ("SOURCE" as const),
            }
          : {}),
      };
    }),
  };
}

type LocationSearchState = {
  ids: string[];
  next?: string;
  done: boolean;
  positionCursor?: string;
  tail?: string;
};
/** Search historical sublocations with bounded reads, retaining only the text boundary. */
async function searchLocationChunk(
  ctx: TenantFunctionContext,
  warehouseId: string,
  needle: string,
  raw?: string,
  end?: string,
) {
  const decode = (cursor?: string): LocationSearchState => {
    if (!cursor) return { ids: [], done: false };
    try {
      const state = JSON.parse(cursor) as LocationSearchState;
      if (
        !Array.isArray(state.ids) ||
        state.ids.length > 100 ||
        state.ids.some((id) => typeof id !== "string") ||
        typeof state.done !== "boolean" ||
        [state.next, state.positionCursor, state.tail].some(
          (value) => value !== undefined && typeof value !== "string",
        )
      )
        throw new Error();
      return state;
    } catch {
      throw new Error("InvalidCursor");
    }
  };
  let state = decode(raw);
  const boundary = end ? decode(end) : undefined;
  const encode = (value: LocationSearchState) => JSON.stringify(value);
  if (!state.ids.length) {
    const zones = await ctx.tenantDb
      .byIndex<Doc<"storageZones">>(
        "storageZones",
        "by_orgId_warehouseId_code",
        [{ field: "warehouseId", value: warehouseId }],
      )
      .page({
        limit: 1,
        ...(state.next ? { cursor: state.next } : {}),
        ...(boundary?.next ? { endCursor: boundary.next } : {}),
      });
    if (zones.pageStatus === "SplitRequired" && !zones.splitCursor)
      throw new Error("CATALOGUE_READ_CAPACITY_EXCEEDED");
    if (zones.pageStatus === "SplitRequired")
      return {
        ...zones,
        page: [] as Doc<"storageZones">[],
        splitCursor: encode({ ids: [], done: false, next: zones.splitCursor! }),
        continueCursor: encode({
          ids: [],
          done: false,
          next: zones.continueCursor,
        }),
      };
    state = {
      ids: zones.page.map((zone) => zone._id),
      next: zones.continueCursor,
      done: zones.isDone,
    };
    // Convex permits only one native pagination call per query. Inspect the
    // selected zone and its positions on the next bounded request.
    return {
      page: [] as Doc<"storageZones">[],
      isDone: state.done && !state.ids.length,
      continueCursor: encode(state),
    };
  }
  const id = state.ids[0];
  if (!id)
    return {
      page: [] as Doc<"storageZones">[],
      isDone: state.done,
      continueCursor: encode(state),
    };
  const zone = await ctx.tenantDb.get<Doc<"storageZones">>("storageZones", id);
  const after: LocationSearchState = {
    ids: state.ids.slice(1),
    done: state.done,
    ...(state.next ? { next: state.next } : {}),
  };
  const result = (matched: boolean) => ({
    page: matched && zone ? [zone] : [],
    isDone: after.done && !after.ids.length,
    continueCursor: encode(after),
  });
  if (!zone || zone.warehouseId !== warehouseId) return result(false);
  const row = await locationRow(ctx, zone, false);
  const heading =
    `${row.label} ${row.code} ${row.buildingName} ${row.buildingCode} `.toLocaleLowerCase();
  if (heading.includes(needle)) return result(true);
  const positions = await ctx.tenantDb
    .byIndex<Doc<"storagePositions">>(
      "storagePositions",
      "by_orgId_zoneId_status_code",
      [{ field: "zoneId", value: zone._id }],
    )
    .page({
      limit: 50,
      ...(state.positionCursor ? { cursor: state.positionCursor } : {}),
      ...(boundary?.positionCursor
        ? { endCursor: boundary.positionCursor }
        : {}),
    });
  if (positions.pageStatus === "SplitRequired" && !positions.splitCursor)
    throw new Error("CATALOGUE_READ_CAPACITY_EXCEEDED");
  if (positions.pageStatus === "SplitRequired")
    return {
      ...positions,
      page: [] as Doc<"storageZones">[],
      splitCursor: encode({ ...state, positionCursor: positions.splitCursor! }),
      continueCursor: encode({
        ...state,
        positionCursor: positions.continueCursor,
      }),
    };
  const text =
    (state.tail ?? heading) +
    positions.page
      .filter((p) => !p.isDefault)
      .map((p) => `${p.label} ${p.code} `)
      .join("")
      .toLocaleLowerCase();
  if (text.includes(needle)) return result(true);
  if (positions.isDone) return result(false);
  return {
    page: [] as Doc<"storageZones">[],
    isDone: false,
    continueCursor: encode({
      ...state,
      positionCursor: positions.continueCursor,
      tail: needle.length > 1 ? text.slice(1 - needle.length) : "",
    }),
  };
}

export const page = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    search: v.optional(v.string()),
    status: v.optional(v.string()),
    buildingId: v.optional(v.id("storageBuildings")),
    floorNumber: v.optional(v.number()),
    pageSize: v.number(),
    cursor: v.optional(v.string()),
    scanCursor: v.optional(v.string()),
  },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "storageZones" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const { cursor, scanCursor, pageSize, ...criteria } = args;
    const needle = (args.search ?? "").trim().toLocaleLowerCase();
    const result = await paginatedScan(ctx, {
      generation:
        (await summaryReadiness(ctx.tenantDb, args.warehouseId))?.generation ??
        0,
      scope: { entity: "locations", ...criteria },
      pageSize,
      ...(cursor ? { cursor } : {}),
      ...(scanCursor ? { scanCursor } : {}),
      read: (rawCursor, endCursor?: string) =>
        needle
          ? searchLocationChunk(
              ctx,
              args.warehouseId,
              needle,
              rawCursor,
              endCursor,
            )
          : ctx.tenantDb
              .byIndex<Doc<"storageZones">>(
                "storageZones",
                "by_orgId_warehouseId_code",
                [{ field: "warehouseId", value: args.warehouseId }],
              )
              .page({
                limit: Math.min(
                  20,
                  remainingScanCapacity(scanCursor, pageSize),
                ),
                ...(rawCursor ? { cursor: rawCursor } : {}),
                ...(endCursor ? { endCursor } : {}),
              }),
      get: (id) => ctx.tenantDb.get<Doc<"storageZones">>("storageZones", id),
      hydrate: (zone) => locationRow(ctx, zone, false),
      matches: (row) =>
        row.warehouseId === args.warehouseId &&
        (!args.status || row.status === args.status) &&
        (!args.buildingId || row.buildingId === args.buildingId) &&
        (args.floorNumber === undefined ||
          row.floorNumber === args.floorNumber),
    });
    return { ...result, page: result.page };
  },
});

export const detail = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), zoneId: v.id("storageZones") },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "storageZones" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const zone = await ctx.tenantDb.get<Doc<"storageZones">>(
      "storageZones",
      args.zoneId,
    );
    return zone?.warehouseId === args.warehouseId
      ? withOccupancy(ctx, await locationRow(ctx, zone))
      : null;
  },
});

/** Independent lightweight selector metadata; never derive choices from a page. */
export const options = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), cursor: v.optional(v.string()) },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "storageBuildings" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, { warehouseId, cursor }) => {
    const result = await paginatedScan(ctx, {
      generation:
        (await summaryReadiness(ctx.tenantDb, warehouseId))?.generation ?? 0,
      scope: { entity: "building-options", warehouseId },
      pageSize: 100,
      ...(cursor ? { cursor } : {}),
      read: (raw, endCursor?: string) =>
        ctx.tenantDb
          .byIndex<Doc<"storageBuildings">>(
            "storageBuildings",
            "by_orgId_warehouseId_code",
            [{ field: "warehouseId", value: warehouseId }],
          )
          .page({
            limit: 100,
            ...(raw ? { cursor: raw } : {}),
            ...(endCursor ? { endCursor } : {}),
          }),
      get: (id) =>
        ctx.tenantDb.get<Doc<"storageBuildings">>("storageBuildings", id),
      hydrate: async (row) => row,
      matches: (row) => row.warehouseId === warehouseId,
    });
    return {
      ...result,
      page: result.page.map((b) => ({
        buildingId: b._id,
        buildingName: b.name,
        buildingCode: b.code,
        floorCount: b.floorCount,
      })),
    };
  },
});

// Compatibility for existing integrations. The catalogue UI uses page above.
export const list = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "storageZones" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, { warehouseId }) => {
    const zones = await ctx.tenantDb
      .byIndex<Doc<"storageZones">>(
        "storageZones",
        "by_orgId_warehouseId_code",
        [{ field: "warehouseId", value: warehouseId }],
      )
      .all(10_000);
    const rows = await Promise.all(zones.map((zone) => locationRow(ctx, zone)));
    return await Promise.all(
      rows.filter((row) => row !== null).map((row) => withOccupancy(ctx, row)),
    );
  },
});
